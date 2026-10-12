import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { formatLineAmount } from "@/lib/group-measure";
import { contains, matchesSearch as deepMatch } from "@/lib/searchText";
import { cn, tabColor } from "@/lib/utils";
import { AppShell } from "@/components/AppShell";
import { LoadingGif, LoadingGifInline } from "@/components/LoadingGif";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { Award, BellRing, Boxes, CalendarClock, Check, History, IdCard, Inbox, PackageCheck, PackagePlus, Printer, RotateCcw, ScanLine, Search, SquarePen, Trash2, Warehouse, X } from "lucide-react";
import { EditRentalDialog } from "@/components/EditRentalDialog";
import { EditPackageDialog } from "@/components/EditPackageDialog";
import { PackageCardDialog } from "@/components/PackageCardDialog";
import { type PackageCardData } from "@/components/PackageCardPaper";
import { packageDisplayStatus } from "@/lib/package-status";
import { PersonBadgeDialog, type PersonBadgeData } from "@/components/PersonBadgeDialog";
import { RentCardDialog, type CardRow } from "@/components/RentCardDialog";
import { containerChainOf } from "@/lib/container-chain";
import {
  DocAttachmentField,
  type AttachedDoc,
} from "@/components/DocAttachmentField";

type Row = {
  rental: any;
  part: any;
  group: any;
  student: any;
};

// Per-tab counter bubbles — each tab gets its OWN color with the app's glassy
// 3D treatment (gradient fill + inner top highlight + hairline border).
const TAB_COUNT: Record<string, string> = {
  updates: "border-cyan-500/40 from-cyan-500/25 to-cyan-500/10 text-cyan-300",
  pending: "border-sky-500/40 from-sky-500/25 to-sky-500/10 text-sky-300",
  packages: "border-violet-500/40 from-violet-500/25 to-violet-500/10 text-violet-300",
  pickup: "border-amber-500/40 from-amber-500/25 to-amber-500/10 text-amber-300",
  active: "border-emerald-500/40 from-emerald-500/25 to-emerald-500/10 text-emerald-300",
  projects: "border-teal-500/40 from-teal-500/25 to-teal-500/10 text-teal-300",
  history: "border-slate-400/40 from-slate-400/25 to-slate-400/10 text-slate-300",
  ranks: "border-rose-500/40 from-rose-500/25 to-rose-500/10 text-rose-300",
  printers: "border-fuchsia-500/40 from-fuchsia-500/25 to-fuchsia-500/10 text-fuchsia-300",
  profiles: "border-orange-500/40 from-orange-500/25 to-orange-500/10 text-orange-300",
};

// The SAME per-tab hues as solid fills — the active trigger takes its own
// color (Settings-bar treatment via .colored-tabs + tabColor).
const TAB_COLORS: Record<string, string> = {
  updates: "#22d3ee",
  pending: "#38bdf8",
  packages: "#a78bfa",
  pickup: "#fbbf24",
  active: "#34d399",
  projects: "#2dd4bf",
  history: "#94a3b8",
  ranks: "#fb7185",
  printers: "#e879f9",
  profiles: "#fb923c",
};
const tStyle = (tab: string) => tabColor(TAB_COLORS[tab] ?? TAB_COLORS.updates);

function TabCount({ tab, n }: { tab: string; n: number }) {
  return (
    <span
      className={cn(
        "rounded-full border bg-gradient-to-b px-1.5 py-0.5 text-[11px] font-semibold tabular-nums shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.35)]",
        TAB_COUNT[tab] ?? TAB_COUNT.history,
      )}
    >
      {n}
    </span>
  );
}

