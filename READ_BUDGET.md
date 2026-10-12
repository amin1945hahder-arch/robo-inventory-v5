# READ_BUDGET.md — Convex read-cost audit & budget

This is the living read-cost ledger for RC. It records **what the cache
already does**, **where reads are still high**, and **what changed** — with the
numbers we can actually measure. Absolute Convex dashboard figures are supplied
by the project owner (the agent has no dashboard access); everything else is
derived from the instrumentation described in §5.

---

## 1. Architecture summary — what the client cache already does correctly

The offline/delta-sync layer lives in `src/lib/sync/` and `src/hooks/use-cached-data.ts`:

| File | Responsibility |
|---|---|
| `src/lib/sync/tables.ts` | Client mirror of the server's `SYNC_TABLES` (8 synced tables) + retention const. |
| `src/lib/sync/store.ts` | IndexedDB persistence (`idb-keyval`), **one key per table** so loading parts never deserializes rentals. Best-effort: private mode / quota → no cache, never a crash. |
| `src/lib/sync/delta.ts` | Pure merge logic. `applyDelta` upserts changed rows, applies tombstones, and **only ever moves the cursor forward** (a stale out-of-order page cannot rewind it). `needsFullResync` (new) decides when to rebuild from scratch. |
| `src/lib/sync/bus.ts` | `bumpDataSync()` invalidation bus (now coalesced within 2 s). Currently no writer calls it — the reactive head is the real invalidator — but it is the hook for imports/backfills. |
| `src/hooks/use-cached-data.ts` | Cache-first hook: hydrate from IndexedDB → pull delta pages via `sync.getUpdatedRecords` → stay fresh via one reactive `sync.syncHead` watch per table. |

Things that were **already correct** and were not disturbed:

- **Cursor lives in a ref, not state** (`sinceRef`), so pulls don't re-render.
- **Cursor monotonicity** — `applyDelta` keeps the newer stamp; out-of-order pages cannot re-download forever.
- **Tombstones** for hard deletes (`syncTombstones`) so a deleted row can't linger in the cache.
- **Server-side projection** — `getUpdatedRecords` returns only the fields the UI renders (`PROJECTIONS`), notably excluding `parts.consumptionLog`.
- **Indexed reads only** — every delta read is a strict `by_updatedAt` range scan; `syncHead` is `order("desc").first()` (1 doc).
- **Defensive hydration** — corrupt/missing IndexedDB → empty cache, no throw.
- **Cache coalescing** — concurrent `pullDelta()` calls collapse into one follow-up pass.

## 2. Phase 0 — file-by-file map of the caching system

- **Cursor storage:** `sinceRef`/`lastDeleteRef` refs in `use-cached-data.ts`; persisted as `TableCache.latestUpdatedAt` by `store.ts` (`table:<name>` keys).
- **Who calls `bumpDataSync`:** *nobody* today (only defined and listened). The reactive `syncHead` watch is the actual invalidator.
- **Where `applyDelta` is invoked:** exactly one place — inside `setCache` in `use-cached-data.ts`.
- **Consumers of the cache:** only `src/pages/Inventory.tsx` (`useCachedData("parts")`). Everything else still subscribes reactively.
- **Client→Convex call kinds:** reactive `useQuery` (the vast majority), one-shot `convex.query()` (delta pulls + tombstones), `convex.watchQuery` (the sync head), `useMutation`, actions (email/Telegram/WhatsApp/backup). **There is no `usePaginatedQuery` anywhere.** No unstable `Date.now()`-style query args were found — Convex deep-compares args, so inline `{}` literals do *not* cause re-execution (the usual "unstable args" premise does not apply here).

### Media stored inline (base64 / `data:` URLs) — reported, not yet migrated

These fields embed base64 in the document. The catastrophic one is `rentals.transferDoc`, because `rentals` is a large, hot table:

| Field | Table | Notes |
|---|---|---|
| `transferDoc.dataUrl` | `rentals` | Attached transfer document as a data URL. **Not in the sync projection**, but it *is* returned by `listAllRentals`/`getPartWithRental` and read by every full `rentals` scan. |
| `attachment.dataUrl` | `chatMessages` | Chat is a short-lived relay (swept every 5 min), so impact is bounded. |
| `imageUrl` | `closets`, `projects`, `groups`, `parts` | Avatars/covers as compressed data URLs. Only `parts`/`groups` matter for scans. |
| `image` | `users`, `chatConversations`, `profileRequests` | Avatars via `safeImage()`. |
| `consumptionLog` | `parts` | Unbounded audit array on every unit — not base64, but the single largest per-document payload on the biggest table. |

## 3. Phase 1 — read-cost audit (one row per Convex call site)

`N_x` = table row counts; `X/day` = executions/day. Reactive executions ≈ writes to the tables the query *read* during the subscription window (Convex dependency tracking), so busy tables amplify.

| File:line | Kind | Table(s) | Index used? | Bounded? | Fields returned | Reactive? | Est. docs read / execution | Est. exec/day |
|---|---|---|---|---|---|---|---|---|
| `pages/Inventory.tsx:84` +3 more (`Closets.tsx:36`, `ClosetDetail.tsx:30`, `GroupDetail.tsx:57`) | `stats.groupStats` | groups, parts (**reading `consumptionLog`**) | no (`filter`) | **no — full `.collect()` ×2** | full docs | **yes (4 subs)** | `N_groups + N_parts` **with** logs | ≈ writes to parts+groups |
| `pages/Dashboard.tsx:28` | `stats.overview` | parts, groups, projects, rentals | partially (`by_status` for rentals) | **no — parts/groups full `.collect()`** | full docs | yes | `N_parts + N_groups + N_active + N_pending` | ≈ writes to parts |
| `pages/AdminRequests.tsx:100` | `parts.pendingRentalRows` | rentals, parts, groups, rentalPackages | `by_status` pending | **no (unbounded)** | full rows + joins | yes | `N_pending + joins` | ≈ rental writes |
| `pages/AdminRequests.tsx:103/106/107` | `parts.listAllRentals` ×3 | rentals, parts, groups, users | `by_status` | partial (by status) | full rental row incl. `transferDoc`? | yes | `N_{active,approved,on_project} + joins` | ≈ rental writes |
| `pages/AdminRequests.tsx:110` | `parts.listAllRentals` history | rentals+joins | `by_status` returned | partial | full row | yes (tab-gated) | `N_returned + joins` | tab open only |
| `pages/AdminRequests.tsx:111` | `parts.listPackages` | rentalPackages, rentals, groups | **no for `scope:"all"`** | **no — full collect + per-pkg re-query** | full rows | yes | `N_packages × rentals-of-user` | ≈ package writes |
| `pages/AdminPeople.tsx:306` + `PartDetail.tsx:70` | `notifications.listPeople` | users, rentals | **no (both full)** | **no** | projected user + counts | yes (2 subs) | `N_users + N_rentals` | ≈ rental writes |
| `components/EditRentalDialog.tsx:103` + `EditPackageDialog.tsx:100` | `users.listPeopleLite` | users | **no** | **no** | lite users | yes (2 subs) | `N_users` | ≈ user writes |
| `pages/Printing3D.tsx:148` | `printing.listJobs` | printJobs, printers, filaments | **no** | **no — full collect** | enriched jobs | yes | `N_jobs` | ≈ print writes |
| `pages/Printing3D.tsx:149` | `printing.farmStats` | printers, printJobs, filaments | **no** | **no** | aggregates | yes | `N_printers + N_jobs + N_filaments` | ≈ print writes |
| `pages/Closets.tsx:34,35` / `Inventory.tsx:85,91` etc. | `catalog.listGroups` / `childGroupOptions` | groups | `by_category`/`by_closet` | **no — full collect** | full group docs | yes (6 + 9 subs) | `N_groups` | ≈ group writes |
| `Inventory.tsx:75` +9 more | `catalog.listClosets` | closets | `by_name` | **no** | full docs | yes (10 subs) | `N_closets` | ≈ closet writes |
| `pages/AdminReports.tsx:103,104` | `reports.history`/`stats` | rentals, users, parts | no | **no — full `.collect()`** | full rows | yes | `N_rentals + N_users` | admin views |
| `pages/AdminRequests.tsx:141` | `bulk.historyStats` | rentals | `by_user` (now) | dialog-gated | counts | yes (gated) | `N_rentals` or user's | on open |
| `pages/AdminRequests.tsx:123` | `notifications.listNotifications` | notifications | default order | **was: full `.collect()`** | 50 newest | yes | **was `N_notif`, now 50** | ≈ notification writes |
| `components/AppShell.tsx:84` (admin) | `notifications.unreadCount` | notifications | **no** | **no — full collect** | count | yes | `N_notif` | ≈ notification writes |
| `pages/AdminRequests.tsx:143` | `bulk.allSeenKeys` | seenRequests | **no** | **no** | keys | yes | `N_seen` | ≈ action writes |
| `pages/Labels.tsx:105` | `labels.getLabelData` | closets,categories,groups,parts,users | no | **no** | full | yes | sum of 5 tables | on print |
| `pages/PartDetail.tsx:57` / `RentScan.tsx:64` | `parts.getPartWithRental` | parts, rentals, groups | `by_part` | partial | full rows | yes | `N_active-rentals-for-part` | on view |
| `pages/MyRentals.tsx:24` / `Dashboard.tsx:33` +2 | `parts.listMyRentals` | rentals, parts, groups | `by_user` | yes (per user) | full rows | yes (4 subs) | user's rentals | ≈ own writes |
| `hooks/use-cached-data.ts` (`Inventory`) | `sync.getUpdatedRecords` + `listTombstonesSince` + `syncHead` (watch) | one table each | **`by_updatedAt` / `by_table_deletedAt`** | **yes (`.take(1000/500)` + `.first()`)** | projected | head reactive | 1 (head) + delta rows | per change |