export default function AdminRequests() {
  // Active console tab (controlled so one-tap actions inside the Updates tab
  // can jump straight to the matching dedicated tab). Declared first: the
  // per-tab query gating below reads it during render.
  const [tab, setTab] = useState<
    "updates" | "pending" | "packages" | "pickup" | "active" | "projects" | "history" | "ranks" | "printers" | "profiles"
  >("updates");
  // ---- Clear history (History tab) ----
  // Independent categories — nothing is deleted unless it is ticked here, and
  // the confirm button stays disabled until at least one thing is selected.
  const [clearOpen, setClearOpen] = useState(false);

  // Pending tab uses a grouped query: singles are one row each, pending
  // package units collapse into one row per package — badge and list always
  // match what is actually rendered.
  const pendingRowsQ = useQuery(api.parts.pendingRentalRows, {});
  const pendingSingles = (pendingRowsQ ?? []).filter((r: any) => r.kind === "single");
  const pendingPkgRows = (pendingRowsQ ?? []).filter((r: any) => r.kind === "package");
  const active = useQuery(api.parts.listAllRentals, { status: "active" });
  // Approved but not yet handed over — the pick-up stage. Small by nature
  // (a transient stage) and needed for the Pick-up tab badge on every tab.
  const awaiting = useQuery(api.parts.listAllRentals, { status: "approved" });
  const onProject = useQuery(api.parts.listAllRentals, { status: "on_project" });
  // History is the largest read in this console (every processed rental) and
  // has no tab badge — subscribe only while the History tab is open.
  const history = useQuery(api.parts.listAllRentals, tab === "history" ? { status: "returned" } : "skip");
  const packages = useQuery(api.parts.listPackages, { scope: "all" });
  const returnWholePkg = useMutation(api.parts.returnWholePackage);
  const projects = useQuery(api.projects.listProjects, { status: "active" });
  const profileReqs = useQuery(api.notifications.listProfileRequests, { status: "pending" });
  const decideProfile = useMutation(api.notifications.decideProfileRequest);
  const rankReqs = useQuery(api.users.listRankRequests, { status: "pending" });
  const decideRank = useMutation(api.users.decideRankRequest);
  const printerReqs = useQuery(api.users.listPrinterRequests, { status: "pending" });
  const decidePrinter = useMutation(api.users.decidePrinterRequest);
  // Inventory-manager requests — same stacked-privilege idea as printer
  // access; rendered in the Printers tab (deep links use ?tab=printers).
  const inventoryReqs = useQuery(api.users.listInventoryRequests, { status: "pending" });
  const decideInventory = useMutation(api.users.decideInventoryRequest);
  // New-member sign-ups awaiting profile approval (Profiles tab rows carry
  // the userId directly, not a request id).
  const approveProfileAcct = useMutation(api.users.approveProfile);
  // Unread admin notifications: listed below the tabs, marked read when this
  // page opens (and per-row on click) so the sidebar/header bubbles decrease
  // properly instead of only clearing when every row is actioned.
  const notifications = useQuery(api.notifications.listNotifications, {});
  const markAllRead = useMutation(api.notifications.markAllRead);
  const markRead = useMutation(api.notifications.markRead);
  const unread = (notifications ?? []).filter((n) => n.read !== true);

  useEffect(() => {
    if (unread.length === 0) return;
    markAllRead().catch(() => undefined);
    // markAllRead identity is stable; only re-run when the unread set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread.length]);

  const act = useMutation(api.parts.adminRentalAction);
  const setReturnMeetupM = useMutation(api.parts.setReturnMeetup);
  const markReturnHandedOverM = useMutation(api.parts.markReturnHandedOver);
  const decidePkg = useMutation(api.parts.decidePackage);
  const bulkDeleteRecords = useMutation(api.bulk.bulkDeleteRentalRecords);
  const markPkgTaken = useMutation(api.parts.markPackageTaken);
  const clearHistory = useMutation(api.bulk.clearRentalHistory);
  // Scans the whole processed history — only needed while the dialog is open.
  const historyStatsQ = useQuery(api.bulk.historyStats, clearOpen ? {} : "skip");
  const markSeen = useMutation(api.bulk.markRequestsSeen);
  const seenKeysQ = useQuery(api.bulk.allSeenKeys, {});
  const seenKeys = useMemo(() => new Set(seenKeysQ ?? []), [seenKeysQ]);
  const unapproved = useQuery(api.users.listUnapprovedProfiles, {});
  // Scheduled pick-ups for approved rentals: reusable slots + a no-show list.
  const pickups = useQuery(api.parts.scheduledPickups, {});

  const [busyId, setBusyId] = useState<string | null>(null);
  // Approve flow: pick the pick-up date/time (or reuse a scheduled slot).
  const [approveFor, setApproveFor] = useState<Row | null>(null);
  const [editRentalFor, setEditRentalFor] = useState<any>(null);
  // Whole-package record editor (admin) — pkg row from api.parts.listPackages.
  const [editPkgFor, setEditPkgFor] = useState<any>(null);
  // Print rent card for any request row.
  const [card, setCard] = useState<CardRow | null>(null);
  // Member badge card (Ranks / Printer / Profiles tabs).
  const [badgeFor, setBadgeFor] = useState<PersonBadgeData | null>(null);
  const badgeOf = (user: any): PersonBadgeData => ({
    userId: user._id,
    name: user.name ?? "Member",
    email: user.email,
    image: user.image,
    role: user.role,
    studentId: user.studentId,
    clubRoles: user.clubRoles,
    telegramUsername: user.telegramUsername,
  });
  // Group index for the container chain printed on the card.
  const groupsIndex = useQuery(api.catalog.childGroupOptions, {});
  const [approvePkgFor, setApprovePkgFor] = useState<{ key: string; unitCount: number } | null>(null);
  const [pickupLocal, setPickupLocal] = useState("");
  // Return hand-over scheduling (mirror of the pick-up date) + the explicit
  // "handed over" step that unlocks the normal return processing.
  const [meetupFor, setMeetupFor] = useState<Row | null>(null);
  const [meetupLocal, setMeetupLocal] = useState("");
  const [meetupBusy, setMeetupBusy] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [returnFor, setReturnFor] = useState<Row | null>(null);
  const [destination, setDestination] = useState<"shelf" | "project" | "transferred">("shelf");
  const [functional, setFunctional] = useState(true);
  const [report, setReport] = useState("");
  const [projectId, setProjectId] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  // Transfer-out fields (destination name + details + doc file).
  const [transferName, setTransferName] = useState("");
  const [transferDetails, setTransferDetails] = useState("");
  const [transferDoc, setTransferDoc] = useState<AttachedDoc | null>(null);
  // Bulk consumable return: how much of the taken amount came back.
  const [recovered, setRecovered] = useState("");

  // ---- Search across EVERYTHING (all tabs) ----------------------------
  const [search, setSearch] = useState("");
  // Keystrokes only touch this local state; `search` (which drives every
  // filter memo in the console) follows 200ms later — typing stays smooth
  // even with thousands of rows subscribed.
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);
  // Active console tab (controlled so one-tap actions inside the Updates tab
  // can jump straight to the matching dedicated tab) — declared at the top of
  // the component so per-tab query gating can read it.
  // Deep link from a unit page: /admin/requests?tab=…&rental=…&package=… —
  // opens the right tab, highlights the record and scrolls it into view.
  const [sp, setSp] = useSearchParams();
  const focusRentalId = sp.get("rental");
  const focusPackageId = sp.get("package");
  const focusKey = focusRentalId ?? focusPackageId ?? null;
  const clearFocus = useCallback(() => {
    const next = new URLSearchParams(sp);
    next.delete("rental");
    next.delete("package");
    setSp(next, { replace: true });
  }, [sp, setSp]);
  const focusRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!focusKey) return;
    // Data may still be streaming in — retry the scroll a couple of times.
    const t1 = setTimeout(() => focusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    const t2 = setTimeout(() => focusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 600);
    const t3 = setTimeout(clearFocus, 6000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [focusKey, clearFocus]);
  useEffect(() => {
    const t = sp.get("tab");
    if (t && t !== tab) setTab(t as typeof tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  const matchesSearch = useCallback(
    (haystacks: (string | number | undefined | null)[]) => {
      const s = search.trim().toLowerCase();
      if (!s) return true;
      return haystacks.some((h) => String(h ?? "").toLowerCase().includes(s));
    },
    [search],
  );

  // ---- Multi-select (like Inventory): apply one action to many rows ----
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkDeny = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Deny ${selected.size} selected request(s)? Units go back to the shelf.`)) return;
    setBulkBusy(true);
    try {
      // Selections can mix rental rows and rank/printer requests — route by id.
      const rankIds = new Set<string>((rankReqs ?? []).map((r) => r.request._id));
      const printerIds = new Set<string>((printerReqs ?? []).map((r) => r.request._id));
      const profileIds = new Set<string>((profileReqs ?? []).map((r) => r.request._id));
      const inventoryIds = new Set<string>((inventoryReqs ?? []).map((r) => r.request._id));
      const signupIds = new Set<string>((unapproved ?? []).map((u) => u._id as string));
      let ok = 0;
      for (const id of selected) {
        try {
          if (rankIds.has(id)) await decideRank({ id: id as any, approve: false });
          else if (printerIds.has(id)) await decidePrinter({ id: id as any, approve: false });
          else if (profileIds.has(id)) await decideProfile({ id: id as any, approve: false });
          else if (inventoryIds.has(id)) await decideInventory({ id: id as any, approve: false });
          else if (signupIds.has(id)) await approveProfileAcct({ userId: id as never, approved: false });
          else await act({ rentalId: id as never, action: "deny" });
          ok++;
        } catch {
          /* one failing row doesn't stop the rest */
        }
      }
      toast.success(`${ok} of ${selected.size} request(s) denied`);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  // Bulk-approve: pending rentals get the scheduled pick-up dialog treatment
  // skipped (instant approve), rank/printer requests get granted.
  const bulkApprove = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Approve ${selected.size} selected request(s)?`)) return;
    setBulkBusy(true);
    try {
      const rankIds = new Set<string>((rankReqs ?? []).map((r) => r.request._id));
      const printerIds = new Set<string>((printerReqs ?? []).map((r) => r.request._id));
      const profileIds = new Set<string>((profileReqs ?? []).map((r) => r.request._id));
      const inventoryIds = new Set<string>((inventoryReqs ?? []).map((r) => r.request._id));
      const signupIds = new Set<string>((unapproved ?? []).map((u) => u._id as string));
      let ok = 0;
      for (const id of selected) {
        try {
          if (rankIds.has(id)) await decideRank({ id: id as any, approve: true });
          else if (printerIds.has(id)) await decidePrinter({ id: id as any, approve: true });
          else if (profileIds.has(id)) await decideProfile({ id: id as any, approve: true });
          else if (inventoryIds.has(id)) await decideInventory({ id: id as any, approve: true });
          else if (signupIds.has(id)) await approveProfileAcct({ userId: id as never, approved: true });
          else await act({ rentalId: id as never, action: "approve" });
          ok++;
        } catch {
          /* one failing row doesn't stop the rest */
        }
      }
      toast.success(`${ok} of ${selected.size} request(s) approved`);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  // Bulk hand-over: approved rentals AND approved packages in one click.
  // Package ids are routed to markPackageTaken (whole bundle), rental ids to
  // the single mark_taken action; one failing row never stops the rest.
  const bulkMarkTaken = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Mark ${selected.size} selected item(s) as picked up?`)) return;
    setBulkBusy(true);
    try {
      const pkgIds = new Set<string>(
        (packages ?? []).filter((p) => p.package.status === "approved").map((p) => p.package._id),
      );
      let ok = 0;
      for (const id of selected) {
        try {
          if (pkgIds.has(id)) await markPkgTaken({ packageId: id as any });
          else await act({ rentalId: id as never, action: "mark_taken" });
          ok++;
        } catch {
          /* one failing row doesn't stop the rest */
        }
      }
      toast.success(`${ok} of ${selected.size} marked as picked up`);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  // Bulk return: every selected ACTIVE unit goes back with the same one
  // decision (shelf / project / transferred + condition) via the whole-package
  // return dialog — its submit handler loops the target ids. Package ids in
  // the selection route to returnWholePackage as usual; rentals to the
  // per-record action. Rank/printer/profile rows can never be "active".
  const [bulkReturnIds, setBulkReturnIds] = useState<{ rentals: string[]; bundles: string[] } | null>(null);
  const bulkReturn = () => {
    if (selected.size === 0) return;
    const pkgIds = new Set<string>((packages ?? []).map((p) => p.package._id));
    const rentals: string[] = [];
    const bundles: string[] = [];
    for (const id of selected) (pkgIds.has(id) ? bundles : rentals).push(id);
    if (rentals.length + bundles.length === 0) return;
    setBulkReturnIds({ rentals, bundles });
    // Open the shared return dialog in bulk mode (a stub row satisfies the
    // open gate; the description switches to the bulk wording).
    setDestination("shelf");
    setFunctional(true);
    setReport("");
    setProjectId("");
    setCreatingProject(false);
    setNewProjectName("");
    setTransferName("");
    setTransferDetails("");
    setTransferDoc(null);
    setRecovered("");
    setReturnFor({
      rental: { _id: "bulk" },
      part: {},
      group: {},
      student: null,
    } as unknown as Row);
  };

  // Package units are decided as a bundle in the Packages tab (all-or-nothing).
  // The grouped pending query already collapses them into package rows.
  const pendingRows = pendingSingles;
  const pendingCount = pendingRowsQ?.length ?? 0;
  // Counter chip for the Packages tab.
  const pendingPkgCount = (packages ?? []).filter((p) => p.package.status === "pending").length;

  /** Filter any rental row list by the global search box (every field). */
  const filterRentalRows = useCallback(
    (list: any[] | undefined) => {
      if (!list) return undefined;
      if (!search.trim()) return list;
      return list.filter((row: any) =>
        matchesSearch([
          row.group?.name,
          row.part?.tag,
          row.student?.name,
          row.student?.email,
          row.student?.studentId,
          row.student?.studentCode,
          row.rental?.status,
          row.rental?.amount,
          row.rental?.note,
          row.rental?.conditionReport,
          row.rental?.projectName,
          row.rental?.requestedAt && new Date(row.rental.requestedAt).toLocaleDateString(),
        ]),
      );
    },
    [matchesSearch],
  );

  const fPending = useMemo(() => filterRentalRows(pendingRows), [filterRentalRows, pendingRows]);
  // Packages tab: the search filters whole packages by requester, line item,
  // note or status — matching the tab-scoped search on every other tab.
  const fPackages = useMemo(() => {
    if (!search.trim()) return packages;
    const q = search.trim().toLowerCase();
    return (packages ?? []).filter(
      (p) =>
        deepMatch(p.requester as any, q) ||
        deepMatch(p.package as any, q) ||
        p.lines.some(
          (l: any) =>
            contains(l.groupName, q) ||
            contains(l.note, q) ||
            l.units.some((u: any) => contains(u.tag, q) || contains(u.status, q)),
        ),
    );
  }, [packages, search]);
  const fAwaiting = useMemo(() => filterRentalRows(awaiting), [filterRentalRows, awaiting]);
  // Pick-up tab: approved packages still waiting for the physical hand-over
  // (search-aware, like every other list). The unit stages are the truth:
  // a bundle whose units were handed over one by one must NOT linger here
  // even if its row was never stamped — hence approvedUnits > 0.
  const pickupPkgs = useMemo(
    () => (fPackages ?? []).filter((p) => p.package.status === "approved" && p.approvedUnits > 0),
    [fPackages],
  );
  const pickupPkgCount = pickupPkgs.length;
  const fActive = useMemo(() => filterRentalRows(active), [filterRentalRows, active]);
  const fOnProject = useMemo(() => filterRentalRows(onProject), [filterRentalRows, onProject]);
  const fHistory = useMemo(() => filterRentalRows(history), [filterRentalRows, history]);
  // The remaining request kinds are tab-scoped too: name/email/message/roles.
  const matchesRowText = useCallback(
    (obj: unknown) => Boolean(search.trim()) && deepMatch(obj as any, search.trim().toLowerCase()),
    [search],
  );
  const fRank = useMemo(
    () => (search.trim() ? (rankReqs ?? []).filter((e) => matchesRowText(e) || matchesRowText(e.request)) : rankReqs),
    [rankReqs, matchesRowText],
  );
  const fPrinter = useMemo(
    () => (search.trim() ? (printerReqs ?? []).filter((e) => matchesRowText(e) || matchesRowText(e.request)) : printerReqs),
    [printerReqs, matchesRowText],
  );
  const fProfile = useMemo(
    () =>
      search.trim()
        ? (profileReqs ?? []).filter((e) => matchesRowText(e) || matchesRowText(e.request))
        : profileReqs,
    [profileReqs, matchesRowText],
  );
  const fInventory = useMemo(
    () =>
      search.trim()
        ? (inventoryReqs ?? []).filter((e) => matchesRowText(e) || matchesRowText(e.request))
        : inventoryReqs,
    [inventoryReqs, matchesRowText],
  );
  const fUnapproved = useMemo(
    () => (search.trim() ? (unapproved ?? []).filter((u: any) => matchesRowText(u)) : unapproved),
    [unapproved, matchesRowText],
  );

  // ---- Updates tab: every NEW request of every kind, newest first ----
  // Keys mirror bulk.seenRequests entries: once an action lands (or the row
  // is explicitly marked seen) it disappears from here but stays in its
  // dedicated tab. Rendered as a notification inbox for the whole console.
  type UpdateRow = {
    kind: "single" | "package" | "rank" | "printer" | "inventory" | "profile" | "signup";
    key: string;
    at: number;
    data: any;
  };
  const updateRows = useMemo<UpdateRow[]>(() => {
    const out: UpdateRow[] = [];
    for (const row of pendingSingles)
      out.push({ kind: "single", key: `single:${row.rental._id}`, at: row.rental.requestedAt, data: row });
    for (const p of packages ?? [])
      if (p.package.status === "pending")
        out.push({ kind: "package", key: `package:${p.package._id}`, at: p.package.requestedAt, data: p });
    for (const e of rankReqs ?? [])
      out.push({ kind: "rank", key: `rank:${e.request._id}`, at: e.request.requestedAt, data: e });
    for (const e of printerReqs ?? [])
      out.push({ kind: "printer", key: `printer:${e.request._id}`, at: e.request.requestedAt, data: e });
    for (const e of inventoryReqs ?? [])
      out.push({ kind: "inventory", key: `inventory:${e.request._id}`, at: e.request.requestedAt, data: e });
    for (const e of profileReqs ?? [])
      out.push({ kind: "profile", key: `profile:${e.request._id}`, at: e.request.requestedAt, data: e });
    for (const u of unapproved ?? [])
      out.push({ kind: "signup", key: `signup:${u._id}`, at: Date.now(), data: u });
    return out.sort((a, b) => b.at - a.at);
  }, [pendingSingles, packages, rankReqs, printerReqs, inventoryReqs, profileReqs, unapproved]);
  const newUpdates = useMemo(() => updateRows.filter((u) => !seenKeys.has(u.key)), [updateRows, seenKeys]);

  // Select-all for the CURRENT tab: pending rows, active/on-project/history
  // rows, packages (by bundle id), and the rank/printer/profile requests.
  const currentTabIds = useMemo((): string[] => {
    switch (tab) {
      case "updates":
        return newUpdates.map((u) => u.data.rental?._id ?? u.data.package?._id ?? u.data.request?._id ?? u.data._id).filter(Boolean);
      case "pending":
        return [
          ...(fPending ?? []).map((r: any) => r.rental._id),
          ...pendingPkgRows.map((r: any) => r.key),
        ];
      case "packages":
        return (packages ?? []).map((p) => p.package._id);
      case "pickup":
        return [
          ...(fAwaiting ?? []).map((r: any) => r.rental._id),
          ...pickupPkgs.map((p) => p.package._id),
        ];
      case "active":
        return (fActive ?? []).map((r: any) => r.rental._id);
      case "projects":
        return (fOnProject ?? []).map((r: any) => r.rental._id);
      case "history":
        return (fHistory ?? []).map((r: any) => r.rental._id);
      case "ranks":
        return (rankReqs ?? []).map((e) => e.request._id);
      case "printers":
        return [...(printerReqs ?? []).map((e) => e.request._id), ...(inventoryReqs ?? []).map((e) => e.request._id)];
      case "profiles":
        return [...(profileReqs ?? []).map((e) => e.request._id), ...(unapproved ?? []).map((u) => u._id as string)];
      default:
        return [];
    }
  }, [tab, fPending, pendingPkgRows, packages, fAwaiting, pickupPkgs, fActive, fOnProject, fHistory, rankReqs, printerReqs, inventoryReqs, profileReqs, unapproved, newUpdates]);
  const allSelected = currentTabIds.length > 0 && currentTabIds.every((id) => selected.has(id));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (currentTabIds.every((id) => prev.has(id))) {
        const next = new Set(prev);
        for (const id of currentTabIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...currentTabIds]);
    });
  };
  const seen = (key: string) => {
    markSeen({ keys: [key] }).catch(() => undefined);
  };

  // ---- What KIND of thing is each selected id? ---------------------------
  // The bulk bar shows only actions that make sense for what's actually
  // selected (any tab): Delete is always offered; Approve/Deny appear when a
  // pending request is selected; Mark picked up when an approved item is;
  // Return when an active one is. Package ids are classified by bundle unit
  // statuses; rank/printer/profile ids by their pending request lists.
  const selStatus = useMemo(() => {
    const pkgById = new Map<string, any>((packages ?? []).map((p) => [String(p.package._id), p]));
    const rankIds = new Set<string>((rankReqs ?? []).map((e) => String(e.request._id)));
    const printerIds = new Set<string>((printerReqs ?? []).map((e) => String(e.request._id)));
    const profileIds = new Set<string>((profileReqs ?? []).map((e) => String(e.request._id)));
    const inventoryIds = new Set<string>((inventoryReqs ?? []).map((e) => String(e.request._id)));
    const signupIds = new Set<string>((unapproved ?? []).map((u) => String(u._id)));
    const rentalStatus = new Map<string, string>();
    for (const r of [
      ...(pendingRowsQ ?? []),
      ...(awaiting ?? []),
      ...(active ?? []),
      ...(onProject ?? []),
      ...(history ?? []),
    ] as any[]) {
      const id = r.rental?._id ?? r.key;
      if (id) rentalStatus.set(String(id), r.rental?.status ?? "pending");
    }
    let pending = 0,
      approved = 0,
      activeSel = 0,
      other = 0,
      person = 0;
    for (const id of selected) {
      if (rankIds.has(id) || printerIds.has(id) || profileIds.has(id) || inventoryIds.has(id) || signupIds.has(id)) {
        person++;
        // Person requests are themselves PENDING decisions — they must light
        // up the Approve/Deny bulk buttons like rental requests do.
        pending++;
        continue;
      }
      const pkg = pkgById.get(id);
      if (pkg) {
        const units = (pkg.lines ?? []).flatMap((l: any) => l.units ?? []);
        if (units.some((u: any) => u.status === "pending")) pending++;
        else if (units.some((u: any) => u.status === "approved")) approved++;
        else if (units.some((u: any) => u.status === "active")) activeSel++;
        else other++;
        continue;
      }
      const st = rentalStatus.get(id);
      if (st === "pending") pending++;
      else if (st === "approved") approved++;
      else if (st === "active" || st === "on_project") activeSel++;
      else other++;
    }
    return { pending, approved, active: activeSel, other, person };
  }, [selected, packages, rankReqs, printerReqs, profileReqs, inventoryReqs, unapproved, pendingRowsQ, awaiting, active, onProject, history]);

  // Whole-package card (bundle-level receipt, like the per-unit rent card).
  const [pkgCard, setPkgCard] = useState<PackageCardData | null>(null);
  const pkgCardFor = (p: any): PackageCardData => {
    // Best available per-unit dates (unit records carry the lend window).
    const unitDates = (p.lines ?? []).flatMap((l: any) => l.units ?? []).reduce(
      (acc: { pickedUpAt?: number; returnedAt?: number; dueAt?: number }, u: any) => ({
        pickedUpAt: acc.pickedUpAt ?? u.pickedUpAt,
        returnedAt: acc.returnedAt ?? u.returnedAt,
        dueAt: acc.dueAt ?? u.dueAt,
      }),
      {},
    );
    const lines =
      p.lines && p.lines.length > 0
        ? p.lines.map((l: any) => ({
            groupName: l.groupName ?? "Unit",
            units: (l.units ?? []).map((u: any) => ({ tag: u.tag ?? "—", status: String(u.status ?? "") })),
          }))
        : Object.entries(
            (p.units ?? []).reduce((acc: Record<string, { tag: string; status: string }[]>, u: any) => {
              const g = u.groupName ?? "Unit";
              (acc[g] ??= []).push({ tag: u.tag ?? "—", status: String(u.status ?? "") });
              return acc;
            }, {}),
          ).map(([groupName, units]) => ({ groupName, units }));
    return {
      packageId: p.package._id,
      lines,
      holderName: p.requester?.name ?? p.student?.name ?? p.requester?.email ?? p.student?.email ?? "Member",
      studentId: p.requester?.studentId ?? p.student?.studentId,
      statusLabel: p.package.status,
      requestedAt: p.package.requestedAt,
      decidedAt: p.package.decidedAt,
      pickupAt: p.package.pickupAt,
      // Bundle-level dates written by pickup/return + admin date edits.
      pickedUpAt: p.package.pickedUpAt ?? unitDates.pickedUpAt,
      returnedAt: p.package.returnedAt ?? unitDates.returnedAt,
      dueAt: p.package.dueAt ?? unitDates.dueAt,
      note: p.package.note,
    };
  };

  // ---- Clear history (History tab) ----
  // Independent categories — nothing is deleted unless it is ticked here, and
  // the confirm button stays disabled until at least one thing is selected.
  const [delProcessed, setDelProcessed] = useState(false);
  const [delLive, setDelLive] = useState(false);
  const [clearRelease, setClearRelease] = useState(false);
  const [delNotifs, setDelNotifs] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const anyClearSelected = delProcessed || delLive || delNotifs;
  const clearNotifications = useMutation(api.notifications.clearAllNotifications);
  const submitClearHistory = async () => {
    if (!anyClearSelected) return;
    setClearBusy(true);
    try {
      let notifNote = "";
      if (delNotifs) {
        const n = await clearNotifications();
        notifNote = `${n.cleared} notification(s)`;
      }
      let deleted = 0;
      let packagesDeleted = 0;
      if (delProcessed || delLive) {
        const res = await clearHistory({
          includeLive: delLive,
          releaseUnits: delLive ? clearRelease : undefined,
          confirm: "DELETE",
        });
        deleted = res.deleted;
        packagesDeleted = res.packagesDeleted;
      }
      const parts: string[] = [];
      if (deleted || packagesDeleted) {
        parts.push(
          `Cleared ${deleted} rental record(s)${packagesDeleted ? ` and ${packagesDeleted} empty package row(s)` : ""}`,
        );
      }
      if (notifNote) parts.push(`Cleared ${notifNote}`);
      toast.success(parts.join(" · ") || "Nothing selected");
      setDelProcessed(false);
      setDelLive(false);
      setClearRelease(false);
      setDelNotifs(false);
      setClearOpen(false);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setClearBusy(false);
    }
  };

  // Whole-package return from the Packages tab (admin one-click).
  const [wholeFor, setWholeFor] = useState<any | null>(null);
  const [wholeBusy, setWholeBusy] = useState(false);
  const [wholeDestination, setWholeDestination] = useState<"shelf" | "project" | "transferred">("shelf");
  const [wholeFunctional, setWholeFunctional] = useState(true);
  const [wholeReport, setWholeReport] = useState("");
  const [wholeProjectId, setWholeProjectId] = useState("");
  const [wholeCreatingProject, setWholeCreatingProject] = useState(false);
  const [wholeNewProjectName, setWholeNewProjectName] = useState("");
  const [wholeTransferName, setWholeTransferName] = useState("");
  const [wholeTransferDetails, setWholeTransferDetails] = useState("");
  // Official transfer documentation (photo/PDF) — optional but important.
  // Attached to EVERY unit record of the bundle when processed.
  const [wholeTransferDoc, setWholeTransferDoc] = useState<AttachedDoc | null>(null);
  const createProject = useMutation(api.projects.upsertProject);

  const wholeValid =
    wholeDestination === "shelf"
      ? true
      : wholeDestination === "transferred"
        ? wholeTransferName.trim().length > 1
        : wholeCreatingProject
          ? wholeNewProjectName.trim().length > 1
          : Boolean(wholeProjectId);

  const submitWholeReturn = async () => {
    if (!wholeFor || !wholeValid) return;
    setWholeBusy(true);
    try {
      let target = wholeProjectId;
      if (wholeDestination === "project" && wholeCreatingProject) {
        target = await createProject({ name: wholeNewProjectName.trim(), status: "active" });
      }
      const res = await returnWholePkg({
        packageId: wholeFor.package._id,
        destination: wholeDestination,
        projectId: wholeDestination === "project" ? (target as any) : undefined,
        functional: wholeFunctional,
        conditionReport: wholeReport.trim() || undefined,
        ...(wholeDestination === "transferred"
          ? {
              transferToName: wholeTransferName.trim(),
              transferDetails: wholeTransferDetails.trim() || undefined,
              transferDoc: wholeTransferDoc ?? undefined,
            }
          : {}),
      });
      toast.success(
        `${res.processed} unit(s) ${wholeDestination === "transferred" ? `transferred to “${wholeTransferName.trim()}”` : wholeDestination === "project" ? "assigned to the project" : wholeFunctional ? "back on the shelf" : "marked broken"}`,
      );
      setWholeFor(null);
      setWholeReport("");
      setWholeProjectId("");
      setWholeCreatingProject(false);
      setWholeNewProjectName("");
      setWholeTransferName("");
      setWholeTransferDetails("");
      setWholeTransferDoc(null);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setWholeBusy(false);
    }
  };

  const deny = async (row: Row) => {
    setBusyId(row.rental._id);
    try {
      await act({ rentalId: row.rental._id, action: "deny" });
      toast.success("Denied — unit back on shelf");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  // Approve opens the pick-up scheduling dialog (date+time is optional but
  // recommended — it drives the Telegram reminders and the group post).
  const submitApprove = async () => {
    if (!approveFor) return;
    setApproveBusy(true);
    try {
      const pickupAt = pickupLocal ? new Date(pickupLocal).getTime() : undefined;
      await act({
        rentalId: approveFor.rental._id,
        action: "approve",
        pickupAt: Number.isFinite(pickupAt as number) ? pickupAt : undefined,
      });
      toast.success(
        pickupLocal
          ? "Approved — pick-up scheduled, member and group notified with the PDF"
          : "Approved — member notified",
      );
      setApproveFor(null);
      setPickupLocal("");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setApproveBusy(false);
    }
  };

  // Return hand-over: schedule the meet-up (mirror of pick-up) and mark the
  // physical hand-back. Both notify the member + the club group.
  const submitMeetup = async () => {
    if (!meetupFor) return;
    setMeetupBusy(true);
    try {
      const meetupAt = meetupLocal ? new Date(meetupLocal).getTime() : undefined;
      await setReturnMeetupM({
        rentalId: meetupFor.rental._id,
        meetupAt: Number.isFinite(meetupAt as number) ? meetupAt : undefined,
      });
      toast.success(
        meetupLocal
          ? "Return hand-over scheduled — member and group notified"
          : "Return hand-over time cleared",
      );
      setMeetupFor(null);
      setMeetupLocal("");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setMeetupBusy(false);
    }
  };

  const markHandedOver = async (rentalId: string) => {
    try {
      await markReturnHandedOverM({ rentalId: rentalId as any });
      toast.success("Marked handed over — process the return now");
    } catch (e) {
      toast.error(asMessage(e));
    }
  };

  const decidePackageAction = async (approve: boolean) => {
    if (!approvePkgFor) return;
    setApproveBusy(true);
    try {
      const pickupAt = pickupLocal ? new Date(pickupLocal).getTime() : undefined;
      await decidePkg({
        packageId: approvePkgFor.key as any,
        approve,
        pickupAt: Number.isFinite(pickupAt as number) ? pickupAt : undefined,
      });
      toast.success(
        approve
          ? pickupLocal
            ? "Package approved — pick-up scheduled, member and group notified"
            : "Package approved — member notified"
          : "Package denied — units released",
      );
      setApprovePkgFor(null);
      setPickupLocal("");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setApproveBusy(false);
    }
  };

  const validReturn = useMemo(
    () =>
      destination === "shelf" || creatingProject
        ? true
        : destination === "project"
          ? Boolean(projectId) || newProjectName.trim().length > 1
          : destination === "transferred"
            ? transferName.trim().length > 1
            : false,
    [destination, projectId, creatingProject, newProjectName, transferName],
  );

  const submitReturn = async () => {
    if (!returnFor) return;
    setBusyId(returnFor.rental._id);
    try {
      // Bulk mode: apply the SAME one decision to every selected record —
      // packages route to returnWholePackage, individual records to their
      // per-record action. One failing row never stops the rest.
      if (bulkReturnIds) {
        const { rentals, bundles } = bulkReturnIds;
        let target = projectId;
        if (destination === "project" && creatingProject) {
          target = await createProject({ name: newProjectName.trim(), status: "active" });
        }
        const total = rentals.length + bundles.length;
        let ok = 0;
        for (const id of bundles) {
          try {
            await returnWholePkg({
              packageId: id as never,
              destination,
              projectId: destination === "project" ? (target as any) : undefined,
              functional,
              conditionReport: report.trim() || undefined,
              ...(destination === "transferred"
                ? {
                    transferToName: transferName.trim(),
                    transferDetails: transferDetails.trim() || undefined,
                    transferDoc: transferDoc ?? undefined,
                  }
                : {}),
            });
            ok++;
          } catch {
            /* one failing bundle doesn't stop the rest */
          }
        }
        for (const id of rentals) {
          try {
            if (destination === "project") {
              await act({
                rentalId: id as never,
                action: "assign_project",
                projectId: target as any,
                functional,
                conditionReport: report.trim() || undefined,
              });
            } else if (destination === "transferred") {
              await act({
                rentalId: id as never,
                action: "transfer",
                transferToName: transferName.trim(),
                transferDetails: transferDetails.trim() || undefined,
                transferDoc: transferDoc ?? undefined,
                functional,
                conditionReport: report.trim() || undefined,
              });
            } else {
              await act({
                rentalId: id as never,
                action: "mark_returned",
                functional,
                conditionReport: report.trim() || undefined,
              });
            }
            ok++;
          } catch {
            /* one failing record doesn't stop the rest */
          }
        }
        toast.success(
          `${ok} of ${total} ${
            destination === "project"
              ? "assigned to the project"
              : destination === "transferred"
                ? `transferred to “${transferName.trim()}”`
                : functional
                  ? "returned to the shelf"
                  : "marked broken"
          }`,
        );
        setBulkReturnIds(null);
        setReturnFor(null);
        setReport("");
        setProjectId("");
        setCreatingProject(false);
        setNewProjectName("");
        setTransferName("");
        setTransferDetails("");
        setTransferDoc(null);
        setRecovered("");
        return;
      }
      if (destination === "project") {
        let target = projectId;
        if (creatingProject) {
          target = await createProject({ name: newProjectName.trim(), status: "active" });
        }
        await act({
          rentalId: returnFor.rental._id,
          action: "assign_project",
          projectId: target as any,
          functional,
          conditionReport: report.trim() || undefined,
        });
        toast.success("Assigned to project — checked out until dismantled");
      } else if (destination === "transferred") {
        await act({
          rentalId: returnFor.rental._id,
          action: "transfer",
          transferToName: transferName.trim(),
          transferDetails: transferDetails.trim() || undefined,
          transferDoc: transferDoc ?? undefined,
          functional,
          conditionReport: report.trim() || undefined,
        });
        toast.success(`Transferred to “${transferName.trim()}” — kept on record`);
      } else {
        const taken = returnFor.rental.amount;
        const isBulkRow = returnFor.group?.measure === "weight" || returnFor.group?.measure === "length";
        const consumableRow = isBulkRow && taken !== undefined;
        const recoveredNum =
          consumableRow && recovered.trim() !== "" ? Number(recovered) : undefined;
        if (recoveredNum !== undefined) {
          if (!Number.isFinite(recoveredNum) || recoveredNum < 0) {
            toast.error(`Enter the recovered amount in ${returnFor.group?.measureUnit ?? "units"}`);
            setBusyId(null);
            return;
          }
          if (recoveredNum > taken + 1e-9) {
            toast.error(`Recovered cannot exceed the taken ${taken} ${returnFor.group?.measureUnit ?? ""}`);
            setBusyId(null);
            return;
          }
        }
        await act({
          rentalId: returnFor.rental._id,
          action: "mark_returned",
          functional,
          conditionReport: report.trim() || undefined,
          ...(recoveredNum !== undefined ? { recoveredAmount: recoveredNum } : {}),
        });
        toast.success(functional ? "Returned to shelf" : "Marked broken");
      }
      setReturnFor(null);
      setReport("");
      setProjectId("");
      setCreatingProject(false);
      setNewProjectName("");
      setTransferName("");
      setTransferDetails("");
      setTransferDoc(null);
      setRecovered("");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  // Build the printable rent-card data for any request row.
  const cardFor = (row: Row): CardRow => ({
    rentalId: row.rental._id,
    groupName: row.group?.name ?? "Part",
    tag: row.part?.tag ?? "—",
    containerChain: containerChainOf(row.group, groupsIndex ?? []) || undefined,
    holderName: row.student?.name ?? row.student?.email ?? "Member",
    studentId: row.student?.studentId || undefined,
    statusLabel: row.rental.status,
    requestedAt: row.rental.requestedAt,
    decidedAt: row.rental.decidedAt,
    pickedUpAt: row.rental.pickedUpAt,
    returnedAt: row.rental.returnedAt,
    dueAt: row.rental.dueAt,
    conditionReport: row.rental.conditionReport,
    amount: row.rental.amount,
    amountUnit: row.group?.measureUnit,
  });

  const RowCard = ({
    row,
    actions,
    selectable,
  }: {
    row: Row;
    actions: React.ReactNode;
    /** Show the multi-select checkbox (requests bulk actions). */
    selectable?: boolean;
  }) => (
    <li
      ref={row.rental._id === focusRentalId ? focusRef : undefined}
      className={cn(
        "flex flex-col gap-3 px-4 py-3 wide:flex-row wide:items-center",
        row.rental._id === focusRentalId && "rounded-lg ring-2 ring-primary/60",
      )}
    >
      {selectable && (
        <Checkbox
          checked={selected.has(row.rental._id)}
          onCheckedChange={() => toggleSel(row.rental._id)}
          aria-label={`Select ${row.group?.name ?? "request"}`}
          className="mt-0.5 shrink-0 self-start wide:self-center"
        />
      )}
      <Avatar className="size-8 shrink-0">
        <AvatarImage src={row.student?.image} />
        <AvatarFallback className="text-xs font-semibold">
          {(row.student?.name ?? row.student?.email ?? "?").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-medium">
          {row.group?.name ?? "Part"}
          <span className="font-mono text-xs text-muted-foreground">{row.part?.tag}</span>
        </p>
        {/* Individual rental or part of a package? Bundle members link
            straight to their package (highlighted there). */}
        {row.rental.packageId ? (
          <Link
            to={`/admin/requests?tab=packages&package=${row.rental.packageId}`}
            className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-violet-500/40 bg-gradient-to-b from-violet-500/25 to-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] transition-colors hover:from-violet-500/35 hover:to-violet-500/15"
            title="This unit belongs to a package — open it"
          >
            <Boxes className="size-3" /> Package
          </Link>
        ) : (
          <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border border-emerald-500/40 bg-gradient-to-b from-emerald-500/25 to-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]">
            Individual
          </span>
        )}
        <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className="break-words">{row.student?.name ?? row.student?.email ?? "Member"}</span>
          {row.student?.studentId ? <span className="whitespace-nowrap">· {row.student.studentId}</span> : null}
          <span className="whitespace-nowrap">· {new Date(row.rental.requestedAt).toLocaleDateString()}</span>
        </p>
        {/* Details/notes mirrored from the package (or request) ride on the
            part's own record so every unit shows the full context. */}
        {row.rental.note ? (
          <p className="mt-1 break-words text-xs text-muted-foreground">📝 {row.rental.note}</p>
        ) : null}
        {/* Broken-at-rent stays visible for the whole lifecycle: the unit was
            knowingly rented broken, and the return decides if it was fixed. */}
        {row.rental.rentBroken ? (
          <p className="mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5 text-[10px] font-semibold">
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-400">Rented while broken</span>
            {row.rental.status === "returned" && row.rental.functional === false ? (
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-400">Returned still broken</span>
            ) : null}
            {row.rental.status === "returned" && row.rental.functional === true ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400">Fixed on return</span>
            ) : null}
          </p>
        ) : null}
        {row.rental.status === "active" && row.rental.returnRequestedAt !== undefined && (
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-amber-500">
            <RotateCcw className="size-3.5 shrink-0" />
            Member asked to return this · {new Date(row.rental.returnRequestedAt).toLocaleString()}
            {row.rental.returnMeetupAt ? (
              <span className="text-sky-400">
                · 📅 hand-over{" "}
                {new Date(row.rental.returnMeetupAt).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            ) : null}
            {row.rental.returnHandedOverAt ? (
              <span className="text-emerald-400">· ✅ handed over</span>
            ) : null}
          </p>
        )}
      </div>
      {/* Actions wrap below the text on phones, sit to the right on ≥sm. */}
      <div className="flex flex-wrap items-center gap-1 wide:ml-auto wide:justify-end">
        <Button
          size="sm"
          variant="ghost"
          title="Print rent card"
          onClick={() => setCard(cardFor(row))}
        >
          <Printer className="size-3.5" /> Card
        </Button>
        {actions}
      </div>
    </li>
  );

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 wide:flex-row wide:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Requests & rentals</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve or deny requests, process returns, and track project assignments.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/rent-scan">
              <ScanLine className="size-4" /> Scan mode
            </Link>
          </Button>
        </header>

        {/* Search across everything + bulk action bar (like Inventory). */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Select-all for the active tab — mirrors Inventory/GroupDetail. */}
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleSelectAll}
            aria-label="Select all in this tab"
            title="Select all in this tab"
            className="ml-1"
          />
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search requests — part, tag, student, ID, status, date…"
              className="pl-8"
            />
          </div>
          {selected.size > 0 && (
            <>
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              {/* Contextual bulk actions driven by WHAT IS SELECTED (not the
                  tab): Delete is always offered; Approve/Deny appear when a
                  pending request is among the selection; Mark picked up when
                  an approved item is; Return when an active one is. That way
                  the bar works on every tab — Packages, Pick-up, Active,
                  Projects, History and Updates alike. */}
              {selStatus.pending > 0 && (
                <Button size="sm" disabled={bulkBusy} onClick={bulkApprove}>
                  {bulkBusy ? <LoadingGifInline size={16} className="size-4" /> : <Check className="size-4" />}
                  Approve selected
                </Button>
              )}
              {selStatus.approved > 0 && (
                <Button size="sm" variant="outline" disabled={bulkBusy} onClick={bulkMarkTaken} title="Hand over approved units/packages to their members">
                  {bulkBusy ? <LoadingGifInline size={16} className="size-4" /> : <PackageCheck className="size-4" />}
                  Mark picked up
                </Button>
              )}
              {selStatus.active > 0 && (
                <Button size="sm" variant="outline" disabled={bulkBusy} onClick={bulkReturn} title="Process the return of every selected active unit — same destination and condition for all">
                  {bulkBusy ? <LoadingGifInline size={16} className="size-4" /> : <RotateCcw className="size-4" />}
                  Return selected
                </Button>
              )}
              {selStatus.pending > 0 && (
                <Button size="sm" variant="outline" disabled={bulkBusy} onClick={bulkDeny}>
                  {bulkBusy ? <LoadingGifInline size={16} className="size-4" /> : <X className="size-4" />}
                  Deny selected
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={bulkBusy}
                onClick={async () => {
                  if (!confirm(`Delete ${selected.size} selected record(s)? The ledger rows are removed; every unit keeps its current state. Use Edit → Delete with “put everything back” to release units instead.`))
                    return;
                  setBulkBusy(true);
                  try {
                    const res = await bulkDeleteRecords({ rentalIds: [...selected] as never, alsoFreePart: false });
                    toast.success(
                      `Deleted ${res.deleted} record(s)${res.packagesDeleted ? ` · ${res.packagesDeleted} empty package row(s) swept` : ""}`,
                    );
                    setSelected(new Set());
                  } catch (e) {
                    toast.error(asMessage(e));
                  } finally {
                    setBulkBusy(false);
                  }
                }}
              >
                {bulkBusy ? <LoadingGifInline size={16} className="size-4" /> : <Trash2 className="size-4" />}
                Delete selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setClearOpen(true)}
            title="Clear processed rental history"
          >
            <History className="size-4" /> Clear history
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          {/* Mobile: tabs wrap into rows under each other and the BAR itself
              scrolls horizontally if a single row is still too wide — the
              page never scrolls sideways. Desktop: one clean row. */}
          {/* Tabs adapt to the window: the list wraps onto extra rows whenever a
              row would overflow, every trigger keeps its natural text width
              (flex-none beats the shared component's flex-1) and counts render
              as a separate chip so they never squeeze into the label. */}
          <TabsList className="colored-tabs flex h-auto max-w-full flex-wrap justify-start gap-1.5 p-1">
            <TabsTrigger value="updates" className="flex-none gap-1.5" style={tStyle("updates")}>
              <BellRing className="size-3.5" />
              Updates
              {newUpdates.length > 0 && <TabCount tab="updates" n={newUpdates.length} />}
            </TabsTrigger>
            <TabsTrigger value="pending" className="flex-none gap-1.5" style={tStyle("pending")}>
              Pending
              {pendingCount > 0 && <TabCount tab="pending" n={pendingCount} />}
            </TabsTrigger>
            <TabsTrigger value="packages" className="flex-none gap-1.5" style={tStyle("packages")}>
              Packages
              {pendingPkgCount > 0 && <TabCount tab="packages" n={pendingPkgCount} />}
            </TabsTrigger>
            <TabsTrigger value="pickup" className="flex-none gap-1.5" style={tStyle("pickup")}>
              Pick up
              {(awaiting?.length ?? 0) + pickupPkgCount > 0 && (
                <TabCount tab="pickup" n={(awaiting?.length ?? 0) + pickupPkgCount} />
              )}
            </TabsTrigger>
            <TabsTrigger value="active" className="flex-none gap-1.5" style={tStyle("active")}>
              Active
              {(active?.length ?? 0) > 0 && <TabCount tab="active" n={active?.length ?? 0} />}
            </TabsTrigger>
            <TabsTrigger value="projects" className="flex-none gap-1.5" style={tStyle("projects")}>
              On projects
              {(onProject?.length ?? 0) > 0 && <TabCount tab="projects" n={onProject?.length ?? 0} />}
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-none" style={tStyle("history")}>History</TabsTrigger>
            <TabsTrigger value="ranks" className="flex-none gap-1.5" style={tStyle("ranks")}>
              Ranks
              {(rankReqs?.length ?? 0) > 0 && <TabCount tab="ranks" n={rankReqs?.length ?? 0} />}
            </TabsTrigger>
            <TabsTrigger value="printers" className="flex-none gap-1.5" style={tStyle("printers")}>
              Printer
              {(printerReqs?.length ?? 0) + (inventoryReqs?.length ?? 0) > 0 && (
                <TabCount tab="printers" n={(printerReqs?.length ?? 0) + (inventoryReqs?.length ?? 0)} />
              )}
            </TabsTrigger>
            <TabsTrigger value="profiles" className="flex-none gap-1.5" style={tStyle("profiles")}>
              Profiles
              {(profileReqs?.length ?? 0) + (unapproved?.length ?? 0) > 0 && (
                <TabCount tab="profiles" n={(profileReqs?.length ?? 0) + (unapproved?.length ?? 0)} />
              )}
            </TabsTrigger>
          </TabsList>

          {/* Updates — the notification inbox for the whole console. Shows every
              NEW request of every kind; acting on a row (or marking it seen)
              removes it from here while it stays in its dedicated tab. */}
          <TabsContent value="updates" className="mt-4">
            {newUpdates.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
                <Inbox className="size-8 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">No new requests — everything is processed ✨</p>
                <Button size="sm" variant="ghost" onClick={() => setTab("pending")}>
                  Open pending queue
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {newUpdates.length} new · acting on a row removes it from this feed (it stays in its own tab)
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markSeen({ keys: newUpdates.map((u) => u.key) }).catch(() => undefined)}
                  >
                    <Check className="size-4" /> Mark all seen
                  </Button>
                </div>
                <ul className="flex flex-col gap-3">
                  {newUpdates.map((u) => (
                    <li key={u.key} className="glass-3d rounded-lg border border-primary/30 p-4">
                      <div className="flex flex-col gap-3 wide:flex-row wide:items-center">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                        {u.kind === "package" ? (
                          <Boxes className="size-5 shrink-0 text-primary" />
                        ) : u.kind === "rank" ? (
                          <Award className="size-5 shrink-0 text-amber-500" />
                        ) : u.kind === "printer" ? (
                          <Printer className="size-5 shrink-0 text-sky-500" />
                        ) : u.kind === "inventory" ? (
                          <Warehouse className="size-5 shrink-0 text-amber-400" />
                        ) : u.kind === "profile" || u.kind === "signup" ? (
                          <IdCard className="size-5 shrink-0 text-violet-500" />
                        ) : (
                          <ScanLine className="size-5 shrink-0 text-primary" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-sm font-medium">
                            {u.kind === "single" && (
                              <>
                                <span className="break-words">{u.data.student?.name ?? "Member"} requested</span>
                                <span className="break-words">{u.data.group?.name ?? "a part"}</span>
                                <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{u.data.part?.tag ?? "—"}</span>
                              </>
                            )}
                            {u.kind === "package" && (
                              <>
                                <span className="break-words">{u.data.requester?.name ?? "Member"} requested a package</span>
                                <span className="whitespace-nowrap">· {u.data.lines.reduce((n: number, l: any) => n + l.units.length, 0)} unit(s)</span>
                              </>
                            )}
                            {u.kind === "rank" && (
                              <>
                                <span className="break-words">{u.data.user?.name ?? "Member"} requests:</span>
                                {u.data.request.requestedRoles?.map((r: string) => (
                                  <span key={r} className="whitespace-nowrap">{r}</span>
                                ))}
                              </>
                            )}
                            {u.kind === "printer" && (
                              <span className="break-words">{u.data.user?.name ?? "Member"} requests printer access</span>
                            )}
                            {u.kind === "inventory" && (
                              <span className="break-words">{u.data.user?.name ?? "Member"} requests inventory manager access</span>
                            )}
                            {u.kind === "profile" && (
                              <span className="break-words">{u.data.user?.name ?? "Member"} requests profile changes</span>
                            )}
                            {u.kind === "signup" && (
                              <span className="break-words">{u.data.name ?? u.data.email ?? "A member"} awaits profile approval</span>
                            )}
                          </p>
                          <p className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                            <span className="whitespace-nowrap uppercase tracking-wide">{u.kind}</span>
                            <span className="whitespace-nowrap">· {new Date(u.at).toLocaleString()}</span>
                          </p>
                        </div>
                        </div>
                        <div className="flex flex-wrap gap-2 wide:ml-auto">
                          {u.kind === "single" && (
                            <>
                              <Button size="sm" onClick={() => { setApproveFor(u.data as Row); setPickupLocal(""); }}>
                                <Check className="size-4" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => deny(u.data as Row)}>
                                <X className="size-4" /> Deny
                              </Button>
                            </>
                          )}
                          {u.kind === "package" && (
                            <>
                              <Button size="sm" onClick={() => { setApprovePkgFor({ key: u.data.package._id, unitCount: u.data.lines.reduce((n: number, l: any) => n + l.units.length, 0) }); setPickupLocal(""); }}>
                                <Check className="size-4" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setApprovePkgFor({ key: u.data.package._id, unitCount: u.data.lines.reduce((n: number, l: any) => n + l.units.length, 0) })}>
                                <X className="size-4" /> Deny
                              </Button>
                            </>
                          )}
                          {u.kind === "package" && u.data.package.status === "approved" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                              onClick={async () => {
                                try {
                                  const res = await markPkgTaken({ packageId: u.data.package._id });
                                  toast.success(`Package picked up — ${res.taken} unit(s) handed over`);
                                } catch (e) {
                                  toast.error(asMessage(e));
                                }
                              }}
                            >
                              <PackageCheck className="size-4" /> Mark picked up
                            </Button>
                          )}
                          {u.kind === "rank" && (
                            <>
                              <Button size="sm" onClick={async () => { try { await decideRank({ id: u.data.request._id, approve: true }); toast.success("Rank granted"); } catch (e) { toast.error(asMessage(e)); } }}>
                                <Check className="size-4" /> Grant
                              </Button>
                              <Button size="sm" variant="outline" onClick={async () => { try { await decideRank({ id: u.data.request._id, approve: false }); toast.success("Request denied"); } catch (e) { toast.error(asMessage(e)); } }}>
                                <X className="size-4" />
                              </Button>
                            </>
                          )}
                          {u.kind === "printer" && (
                            <>
                              <Button size="sm" onClick={async () => { try { await decidePrinter({ id: u.data.request._id, approve: true }); toast.success("Printer access granted"); } catch (e) { toast.error(asMessage(e)); } }}>
                                <Check className="size-4" /> Grant
                              </Button>
                              <Button size="sm" variant="outline" onClick={async () => { try { await decidePrinter({ id: u.data.request._id, approve: false }); toast.success("Request denied"); } catch (e) { toast.error(asMessage(e)); } }}>
                                <X className="size-4" />
                              </Button>
                            </>
                          )}
                          {u.kind === "inventory" && (
                            <>
                              <Button size="sm" onClick={async () => { try { await decideInventory({ id: u.data.request._id, approve: true }); toast.success("Inventory manager access granted"); } catch (e) { toast.error(asMessage(e)); } }}>
                                <Check className="size-4" /> Grant
                              </Button>
                              <Button size="sm" variant="outline" onClick={async () => { try { await decideInventory({ id: u.data.request._id, approve: false }); toast.success("Request denied"); } catch (e) { toast.error(asMessage(e)); } }}>
                                <X className="size-4" />
                              </Button>
                            </>
                          )}
                          {(u.kind === "profile" || u.kind === "signup") && (
                            <Button size="sm" variant="outline" onClick={() => setTab("profiles")}>
                              Review in Profiles
                            </Button>
                          )}
                          {/* No action? just dismiss from the feed. */}
                          <Button size="sm" variant="ghost" title="Mark seen (stays in its own tab)" onClick={() => seen(u.key)}>
                            <Check className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </TabsContent>

          <TabsContent value="pending" className="mt-4">
            {/* Scheduled pick-ups: awaiting handover, with reminder countdown. */}
            {(pickups ?? []).length > 0 && (
              <div className="mb-4 glass-3d rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">
                  Scheduled pick-ups · {(pickups ?? []).length}
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {(pickups ?? []).map((p) => (
                    <li key={p.rentalId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-medium">{p.groupName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.tag}</span>
                      <span className="text-muted-foreground">· {p.studentName}</span>
                      <span className="text-amber-400">
                        · {p.pickupAt ? new Date(p.pickupAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "no time set"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Members are reminded 24h and 1h before. Mark them as taken from the Active tab or
                  by scanning the unit.
                </p>
              </div>
            )}
            {pendingRowsQ === undefined ? (
              <LoadingGif size={48} label={null} />
            ) : pendingRows.length === 0 && pendingPkgRows.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No pending requests — all clear ✨
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {(fPending ?? []).map((row: any) => (
                  <RowCard
                    key={row.key}
                    row={row as Row}
                    selectable
                    actions={
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditRentalFor(row.rental)}
                          title="Edit or delete this record"
                        >
                          <SquarePen className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyId === row.key}
                          onClick={() => {
                            setApproveFor(row as Row);
                            setPickupLocal("");
                          }}
                        >
                          <Check className="size-4" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === row.key}
                          onClick={() => deny(row as Row)}
                        >
                          <X className="size-4" /> Deny
                        </Button>
                      </div>
                    }
                  />
                ))}
                {pendingPkgRows.map((row: any) => (
                  <li key={row.key} className="glass-3d rounded-lg border border-primary/30 p-4">
                    {/* Column on phones, row on ≥sm — like the People list. */}
                    <div className="flex flex-col gap-3 wide:flex-row wide:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Boxes className="size-5 shrink-0 text-primary" />
                        <Avatar className="size-8 shrink-0">
                          <AvatarImage src={row.student?.image} />
                          <AvatarFallback className="text-xs font-semibold">
                            {(row.student?.name ?? row.student?.email ?? "?").slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-sm font-medium">
                            <span className="whitespace-nowrap">Package · {row.units.length} unit(s)</span>
                            {row.packageNote ? <span className="break-words">· “{row.packageNote}”</span> : null}
                          </p>
                          <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                            {Array.from(new Set<string>(row.units.map((u: any) => String(u.groupName)))).map((gn) => (
                              <span key={gn} className="break-words">{gn}</span>
                            ))}
                            <span className="whitespace-nowrap">· {new Date(row.package.requestedAt).toLocaleString()}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 wide:ml-auto">
                        {packages?.some((p) => p.package._id === row.key) && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              title="Print the whole-package card"
                              onClick={() => {
                                const full = packages?.find((p) => p.package._id === row.key);
                                if (full) setPkgCard(pkgCardFor(full));
                              }}
                            >
                              <Printer className="size-4" /> Card
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              title="Edit this package request"
                              onClick={() => {
                                const full = packages?.find((p) => p.package._id === row.key);
                                if (full) setEditPkgFor(full);
                              }}
                            >
                              <SquarePen className="size-4" /> Edit
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          disabled={approveBusy}
                          onClick={() => {
                            setApprovePkgFor({ key: row.key, unitCount: row.units.length });
                            setPickupLocal("");
                          }}
                        >
                          <Check className="size-4" /> Approve all
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={approveBusy}
                          onClick={() => {
                            setApprovePkgFor({ key: row.key, unitCount: row.units.length });
                            setPickupLocal("");
                          }}
                        >
                          <X className="size-4" /> Deny
                        </Button>
                      </div>
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                      {row.units.map((u: any) => (
                        <li key={u.rentalId}>
                          <button
                            type="button"
                            onClick={() => setEditRentalFor({ ...u, _id: u.rentalId })}
                            title="Edit or delete this record"
                            className="rounded border px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                          >
                            {u.tag ?? "?"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="packages" className="mt-4">
            {packages === undefined ? (
              <LoadingGif size={48} label={null} />
            ) : packages.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No package rentals yet — members bundle multiple items from a group page.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {(fPackages ?? []).map(({ package: pkg, lines, requester, openUnits, totalUnits, returnedUnits, approvedUnits, activeUnits }) => {
                  // Truthful badge: derived from the unit stages, not the frozen
                  // stored status — a fully returned package must not read
                  // "Active" forever.
                  const pkgStatus = packageDisplayStatus(pkg.status, { approvedUnits, activeUnits, returnedUnits });
                  return (
                  <li
                    key={pkg._id}
                    ref={pkg._id === focusPackageId ? focusRef : undefined}
                    className={cn(
                      "glass-3d rounded-lg border p-4",
                      pkg._id === focusPackageId && "ring-2 ring-primary/60",
                    )}
                  >
                    {/* Column on phones, row on ≥sm — text never squeezes
                        into the buttons/badge, chips wrap onto their own line. */}
                    <div className="flex flex-col gap-3 wide:flex-row wide:items-center">
                      {/* Bundle-level multi-select (bulk pick-up/return/delete). */}
                      <Checkbox
                        checked={selected.has(pkg._id)}
                        onCheckedChange={() => toggleSel(pkg._id)}
                        aria-label="Select package"
                        className="shrink-0 self-start wide:self-center"
                      />
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Boxes className="size-5 shrink-0 text-primary" />
                      <Avatar className="size-8 shrink-0">
                        <AvatarImage src={requester?.image} />
                        <AvatarFallback className="text-xs font-semibold">
                          {(requester?.name ?? requester?.email ?? "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-sm font-medium">
                          {lines.map((l: any) => (
                            <span key={l.groupId} className="break-words">
                              {formatLineAmount(l, groupsIndex?.find((g: any) => g._id === l.groupId))} {l.groupName}
                            </span>
                          ))}
                        </p>
                        <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="break-words">{requester?.name ?? requester?.email ?? "Member"}</span>
                          {requester?.studentId ? <span className="whitespace-nowrap">· {requester.studentId}</span> : null}
                          <span className="whitespace-nowrap">· {new Date(pkg.requestedAt).toLocaleString()}</span>
                          <span className="whitespace-nowrap">· {totalUnits} unit(s)</span>
                          {pkg.status === "approved" ? (
                            <span className="whitespace-nowrap">· {openUnits} out, {returnedUnits} processed</span>
                          ) : null}
                          {pkg.note ? <span className="break-words">· “{pkg.note}”</span> : null}
                        </p>
                        {pkg.status === "approved" && pkg.returnRequestedAt !== undefined && (
                          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-amber-500">
                            <RotateCcw className="size-3.5 shrink-0" />
                            Member asked to return this package ·{" "}
                            {new Date(pkg.returnRequestedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      </div>
                      {pkg.status === "pending" ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            title="Edit this package request"
                            onClick={() => setEditPkgFor({ package: pkg, lines, requester })}
                          >
                            <SquarePen className="size-4" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            disabled={approveBusy}
                            onClick={() => {
                              setApprovePkgFor({ key: pkg._id, unitCount: totalUnits });
                              setPickupLocal("");
                            }}
                          >
                            <Check className="size-4" /> Approve all
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={approveBusy}
                            onClick={() => {
                              setApprovePkgFor({ key: pkg._id, unitCount: totalUnits });
                              setPickupLocal("");
                            }}
                          >
                            <X className="size-4" /> Deny
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            title="Print the whole-package card — every unit listed on one receipt"
                            onClick={() => setPkgCard(pkgCardFor({ package: pkg, lines, requester }))}
                          >
                            <Printer className="size-4" /> Card
                          </Button>
                          {pkg.status === "approved" && (
                          <Button
                            size="sm"
                            variant="outline"
                            title="Edit this package record — add or release units, fix note and pick-up"
                            onClick={() => setEditPkgFor({ package: pkg, lines, requester })}
                          >
                            <SquarePen className="size-4" /> Edit
                          </Button>
                          )}
                          {pkg.status === "approved" && approvedUnits > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                              disabled={busyId === pkg._id}
                              onClick={async () => {
                                setBusyId(pkg._id);
                                try {
                                  const res = await markPkgTaken({ packageId: pkg._id });
                                  toast.success(`Package picked up — ${res.taken} unit(s) handed over`);
                                } catch (e) {
                                  toast.error(asMessage(e));
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              title="Hand every still-pending unit of this package to the member"
                            >
                              <PackageCheck className="size-4" /> Mark all picked up
                            </Button>
                          )}
                          {pkg.status === "approved" && openUnits > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                              disabled={busyId === pkg._id}
                              onClick={() => {
                                setWholeFor({ package: pkg });
                                setWholeDestination("shelf");
                                setWholeFunctional(true);
                                setWholeReport("");
                                setWholeProjectId("");
                                setWholeCreatingProject(false);
                                setWholeNewProjectName("");
                                // Transfer fields too — a dialog opened for
                                // another package must never inherit the
                                // previous transfer's destination or doc.
                                setWholeTransferName("");
                                setWholeTransferDetails("");
                                setWholeTransferDoc(null);
                              }}
                            >
                              <RotateCcw className="size-4" /> Return all units
                            </Button>
                          )}
                          <StatusBadge status={pkgStatus} />
                        </div>
                      )}
                    </div>
                    <ul className="mt-3 flex flex-col gap-1 border-t pt-3">
                      {lines.map((l: any) =>
                        l.units.length === 0 ? (
                          <li key={l.groupId} className="text-xs text-muted-foreground">
                            {l.groupName}: no units attached yet
                          </li>
                        ) : (
                          l.units.map((u: any) => (
                            <li key={u.rentalId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                              {/* The unit's tag IS the link: tap it to open the
                                  part's own page. */}
                              {u.partId ? (
                                <Link
                                  to={`/part/${u.partId}`}
                                  className="whitespace-nowrap font-mono text-foreground underline-offset-2 hover:text-primary hover:underline"
                                  title="Open this unit's page"
                                >
                                  {u.tag}
                                </Link>
                              ) : (
                                <span className="whitespace-nowrap font-mono">{u.tag}</span>
                              )}
                              {/* What it is + where it lives, so the ID alone
                                  never forces a lookup. */}
                              <span className="min-w-0 break-words text-[11px] text-muted-foreground">
                                {l.groupName}
                                {u.brand ? ` · ${u.brand}` : ""}
                                {u.model ? ` ${u.model}` : ""}
                                {u.containerPath ? ` · 📦 ${u.containerPath}` : ""}
                                {u.closetName ? ` · 🗄 ${u.closetName}` : ""}
                              </span>
                              <StatusBadge status={u.status} />
                              {u.rentBroken && (
                                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
                                  broken
                                </span>
                              )}
                              {u.status === "active" && u.returnRequestedAt !== undefined && (
                                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
                                  return asked
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 gap-1 px-2 text-[11px]"
                                title="Print rent card"
                                onClick={() =>
                                  setCard({
                                    rentalId: u.rentalId,
                                    groupName: l.groupName,
                                    tag: u.tag ?? "—",
                                    holderName: requester?.name ?? requester?.email ?? "Member",
                                    studentId: requester?.studentId || undefined,
                                    statusLabel: u.status,
                                  })
                                }
                              >
                                <Printer className="size-3" /> Card
                              </Button>
                              {(u.status === "active" || u.status === "on_project") && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 gap-1 px-2 text-[11px]"
                                  title="Edit or delete this record"
                                  onClick={() => setEditRentalFor({ ...u, _id: u.rentalId })}
                                >
                                  <SquarePen className="size-3.5" />
                                </Button>
                              )}
                              {u.status === "active" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="ml-auto h-6 gap-1 px-2 text-[11px]"
                                  disabled={busyId === u.rentalId}
                                  onClick={() => {
                                    // Reuse the shared per-unit return dialog:
                                    // every unit of a package is decided
                                    // individually (shelf / project / broken).
                                    setReturnFor({
                                      rental: { _id: u.rentalId, rentBroken: u.rentBroken },
                                      part: { tag: u.tag },
                                      group: { name: l.groupName },
                                      student: requester,
                                    } as Row);
                                    setDestination("shelf");
                                    // A unit rented broken defaults to "needs
                                    // repair" — it only leaves that state when
                                    // the admin explicitly marks it fixed.
                                    setFunctional(!u.rentBroken);
                                    setReport("");
                                    setProjectId("");
                                    setCreatingProject(false);
                                    setNewProjectName("");
                                    setTransferName("");
                                    setTransferDetails("");
                                    setTransferDoc(null);
                                    setRecovered("");
                                  }}
                                >
                                  <RotateCcw className="size-3" /> Return
                                </Button>
                              )}
                            </li>
                          ))
                        ),
                      )}
                    </ul>
                  </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          {/* Pick-up — everything approved and waiting for the physical
              hand-over, in one place: single records and whole packages
              (packages stay collapsed as one row for easy navigation). */}
          <TabsContent value="pickup" className="mt-4">
            {fAwaiting === undefined || packages === undefined ? (
              <LoadingGif size={48} label={null} />
            ) : fAwaiting.length === 0 && pickupPkgs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
                <PackageCheck className="size-8 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">Nothing is waiting for pick-up — all clear ✨</p>
              </div>
            ) : (
              <>
                {fAwaiting.length > 0 && (
                  <section className="mb-5">
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-amber-400">
                      Single units · {fAwaiting.length}
                    </h2>
                    <ul className="divide-y glass-3d rounded-lg border border-amber-500/30">
                      {fAwaiting.map((row) => (
                        <RowCard
                          key={row.rental._id}
                          row={row as Row}
                          selectable
                          actions={
                            <div className="flex flex-col items-end gap-1">
                              {row.rental.pickupAt && (
                                <span className="text-[11px] text-amber-400">
                                  📅 {new Date(row.rental.pickupAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditRentalFor(row.rental)}
                                title="Edit or delete this record"
                              >
                                <SquarePen className="size-4" />
                              </Button>
                              <Button
                                size="sm"
                                disabled={busyId === row.rental._id}
                                onClick={async () => {
                                  setBusyId(row.rental._id);
                                  try {
                                    await act({ rentalId: row.rental._id, action: "mark_taken" });
                                    toast.success("Marked as picked up — unit is now rented");
                                  } catch (e) {
                                    toast.error(asMessage(e));
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                              >
                                <Check className="size-4" /> Mark picked up
                              </Button>
                            </div>
                          }
                        />
                      ))}
                    </ul>
                  </section>
                )}
                {pickupPkgs.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-amber-400">
                      Packages · {pickupPkgs.length}
                    </h2>
                    <ul className="flex flex-col gap-3">
                      {pickupPkgs.map(({ package: pkg, lines, requester, totalUnits }) => (
                        <li
                          key={pkg._id}
                          ref={pkg._id === focusPackageId ? focusRef : undefined}
                          className={cn(
                            "glass-3d rounded-lg border border-amber-500/30 p-4",
                            pkg._id === focusPackageId && "ring-2 ring-primary/60",
                          )}
                        >
                          <div className="flex flex-col gap-3 wide:flex-row wide:items-center">
                            <Checkbox
                              checked={selected.has(pkg._id)}
                              onCheckedChange={() => toggleSel(pkg._id)}
                              aria-label="Select package"
                              className="shrink-0 self-start wide:self-center"
                            />
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <Boxes className="size-5 shrink-0 text-primary" />
                              <Avatar className="size-8 shrink-0">
                                <AvatarImage src={requester?.image} />
                                <AvatarFallback className="text-xs font-semibold">
                                  {(requester?.name ?? requester?.email ?? "?").slice(0, 1).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-sm font-medium">
                                  {lines.map((l: any) => (
                                    <span key={l.groupId} className="break-words">
                                      {formatLineAmount(l, groupsIndex?.find((g: any) => g._id === l.groupId))} {l.groupName}
                                    </span>
                                  ))}
                                </p>
                                <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                                  <span className="break-words">{requester?.name ?? requester?.email ?? "Member"}</span>
                                  {requester?.studentId ? <span className="whitespace-nowrap">· {requester.studentId}</span> : null}
                                  <span className="whitespace-nowrap">· {totalUnits} unit(s)</span>
                                  {pkg.pickupAt ? (
                                    <span className="whitespace-nowrap">
                                      · 📅 {new Date(pkg.pickupAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                                    </span>
                                  ) : null}
                                  {pkg.note ? <span className="break-words">· “{pkg.note}”</span> : null}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 wide:ml-auto">
                              <Button
                                size="sm"
                                variant="outline"
                                title="Print the whole-package card — every unit listed on one receipt"
                                onClick={() => setPkgCard(pkgCardFor({ package: pkg, lines, requester }))}
                              >
                                <Printer className="size-4" /> Card
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                title="Edit this package record"
                                onClick={() => setEditPkgFor({ package: pkg, lines, requester })}
                              >
                                <SquarePen className="size-4" /> Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                                disabled={busyId === pkg._id}
                                onClick={async () => {
                                  setBusyId(pkg._id);
                                  try {
                                    const res = await markPkgTaken({ packageId: pkg._id });
                                    toast.success(`Package picked up — ${res.taken} unit(s) handed over`);
                                  } catch (e) {
                                    toast.error(asMessage(e));
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                              >
                                <Check className="size-4" /> Mark picked up
                              </Button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="active" className="mt-4">
            {fActive === undefined ? (
              <LoadingGif size={48} label={null} />
            ) : fActive.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                Nothing is out on rental right now.
              </p>
            ) : (
              <ul className="divide-y glass-3d rounded-lg border">
                {(fActive ?? []).map((row) => (
                  <RowCard
                    key={row.rental._id}
                    row={row as Row}
                    selectable
                    actions={
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditRentalFor(row.rental)} title="Edit or delete this record">
                          <SquarePen className="size-4" />
                        </Button>
                        {row.rental.returnRequestedAt !== undefined && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              title={
                                row.rental.returnMeetupAt
                                  ? "Change the return hand-over date"
                                  : "Set the return hand-over date"
                              }
                              onClick={() => {
                                setMeetupFor(row as Row);
                                if (row.rental.returnMeetupAt) {
                                  const d = new Date(row.rental.returnMeetupAt);
                                  const pad = (n: number) => String(n).padStart(2, "0");
                                  setMeetupLocal(
                                    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                                  );
                                } else {
                                  setMeetupLocal("");
                                }
                              }}
                            >
                              <CalendarClock className="size-4" />
                              {row.rental.returnMeetupAt ? "Return date" : "Set return date"}
                            </Button>
                            {row.rental.returnMeetupAt && row.rental.returnHandedOverAt === undefined && (
                              <Button
                                size="sm"
                                title="Mark the item physically handed back — this unlocks the normal return processing"
                                onClick={() => void markHandedOver(row.rental._id)}
                              >
                                <PackageCheck className="size-4" /> Handed over
                              </Button>
                            )}
                          </>
                        )}
                        <Button size="sm" variant="outline" onClick={() => {
                        setReturnFor(row as Row);
                        setDestination("shelf");
                        // A unit rented broken defaults to "needs repair" —
                        // it only leaves that state when explicitly fixed.
                        setFunctional(!(row.rental?.rentBroken ?? false));
                        setReport("");
                        setProjectId("");
                        setCreatingProject(false);
                        setNewProjectName("");
                        setTransferName("");
                        setTransferDetails("");
                        setTransferDoc(null);
                        setRecovered("");
                      }}>
                        <RotateCcw className="size-4" /> Process return
                      </Button>
                      </div>
                    }
                  />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="projects" className="mt-4">
            {fOnProject === undefined ? (
              <LoadingGif size={48} label={null} />
            ) : fOnProject.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No parts are checked out to projects.
              </p>
            ) : (
              <ul className="divide-y glass-3d rounded-lg border">
                {(fOnProject ?? []).map((row) => (
                  <RowCard
                    key={row.rental._id}
                    row={row as Row}
                    selectable
                    actions={
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditRentalFor(row.rental)} title="Edit or delete this record">
                          <SquarePen className="size-4" />
                        </Button>
                        <StatusBadge status="on_project" />
                      </div>
                    }
                  />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {fHistory === undefined ? (
              <LoadingGif size={48} label={null} />
            ) : fHistory.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No completed rentals yet.
              </p>
            ) : (
              <ul className="divide-y glass-3d rounded-lg border">
                {(fHistory ?? []).slice(0, 40).map((row) => (
                  <RowCard
                    key={row.rental._id}
                    row={row as Row}
                    selectable
                    actions={
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditRentalFor(row.rental)}
                          title="Edit or delete this record"
                        >
                          <SquarePen className="size-4" />
                        </Button>
                        <StatusBadge status={row.rental.status} />
                      </div>
                    }
                  />
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="ranks" className="mt-4">
            {fRank === undefined ? (
              <LoadingGif size={48} label={null} />
            ) : fRank.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No rank requests — members can send them from their profile page.
              </p>
            ) : (
              <ul className="divide-y glass-3d rounded-lg border">
                {fRank.map(({ request, user }) => (
                  <li key={request._id} className="flex flex-col gap-3 px-4 py-3 wide:flex-row wide:items-center">
                    <Checkbox
                      checked={selected.has(request._id)}
                      onCheckedChange={() => toggleSel(request._id)}
                      aria-label="Select rank request"
                      className="shrink-0 self-start wide:self-center"
                    />
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Award className="size-4 shrink-0 text-violet-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {user?.name ?? user?.email ?? "(removed)"}
                        </p>
                        <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="break-words">wants: {request.requestedRoles.join(" · ")}</span>
                          {request.message ? <span className="break-words">— “{request.message}”</span> : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 wide:ml-auto">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Member badge card"
                        onClick={() => setBadgeFor(badgeOf(user))}
                      >
                        <IdCard className="size-4" /> Badge
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyId === request._id}
                      onClick={async () => {
                        setBusyId(request._id);
                        try {
                          await decideRank({ id: request._id, approve: true });
                          toast.success("Positions granted");
                        } catch (e) {
                          toast.error(asMessage(e));
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      >
                        <Check className="size-4" /> Grant
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === request._id}
                        onClick={async () => {
                          setBusyId(request._id);
                          try {
                            await decideRank({ id: request._id, approve: false });
                            toast.success("Request denied");
                          } catch (e) {
                            toast.error(asMessage(e));
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="printers" className="mt-4">
            {fPrinter === undefined || fInventory === undefined ? (
              <LoadingGif size={48} label={null} />
            ) : fPrinter.length === 0 && fInventory.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No printer-access or inventory-manager requests — members can send them from their profile page.
              </p>
            ) : (
              <>
              {fPrinter.length > 0 && (
              <ul className="divide-y glass-3d rounded-lg border">
                {fPrinter.map(({ request, user }) => (
                  <li key={request._id} className="flex flex-col gap-3 px-4 py-3 wide:flex-row wide:items-center">
                    <Checkbox
                      checked={selected.has(request._id)}
                      onCheckedChange={() => toggleSel(request._id)}
                      aria-label="Select printer request"
                      className="shrink-0 self-start wide:self-center"
                    />
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Printer className="size-4 shrink-0 text-cyan-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {user?.name ?? user?.email ?? "(removed)"}
                        </p>
                        <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="whitespace-nowrap">requests printer access</span>
                          {request.message ? <span className="break-words">— “{request.message}”</span> : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 wide:ml-auto">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Member badge card"
                        onClick={() => setBadgeFor(badgeOf(user))}
                      >
                        <IdCard className="size-4" /> Badge
                      </Button>
                      <Button
                        size="sm"
                        disabled={busyId === request._id}
                      onClick={async () => {
                        setBusyId(request._id);
                        try {
                          await decidePrinter({ id: request._id, approve: true });
                          toast.success("Printer access granted");
                        } catch (e) {
                          toast.error(asMessage(e));
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      >
                        <Check className="size-4" /> Grant
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === request._id}
                        onClick={async () => {
                          setBusyId(request._id);
                          try {
                            await decidePrinter({ id: request._id, approve: false });
                            toast.success("Request denied");
                          } catch (e) {
                            toast.error(asMessage(e));
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              )}

              {fInventory.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Warehouse className="size-4 text-amber-400" />
                  Inventory manager requests ({fInventory.length})
                </h3>
                <ul className="divide-y glass-3d rounded-lg border">
                  {fInventory.map(({ request, user }) => (
                    <li key={request._id} className="flex flex-col gap-3 px-4 py-3 wide:flex-row wide:items-center">
                      <Checkbox
                        checked={selected.has(request._id)}
                        onCheckedChange={() => toggleSel(request._id)}
                        aria-label="Select inventory request"
                        className="shrink-0 self-start wide:self-center"
                      />
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Warehouse className="size-4 shrink-0 text-amber-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {user?.name ?? user?.email ?? "(removed)"}
                          </p>
                          <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="whitespace-nowrap">requests inventory manager access</span>
                            {request.message ? <span className="break-words">— “{request.message}”</span> : null}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 wide:ml-auto">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Member badge card"
                          onClick={() => user && setBadgeFor(badgeOf(user))}
                        >
                          <IdCard className="size-4" /> Badge
                        </Button>
                        <Button
                          size="sm"
                          disabled={busyId === request._id}
                          title="Grant with all three sub-permissions (edit / add / delete) — fine-tune later from People"
                          onClick={async () => {
                            setBusyId(request._id);
                            try {
                              await decideInventory({ id: request._id, approve: true });
                              toast.success("Inventory manager access granted");
                            } catch (e) {
                              toast.error(asMessage(e));
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          <Check className="size-4" /> Grant
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === request._id}
                          onClick={async () => {
                            setBusyId(request._id);
                            try {
                              await decideInventory({ id: request._id, approve: false });
                              toast.success("Request denied");
                            } catch (e) {
                              toast.error(asMessage(e));
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              )}
              </>
            )}
          </TabsContent>

          <TabsContent value="profiles" className="mt-4">
            {fProfile === undefined || fUnapproved === undefined ? (
              <LoadingGif size={48} label={null} />
            ) : fProfile.length === 0 && fUnapproved.length === 0 ? (
              <p className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No profile change requests.
              </p>
            ) : (
              <>
              {fProfile.length > 0 && (
              <ul className="divide-y glass-3d rounded-lg border">
                {fProfile.map(({ request, user }) => (
                  <li key={request._id} className="flex flex-col gap-3 px-4 py-3 wide:flex-row wide:items-center">
                    <Checkbox
                      checked={selected.has(request._id)}
                      onCheckedChange={() => toggleSel(request._id)}
                      aria-label="Select profile request"
                      className="shrink-0 self-start wide:self-center"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user?.name ?? user?.email}</p>
                      <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                        {Object.entries(request.payload).map(([k, v]) => (
                          <span key={k} className="break-words">{k}: {String(v)}</span>
                        ))}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 wide:ml-auto">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Member badge card"
                        onClick={() => setBadgeFor(badgeOf(user))}
                      >
                        <IdCard className="size-4" /> Badge
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            await decideProfile({ id: request._id, approve: true });
                            toast.success("Profile updated");
                          } catch (e) {
                            toast.error(asMessage(e));
                          }
                        }}
                      >
                        <Check className="size-4" /> Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await decideProfile({ id: request._id, approve: false });
                            toast.success("Request denied");
                          } catch (e) {
                            toast.error(asMessage(e));
                          }
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              )}

              {fUnapproved.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Inbox className="size-4 text-orange-400" />
                  New sign-ups awaiting approval ({fUnapproved.length})
                </h3>
                <ul className="divide-y glass-3d rounded-lg border">
                  {fUnapproved.map((u) => (
                    <li key={u._id} className="flex flex-col gap-3 px-4 py-3 wide:flex-row wide:items-center">
                      <Checkbox
                        checked={selected.has(u._id)}
                        onCheckedChange={() => toggleSel(u._id)}
                        aria-label="Select sign-up"
                        className="shrink-0 self-start wide:self-center"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.name ?? u.email}</p>
                        <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="whitespace-nowrap">joined — awaiting profile approval</span>
                          {u.studentId ? <span className="whitespace-nowrap">ID: {u.studentId}</span> : null}
                          {u.phone ? <span className="whitespace-nowrap">{u.phone}</span> : null}
                          {!u.studentId && !u.phone && u.email ? <span className="break-words">{u.email}</span> : null}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 wide:ml-auto">
                        <Button
                          size="sm"
                          disabled={busyId === u._id}
                          title="Approve — unlocks full member access"
                          onClick={async () => {
                            setBusyId(u._id);
                            try {
                              await approveProfileAcct({ userId: u._id, approved: true });
                              toast.success("Profile approved — full access unlocked");
                            } catch (e) {
                              toast.error(asMessage(e));
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          <Check className="size-4" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === u._id}
                          title="Keep locked — the submission stays pending until verified"
                          onClick={async () => {
                            setBusyId(u._id);
                            try {
                              await approveProfileAcct({ userId: u._id, approved: false });
                              toast.success("Kept pending — the member stays locked");
                            } catch (e) {
                              toast.error(asMessage(e));
                            } finally {
                              setBusyId(null);
                            }
                          }}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              )}
              </>
            )}
          </TabsContent>
        </Tabs>

        {card && <RentCardDialog r={card} onClose={() => setCard(null)} />}

        {badgeFor && (
          <PersonBadgeDialog p={badgeFor} onClose={() => setBadgeFor(null)} />
        )}

        {editRentalFor && (
          <EditRentalDialog
            open={Boolean(editRentalFor)}
            onOpenChange={(v) => !v && setEditRentalFor(null)}
            rental={editRentalFor}
          />
        )}

        {editPkgFor && (
          <EditPackageDialog
            open={Boolean(editPkgFor)}
            onOpenChange={(v) => !v && setEditPkgFor(null)}
            pkg={editPkgFor}
          />
        )}

        {/* Return hand-over date — the mirror of the pick-up scheduling dialog. */}
      <Dialog open={Boolean(meetupFor)} onOpenChange={(v) => !v && setMeetupFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Return hand-over</DialogTitle>
            <DialogDescription>
              {meetupFor && (
                <>
                  {meetupFor.group?.name ?? "Part"} ({meetupFor.part?.tag}) from{" "}
                  {meetupFor.student?.name ?? meetupFor.student?.email ?? "a member"}.
                </>
              )}{" "}
              The member and the club group are both notified with the date, shown in the club
              timezone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="return-meetup-at">Hand-over date &amp; time</Label>
              <Input
                id="return-meetup-at"
                type="datetime-local"
                value={meetupLocal}
                onChange={(e) => setMeetupLocal(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              When they arrive, tap “Handed over” on the row, then process the return. Leave the date
              empty to clear it.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMeetupFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitMeetup()} disabled={meetupBusy}>
              {meetupBusy ? "Saving…" : "Save hand-over date"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pkgCard && <PackageCardDialog card={pkgCard} onClose={() => setPkgCard(null)} />}

        {/* Clear rental history — processed tail by default, everything with
            the explicit live toggle (units optionally released to the shelf). */}
        <Dialog open={clearOpen} onOpenChange={setClearOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Clear rental history</DialogTitle>
              <DialogDescription>
                Tick what you want to delete — nothing is removed until you press
                the button, and unticked categories are left untouched.
                {historyStatsQ &&
                  ` Now: ${historyStatsQ.processed} processed · ${historyStatsQ.live} live rental record(s).`}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={delProcessed}
                  onCheckedChange={(v) => setDelProcessed(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Rental records — processed (returned, on project, denied, canceled)
                  {historyStatsQ ? ` — ${historyStatsQ.processed} record(s)` : ""}
                  <span className="block text-xs text-muted-foreground">
                    The safe default: the finished tail of the History tab.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={delLive}
                  onCheckedChange={(v) => setDelLive(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Rental records — LIVE (pending/approved/active/on project)
                  {historyStatsQ ? ` — ${historyStatsQ.live} record(s)` : ""}
                  <span className="block text-xs text-muted-foreground">
                    Dangerous: current loans lose their paper trail. Units stay marked unless released below.
                  </span>
                </span>
              </label>
              {delLive && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={clearRelease}
                    onCheckedChange={(v) => setClearRelease(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Release units still held by deleted records back to the shelf
                    <span className="block text-xs text-muted-foreground">
                      Leave unchecked to keep unit states untouched (shelf counts unchanged).
                    </span>
                  </span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={delNotifs}
                  onCheckedChange={(v) => setDelNotifs(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Notifications — the whole in-app admin feed
                  <span className="block text-xs text-muted-foreground">
                    Removes every row of the feed below the tabs. Record history is not touched.
                  </span>
                </span>
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setClearOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={clearBusy || !anyClearSelected}
                title={anyClearSelected ? undefined : "Select at least one thing to delete"}
                onClick={submitClearHistory}
              >
                {clearBusy ? <LoadingGifInline size={18} className="size-4" /> : <Trash2 className="size-4" />}
                Delete selected
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Admin notifications: newest first; opening this page marks them read
            (bubbles in the sidebar/header decrease), tapping a row marks just
            that one. */}
        {notifications !== undefined && notifications.length > 0 && (
          <section className="glass-3d rounded-lg border">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-sm font-semibold">Notifications</h2>
              {unread.length > 0 && (
                <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-white">
                  {unread.length} new
                </span>
              )}
            </div>
            <ul className="divide-y">
              {notifications.slice(0, 20).map((n) => (
                <li key={n._id}>
                  <button
                    type="button"
                    onClick={() => n.read !== true && markRead({ id: n._id })}
                    className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted/50 ${
                      n.read !== true ? "bg-primary/5" : "opacity-70"
                    }`}
                  >
                    {n.read !== true ? (
                      <span className="size-2 shrink-0 rounded-full bg-primary" />
                    ) : (
                      <span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">{n.text}</span>
                    {n.link && (
                      <Link
                        to={n.link}
                        className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open
                      </Link>
                    )}
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {new Date(n._creationTime).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Return / assign dialog */}
      {/* Shared return dialog — also used by the bulk "Return selected"
          flow (bulkReturnIds non-null switches it into bulk mode). */}
      <Dialog
        open={Boolean(returnFor)}
        onOpenChange={(v) => {
          if (v) return;
          setReturnFor(null);
          setBulkReturnIds(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{bulkReturnIds ? `Return ${bulkReturnIds.rentals.length + bulkReturnIds.bundles.length} selected item(s)` : "Process return"}</DialogTitle>
            <DialogDescription>
              {bulkReturnIds
                ? "Every selected active unit gets the same destination and condition."
                : `${returnFor?.group?.name} — unit ${returnFor?.part?.tag}. Choose where it goes next and record its condition.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <RadioGroup
              value={destination}
              onValueChange={(v) => setDestination(v as "shelf" | "project" | "transferred")}
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${destination === "shelf" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="shelf" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Return to shelf</p>
                  <p className="text-xs text-muted-foreground">Back to its storage, rentable again.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${destination === "project" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="project" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Assign to project</p>
                  <p className="text-xs text-muted-foreground">Stays checked out until dismantled.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${destination === "transferred" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="transferred" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Transferred to</p>
                  <p className="text-xs text-muted-foreground">Handed to another dept/lab — kept on record.</p>
                </div>
              </label>
            </RadioGroup>

            {destination === "transferred" && (
              <div className="flex flex-col gap-2">
                <Label>Transfer destination name</Label>
                <Input
                  value={transferName}
                  onChange={(e) => setTransferName(e.target.value)}
                  placeholder="e.g. Mechatronics dept., Al-Amal school lab…"
                />
                <Label>Details</Label>
                <Textarea
                  value={transferDetails}
                  onChange={(e) => setTransferDetails(e.target.value)}
                  placeholder="Who received it, why, reference number…"
                  rows={2}
                />
                <DocAttachmentField doc={transferDoc} onChange={setTransferDoc} />
              </div>
            )}

            {destination === "shelf" &&
              !bulkReturnIds &&
              (returnFor?.group?.measure === "weight" || returnFor?.group?.measure === "length") &&
              returnFor?.rental?.amount !== undefined && (
                <div className="flex flex-col gap-2 glass-3d rounded-lg border bg-muted/30 p-3">
                  <Label>
                    Amount recovered ({returnFor.group.measureUnit ?? ""}) — taken: {returnFor.rental.amount}{" "}
                    {returnFor.group.measureUnit ?? ""}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={recovered}
                    onChange={(e) => setRecovered(e.target.value)}
                    placeholder={`What physically came back (≤ ${returnFor.rental.amount})`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave empty to shelve all of it. The difference is logged as consumed.
                  </p>
                </div>
              )}

            {destination === "project" && (
              <div className="flex flex-col gap-2">
                <Label>Project</Label>
                {!creatingProject ? (
                  <div className="flex gap-2">
                    <Select value={projectId} onValueChange={setProjectId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select an active project" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects ?? []).map((p) => (
                          <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={() => setCreatingProject(true)}>
                      New
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      className="flex h-9 flex-1 glass-3d rounded-md border bg-background px-3 text-sm"
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      placeholder="New project name"
                    />
                    <Button type="button" variant="outline" onClick={() => setCreatingProject(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Condition check</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={functional ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setFunctional(true)}
                >
                  Works fine
                </Button>
                <Button
                  type="button"
                  variant={!functional ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setFunctional(false)}
                >
                  Needs repair
                </Button>
              </div>
              <Textarea
                value={report}
                onChange={(e) => setReport(e.target.value)}
                placeholder="Anything to note? (missing cable, scratched pins…)"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReturnFor(null); setBulkReturnIds(null); }}>Cancel</Button>
            <Button onClick={submitReturn} disabled={!validReturn || busyId !== null}>
              <PackagePlus className="size-4" /> {bulkReturnIds ? "Return all" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Whole-package return: one decision for every active unit of the bundle */}
      <Dialog open={Boolean(wholeFor)} onOpenChange={(v) => !v && setWholeFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Return the whole package</DialogTitle>
            <DialogDescription>
              Every active unit of this bundle gets the same destination and condition. For
              per-unit fine-tuning, use the individual Return buttons on the unit rows.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <RadioGroup
              value={wholeDestination}
              onValueChange={(v) => setWholeDestination(v as "shelf" | "project" | "transferred")}
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${wholeDestination === "shelf" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="shelf" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Return to shelf</p>
                  <p className="text-xs text-muted-foreground">All units back in their storages (or marked broken).</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${wholeDestination === "project" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="project" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Assign to project</p>
                  <p className="text-xs text-muted-foreground">Everything stays checked out until dismantled.</p>
                </div>
              </label>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${wholeDestination === "transferred" ? "border-foreground" : ""}`}>
                <RadioGroupItem value="transferred" className="mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Transferred to</p>
                  <p className="text-xs text-muted-foreground">All units handed to another dept/lab.</p>
                </div>
              </label>
            </RadioGroup>

            {wholeDestination === "transferred" && (
              <div className="flex flex-col gap-2">
                <Label>Transfer destination name</Label>
                <Input
                  value={wholeTransferName}
                  onChange={(e) => setWholeTransferName(e.target.value)}
                  placeholder="e.g. Mechatronics dept., Al-Amal school lab…"
                />
                <Label>Details</Label>
                <Textarea
                  value={wholeTransferDetails}
                  onChange={(e) => setWholeTransferDetails(e.target.value)}
                  placeholder="Who received everything, why, reference number…"
                  rows={2}
                />
                {/* Official documentation (image or PDF) — optional, but the
                    reference is attached to every unit record individually. */}
                <div className="mt-1">
                  <Label>Documentation (image or PDF)</Label>
                  <p className="mb-1 text-[11px] text-muted-foreground">
                    Optional but important — a photo of the signed form or the official PDF. Attached to every unit of the package.
                  </p>
                  <DocAttachmentField doc={wholeTransferDoc} onChange={setWholeTransferDoc} />
                </div>
              </div>
            )}

            {wholeDestination === "project" && (
              <div className="flex flex-col gap-2">
                <Label>Project</Label>
                {!wholeCreatingProject ? (
                  <div className="flex gap-2">
                    <Select value={wholeProjectId} onValueChange={setWholeProjectId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select an active project" />
                      </SelectTrigger>
                      <SelectContent>
                        {(projects ?? []).map((p) => (
                          <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={() => setWholeCreatingProject(true)}>
                      New
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      className="flex-1"
                      value={wholeNewProjectName}
                      onChange={(e) => setWholeNewProjectName(e.target.value)}
                      placeholder="New project name"
                    />
                    <Button type="button" variant="outline" onClick={() => setWholeCreatingProject(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Condition check (applies to every unit)</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={wholeFunctional ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setWholeFunctional(true)}
                >
                  Works fine
                </Button>
                <Button
                  type="button"
                  variant={!wholeFunctional ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setWholeFunctional(false)}
                >
                  Needs repair
                </Button>
              </div>
              <Textarea
                value={wholeReport}
                onChange={(e) => setWholeReport(e.target.value)}
                placeholder="Anything to note? (applied to every unit)"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWholeFor(null)}>Cancel</Button>
            <Button onClick={submitWholeReturn} disabled={!wholeValid || wholeBusy}>
              <RotateCcw className="size-4" /> {wholeBusy ? "Processing…" : "Process all units"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Approve: schedule the pick-up ===== */}
      <Dialog open={Boolean(approveFor)} onOpenChange={(v) => !v && setApproveFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve &amp; schedule pick-up</DialogTitle>
            <DialogDescription>
              {approveFor && (
                <>
                  {approveFor.group?.name ?? "Part"} ({approveFor.part?.tag}) for{" "}
                  {approveFor.student?.name ?? approveFor.student?.email ?? "a member"}.
                </>
              )}
              {" "}They'll be notified with the date, and reminded 24h and 1h before on Telegram.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pickup-at">Pick-up date &amp; time</Label>
              <Input
                id="pickup-at"
                type="datetime-local"
                value={pickupLocal}
                onChange={(e) => setPickupLocal(e.target.value)}
              />
            </div>
            {(pickups ?? []).length > 0 && (
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  Or reuse an existing scheduled slot
                </Label>
                <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                  {(pickups ?? [])
                    .filter((p) => p.pickupAt)
                    .slice(0, 6)
                    .map((p) => (
                      <button
                        key={p.rentalId}
                        type="button"
                        className="glass-3d rounded-md border px-3 py-1.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-muted/50"
                        onClick={() => {
                          const d = new Date(p.pickupAt!);
                          const pad = (n: number) => String(n).padStart(2, "0");
                          setPickupLocal(
                            `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                          );
                        }}
                      >
                        📅 {new Date(p.pickupAt!).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                        <span className="text-muted-foreground"> — {p.studentName} · {p.groupName}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Leaving it empty means "come whenever the lab is open" — no reminders will be sent.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveFor(null)}>Cancel</Button>
            <Button onClick={submitApprove} disabled={approveBusy}>
              <Check className="size-4" /> {approveBusy ? "Approving…" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Approve / deny a package: schedule the pick-up ===== */}
      <Dialog open={Boolean(approvePkgFor)} onOpenChange={(v) => !v && setApprovePkgFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Package · schedule pick-up</DialogTitle>
            <DialogDescription>
              {approvePkgFor && (
                <>All {approvePkgFor.unitCount} unit(s) stay reserved until the member picks them up — hand each over with “Mark picked up”, then process returns unit by unit.</>
              )}{" "}
              They'll be notified with the date, and reminded 24h and 1h before on Telegram.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pkg-pickup-at">Pick-up date &amp; time</Label>
              <Input
                id="pkg-pickup-at"
                type="datetime-local"
                value={pickupLocal}
                onChange={(e) => setPickupLocal(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Leaving it empty means "come whenever the lab is open" — no reminders will be sent.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setApprovePkgFor(null)}>Cancel</Button>
            <Button variant="outline" onClick={() => decidePackageAction(false)} disabled={approveBusy}>
              <X className="size-4" /> Deny
            </Button>
            <Button onClick={() => decidePackageAction(true)} disabled={approveBusy}>
              <Check className="size-4" /> {approveBusy ? "Approving…" : "Approve all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