### Top 10 read consumers by estimated monthly Database I/O

Ranked by *(docs per execution × executions/day × bytes per doc)*:

1. **`stats.groupStats`** — 4 subscribers × full `parts` + `groups` scan, re-run on every part/group write. Pays for `consumptionLog` on every part. **#1.**
2. **`stats.overview`** — full `parts` + `groups` scan on the dashboard, re-run on every part write.
3. **`parts.listAllRentals`** (×4 call sites) — full rental rows + 3-way joins, re-run per rental write, plus `transferDoc` payload risk on history.
4. **`parts.pendingRentalRows`** — all pending rentals + joins + per-package `containerInfo` walk, re-run per rental write.
5. **`notifications.listPeople`** — full `users` **and** full `rentals` scan, 2 subscribers, re-run per rental write.
6. **`parts.listPackages` (`scope:"all"`)** — full `rentalPackages` collect plus a per-package `rentals` re-query (N+1).
7. **`printing.listJobs` + `farmStats`** — full `printJobs`/`printers`/`filaments` collects, both subscribed on the print page.
8. **`users.listPeopleLite`** — full `users` collect, 2 subscribers.
9. **`notifications.unreadCount`** — full `notifications` collect in the admin shell, re-run per notification write, unbounded growth.

Honourable mentions: `catalog.listGroups`/`listClosets`/`listCategories`/`childGroupOptions`/`projects.listProjects` (many subscribers, full collects, but on slow-moving reference tables), `chat.listConversations`/`listPeople`, `labels.getLabelData`, `exportData.*`, `reports.*`.

## 4. Baseline — Convex dashboard (project owner to supply)

The agent cannot read the Convex dashboard, so these are **placeholders**. Fill
the current billing period in from dashboard.convex.dev → *Usage* (Database I/O
GB) and *Insights/Health* (function calls + avg I/O per function):

| Metric | Baseline (before) | After |
|---|---|---|
| Database I/O (GB), current period | _pending_ | _pending_ |
| Function calls, current period | _pending_ | _pending_ |
| `parts.listAllRentals` — calls / avg I/O | _pending_ | _pending_ |
| `stats.groupStats` — calls / avg I/O | _pending_ | _pending_ |
| `notifications.listNotifications` — avg I/O | _pending_ | _pending_ |
| `notifications.listPeople` — avg I/O | _pending_ | _pending_ |

> Compare **per-day averages**, not raw totals, and only over complete days on
> both sides of the change.

## 5. Instrumentation (dev-only)

`src/hooks/use-cached-data.ts` logs one line per sync cycle in dev builds:

```
[sync] parts: 12 doc(s), ~3184B
[sync] parts: 0 doc(s), ~2B          ← no-change steady state
[sync] full resync (parts) — cursor predates tombstone retention
```

Fields: table, docs received, approximate bytes (`JSON.stringify(rows).length`),
`hasMore`. This is what backs the §6 estimates and lets the owner confirm a
no-change cycle reads a single indexed head + an empty delta.

## 6. Changes made (grouped by priority)

### P2 — sync-layer amplification (this batch)

| File:line | Change | Why | Est. reads saved/day |
|---|---|---|---|
| `src/convex/schema.ts` (`syncTombstones`) | Added `by_table_deletedAt` composite index | Table-scoped tombstone reads without a filter scan | — |
| `src/convex/sync.ts` (`syncHead`) | Tombstone head is now **scoped to the table** (was global) | A delete in `rentals` no longer flips every other table's head and forces a needless delta pull | Before: 1 delete → up to `N_tables` extra pulls. Now: 1. Saves ≈ `(N_tables−1) × deletes/day` pulls |
| `src/convex/sync.ts` (`listTombstonesSince`) | Added `table` arg + `by_table_deletedAt` + `requireUser` auth | Each pull now reads only this table's tombstones (was up to 500 rows of **all** tables' tombstones, per table, per pull) | Before: ≤500 rows × per-table per-pull. Now: ≤ this table's changed tombstones. Saves ≈ `500 × (tables mounted) × pulls/day` docs |
| `src/convex/sync.ts` (`pruneTombstones`) + `crons.ts` | Scheduled the existing prune weekly; retention const shared with the client | `pruneTombstones` was **defined but never scheduled** → tombstones grew unbounded | Prevents linear growth of every tombstone read |
| `src/hooks/use-cached-data.ts` | Full-resync escape hatch (`needsFullResync`) + dev instrumentation | Cursor older than tombstone retention → rebuild instead of trusting a delta that missed pruned deletes; make sync cost observable | Correctness + observability |
| `src/lib/sync/bus.ts` | `bumpDataSync` coalesced within 2 s | A burst of writes triggers at most one delta pull per table | Before: 1 pull/bump. Now: 1 pull/burst |

### P2/P0 — bounded + de-scanned server queries (this batch)

| File:line | Change | Why | Est. reads saved/day |
|---|---|---|---|
| `src/convex/notifications.ts` (`listNotifications`) | Full `collect()` → `order("desc").take(50)` | Only 50 are ever rendered; the feed grew forever | `N_notif` → 50 docs per execution |
| `src/convex/notifications.ts` (`listPeople`) | Dropped the full `rentals.collect()`; counts live rows via `by_status` (pending/active/on_project) | `rentals` is unbounded and historical; only live rows feed the badges | Before: `N_rentals` per execution. Now: live rentals only. Saves ≈ `N_historical × executions/day` |
| `src/convex/bulk.ts` (`historyStats`) | Per-user path uses `by_user` index | Clearing one person's history only needs that person's rows | User path `N_rentals` → that user's rows |

**Total delta-sync cost now, steady state (no writes):** per mounted table =
1 reactive head read (2 indexed `.first()` docs) + 1 empty delta page + 1
empty tombstone page ≈ **~4 docs**, versus "all tombstones of all tables" before.

### P1 — hot-path notification + package reads (batch 2)

| File:line | Change | Why | Est. reads saved/day |
|---|---|---|---|
| `src/convex/parts.ts` (5 request paths: 691/772/804/852/2293) | `users.collect()` → `listAdmins(ctx)` (`by_role` index) | Every rental/package request collected ALL user docs just to tag the admins in Telegram | Per request: `N_users` → `N_admins` docs |
| `src/convex/push.ts` (`pushToAdmins`) | Full user scan + filter → `by_role` index | Scheduled on EVERY new request, so the full scan was one of the hottest reads in the app | `N_users` → `N_admins` per push |
| `src/convex/whatsapp.ts` (`adminPhones`) | Full user scan → `listAdmins` (`by_role`) | `notifyAdmin` runs on every request/decision (ADMIN_PHONES fallback path) | `N_users` → `N_admins` per notify |
| `src/convex/notifications.ts` (`unreadCount`) | Full-table `.filter().collect()` → `order("desc").take(50)` | The admin-shell badge re-counted the whole (forever-growing) table on every notification write — but only the newest 50 are ever rendered | `N_notif` → ≤50 docs per write |
| `src/convex/notifications.ts` (`markAllRead`) | Full-table scan → `order("desc").take(200)` | Same visible window as the feed + badge | `N_notif` → ≤200 docs |
| `src/convex/schema.ts` (`rentals`) | **New index `by_package`** (`packageId`) | Enables every lookup below | — |
| `src/convex/parts.ts` (`listPackages`, `getPackage`) | `by_user` history collect + filter → `by_package` index | The package console read the requester's ENTIRE rental history once per package (N+1) | Per package: `N_user_rentals` → `N_pkg_rows` |
| `src/convex/parts.ts` (`returnPackage`, `editPackage`, package pickup) + `src/convex/bulk.ts` (×3, in loops) | Same `by_package` conversion | These run inside per-package loops, multiplying the history scans | same pattern |

### P0 — offline-first read path (batch 3)

The root cause of "pages show empty data when offline" was never a server
problem: `useQuery` returns `undefined` until the websocket delivers, and
offline it never delivers, so every page rendered its empty state. The
delta-sync cache already existed but was **not connected to any page**.

| File | Change | Why |
|---|---|---|
| `src/lib/sync/queryCache.ts` | NEW — pure cache-key + freshness logic | Stable keys (args sorted, `"skip"` folded into no-args) and an explicit fresh/stale/miss decision. Unit-testable, no React |
| `src/lib/sync/queryStore.ts` | NEW — IndexedDB store for query RESULTS | Separate from the table cache (different shape/lifecycle). Entries are **scoped per user id** so a shared device never cross-reads |
| `src/hooks/use-offline-query.ts` | NEW — drop-in `useQuery` replacement | Hydrates from IndexedDB on mount (first paint is already full), writes every live result back, and revalidates only on **interrupts**: reconnect or `bumpDataSync`. Nothing polls |
| `src/hooks/use-auth.ts` | Persisted identity in `localStorage` | `user === undefined` offline made `isLoading` permanently true → the app couldn't even be **opened** without a signal. Cached identity renders the shell immediately; live query always wins when online |
| `src/hooks/use-auth.ts` | Shared identity store (`publishAuthUser` / `subscribeAuthUser` / `getAuthUserSync`) | The cache key needs the user id, but a page opens ~100 query hooks. Reading it via `useAuth()` in each meant ~100 duplicate `useConvexAuth` + `currentUser` subscriptions — the fix would have added the exact read cost this section removes. One subscription publishes; the rest read it synchronously |
| 20 page files | `useQuery` → `useOfflineQuery` (aliased) | Mechanical import swap only — same call signature, same return type, so no call site changed. Verified by `tsc` exit 0 across all of them |

Read-cost effect: an offline (or reconnect) page view now serves a **local**
read. Only a genuine cold cache costs a network query; repeated navigation
within `DEFAULT_MAX_AGE_MS` (10 min) costs none. `useCachedData` remains for
the table-level delta sync it was built for and is untouched.

Deliberate limits: the cache stores query RESULTS, not a re-implementation of
every page's derived logic, so stale entries are possible by design — bounded
by `maxAgeMs` and always replaced by the live value once the network answers.

One more correctness detail found while measuring the hook: when the cache key
changes (different args, or the member signs out and the scope re-keys) and no
entry exists for the new key, the hydrated snapshot must be **cleared**, not
left in place — otherwise the previous key's rows keep rendering under the
new one.

## 7. Deliberately NOT changed (and why)

- **`stats.groupStats` / `stats.overview` full scans** — the correct fix is to
  compute these client-side from the already-delta-synced `parts` cache, but
  that touches 4 pages' data flow; doing it without visual verification risks
  breaking inventory badges. Tracked as the #1 next optimization.
- **`parts.listAllRentals` / `pendingRentalRows`** — bounded by `by_status`
  already and genuinely real-time (the "currently rented" board). Left reactive
  on purpose; they need index+projection work, not de-reactivity.
- **`notifications.unreadCount` denormalized counter** — the scan is now
  bounded to the 50 rows the feed renders (batch 2); a denormalized counter is
  still the "exact number forever" fix but needs a schema/migration change.
- **`consumptionLog` on `parts`** — moving it to its own table would shrink
  every part read, but it is an invasive migration across many call sites.
- **Migrating `listGroups`/`listClosets`/`listCategories`/`listProjects`/
  `listPeopleLite` to `useCachedData`** — highest structural win, but the
  projections don't yet cover every consumer's fields; needs a per-consumer
  audit and visual verification.
- **Chat/print/project modules** — full collects remain; they are lower-volume
  than rentals/parts and each has a bespoke shape.
- **The React tree / reactivity** — no genuine real-time subscription was
  removed; nothing in §6 changes when the UI updates.

## 8. Remaining risks & top 3 next optimizations

**Risks**
- Baseline/after dashboard numbers are supplied by the owner; §6 numbers are
  *estimates from the read paths*, not measured billing.
- `needsFullResync` trusts the client clock for the "offline longer than
  retention" clause (a badly-skewed clock could force an unnecessary resync —
  harmless, just one rebuild).
- Only 1 table is currently cached client-side, so the sync-layer wins are
  capped until more consumers adopt `useCachedData`.

**Next 3 optimizations (in order)**
1. **Compute `groupStats`/`overview` client-side from the delta-synced `parts`
   cache**, deleting the two heaviest reactive scans (rank #1 and #2).
2. **Move `parts.consumptionLog` into its own table** (or a capped array) so
   every part read and `listPartsOfGroup` shrink.
3. **Adopt `useCachedData` for `groups`/`closets`/`categories`/`projects`/
   `users`** across the reference-table consumers, then denormalize an
   `unreadCount` counter.
