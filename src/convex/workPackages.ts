import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireNonStudent, safeImage } from "./lib";
import { telegramDM, telegramGroup } from "./notify";
import {
  WP_STATUSES,
  WP_TYPES,
  wpAllowedStatuses,
  wpApplyProgress,
  wpDeriveParentDates,
  wpDurationDays,
  wpIsClosed,
  wpMentions,
  wpProgress,
  wpScheduleAfterPredecessors,
  type WorkPackageProgressMode,
  type WorkPackageStatus,
  type WorkPackageTransition,
} from "../lib/work-packages";

/**
 * Work packages — the club's OpenProject-style tracking layer inside a project.
 *
 * A work package is the professional unit of work: typed, statused, prioritised,
 * scheduled (start/finish), estimated (% Complete, Work, Remaining work, story
 * points), nested under a single parent, related to other packages, assigned to
 * an assignee with an accountable owner, watched, commented on and time-tracked.
 *
 * Design notes that follow OpenProject closely:
 *  - Statuses are data, not a fixed enum baked into logic: the vocabulary lives
 *    in src/lib/work-packages.ts and the server only validates membership of it.
 *    Whether a status counts as "closed" is a property of the status.
 *  - Relations are stored ONCE per ordered pair; each side renders its own label
 *    (blocks / blocked by) from the same row, and the inverse is derived here.
 *  - Every change writes a journal entry, so the Activity tab is a real change
 *    set plus conversation timeline rather than a comment list.
 *  - Hierarchy is a strict single parent (OpenProject does not allow multiple
 *    parents); we refuse cycles.
 *
 * Permissions mirror the rest of the project workspace: admins do everything,
 * the project leader manages, and a member may comment/watch/log time and move
 * the packages they are assigned to or authored.
 */

// ---------- validators ----------

const typeValidator = v.union(
  v.literal("task"),
  v.literal("bug"),
  v.literal("feature"),
  v.literal("epic"),
  v.literal("user_story"),
  v.literal("milestone"),
  v.literal("phase"),
);

const statusValidator = v.union(
  v.literal("new"),
  v.literal("in_specification"),
  v.literal("specified"),
  v.literal("in_progress"),
  v.literal("developed"),
  v.literal("in_testing"),
  v.literal("tested"),
  v.literal("test_failed"),
  v.literal("on_hold"),
  v.literal("closed"),
  v.literal("rejected"),
);

const priorityValidator = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("immediate"),
  v.literal("urgent"),
);

const relationValidator = v.union(
  v.literal("relates"),
  v.literal("duplicates"),
  v.literal("blocks"),
  v.literal("precedes"),
  v.literal("requires"),
  v.literal("includes"),
);

const activityValidator = v.union(
  v.literal("development"),
  v.literal("design"),
  v.literal("testing"),
  v.literal("documentation"),
  v.literal("coordination"),
  v.literal("other"),
);

const versionStatusValidator = v.union(
  v.literal("open"),
  v.literal("locked"),
  v.literal("closed"),
);

// Scheduling mode (OpenProject 15.4+): automatic derives dates, manual keeps
// whatever the user typed.
const schedulingValidator = v.union(v.literal("manual"), v.literal("automatic"));

const progressModeValidator = v.union(v.literal("work_based"), v.literal("status_based"));

const customFieldFormatValidator = v.union(
  v.literal("text"),
  v.literal("long_text"),
  v.literal("int"),
  v.literal("float"),
  v.literal("bool"),
  v.literal("date"),
  v.literal("list"),
);

const sprintStatusValidator = v.union(
  v.literal("open"),
  v.literal("active"),
  v.literal("closed"),
);

/** A custom-field value as stored: a scalar keyed by the field's id. */
const customFieldValueValidator = v.union(v.string(), v.number(), v.boolean());

// ---------- shared helpers ----------

type Ctx = QueryCtx | MutationCtx;

type UserLite = {
  _id: Id<"users">;
  name?: string;
  email?: string;
  image?: string;
  telegramUsername?: string;
  telegramChatId?: string;
  role?: string;
  isAnonymous?: boolean;
};

/** The caller's ACTIVE membership of a project (ex-members hold no power). */
async function membershipOf(ctx: Ctx, projectId: Id<"projects">, userId: Id<"users">) {
  const rows = await ctx.db
    .query("projectMembers")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return rows.find((r) => r.userId === userId && !r.leftAt) ?? null;
}

async function requireProjectAccess(ctx: Ctx, projectId: Id<"projects">) {
  const me = await requireNonStudent(ctx);
  const project = await ctx.db.get(projectId);
  if (!project || project.deleted) throw new ConvexError("Project not found");
  const mine = await membershipOf(ctx, projectId, me._id);
  const isAdmin = me.role === "admin";
  const isLeader = mine?.role === "leader";
  return {
    me,
    project,
    mine,
    isAdmin,
    canManage: isAdmin || isLeader,
    isMember: Boolean(mine) || isAdmin,
  };
}

/** A read-only projection of a work package used by the table/board. */
type WpRow = {
  _id: Id<"workPackages">;
  projectId: Id<"projects">;
  type: string;
  subject: string;
  description?: string;
  status: string;
  priority: string;
  assigneeId?: Id<"users">;
  accountableId?: Id<"users">;
  authorId: Id<"users">;
  startAt?: number;
  finishAt?: number;
  doneRatio: number;
  estimatedHours?: number;
  remainingHours?: number;
  storyPoints?: number;
  versionId?: Id<"projectVersions">;
  sprintId?: Id<"wpSprints">;
  category?: string;
  parentId?: Id<"workPackages">;
  position: number;
  scheduling?: "manual" | "automatic";
  customFields?: Record<string, string | number | boolean>;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  deleted?: boolean;
};

function displayName(u: UserLite | null | undefined): string | undefined {
  return u?.name ?? u?.email;
}

/** Human-readable rendering of a value for the journal's change sets. */
function label(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    // Timestamps render as a date; everything else as a plain number.
    return value > 1e11
      ? new Date(value).toLocaleDateString("en-GB")
      : String(value);
  }
  return String(value);
}

// ---------- configuration ----------

/**
 * The per-project work-package configuration. OpenProject administers this
 * instance-wide; a club runs many projects with very different rituals, so
 * each project owns its own. Missing row = the documented defaults.
 */
export type WpSettings = {
  progressMode: WorkPackageProgressMode;
  scheduling: "manual" | "automatic";
  workingDaysOnly: boolean;
  /** Empty = unconfigured, which is permissive (every status change allowed). */
  workflow: WorkPackageTransition[];
};

export const WP_DEFAULT_SETTINGS: WpSettings = {
  progressMode: "work_based",
  scheduling: "manual",
  workingDaysOnly: true,
  workflow: [],
};

async function settingsFor(ctx: Ctx, projectId: Id<"projects">): Promise<WpSettings> {
  const row = await ctx.db
    .query("wpSettings")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
  if (!row) return WP_DEFAULT_SETTINGS;
  return {
    progressMode: row.progressMode as WorkPackageProgressMode,
    scheduling: row.scheduling,
    workingDaysOnly: row.workingDaysOnly,
    workflow: row.workflow as WorkPackageTransition[],
  };
}

/** Display name for a user id — journal change sets name people, not ids. */
async function userNameOf(ctx: Ctx, id?: Id<"users">): Promise<string | undefined> {
  if (!id) return undefined;
  const u = (await ctx.db.get(id)) as UserLite | null;
  return displayName(u);
}

// ---------- workflow / scheduling / blockers ----------

/**
 * Reject a status change the project's workflow does not allow. An
 * unconfigured workflow (or one with no row for this type) permits anything,
 * so an untouched project never blocks a legitimate move.
 */
function assertTransition(
  settings: WpSettings,
  type: string,
  from: string,
  to: string,
) {
  if (from === to) return;
  if (settings.workflow.length === 0) return;
  const allowed = wpAllowedStatuses(settings.workflow, type, from);
  if (!allowed.includes(to as WorkPackageStatus)) {
    throw new ConvexError(
      `“${String(from).replace("_", " ")}” cannot move to “${String(to).replace("_", " ")}” — the project workflow does not allow it`,
    );
  }
}

/**
 * A work package may not close while a package that BLOCKS it is still open
 * (OpenProject refuses the transition). Returns the offending blockers.
 */
async function openBlockersOf(ctx: Ctx, wpId: Id<"workPackages">) {
  const incoming = await ctx.db
    .query("wpRelations")
    .withIndex("by_to", (q) => q.eq("toId", wpId))
    .collect();
  const blockers: { _id: Id<"workPackages">; subject: string; status: string }[] = [];
  for (const rel of incoming.filter((r) => r.type === "blocks")) {
    const other = await ctx.db.get(rel.fromId);
    if (other && !other.deleted && !wpIsClosed(other.status)) {
      blockers.push({ _id: other._id, subject: other.subject, status: other.status });
    }
  }
  return blockers;
}

/**
 * Recompute the dates of an AUTOMATICALLY scheduled work package and then any
 * automatic ancestors: a parent spans its children, a successor starts after
 * its latest predecessor (plus lag). Manual packages are never touched.
 *
 * Returns the ids that moved, so the caller can journal them.
 */
async function rescheduleFrom(ctx: MutationCtx, startId: Id<"workPackages">) {
  const moved: Id<"workPackages">[] = [];
  let cursor: Id<"workPackages"> | undefined = startId;
  for (let depth = 0; cursor && depth < 20; depth += 1) {
    const wp = (await ctx.db.get(cursor)) as Doc<"workPackages"> | null;
    if (!wp || wp.deleted) break;
    // Only automatic packages are re-planned, but the walk always keeps going
    // up: a manual child still stretches an automatic parent, and a package
    // with nothing to derive from must not stop its own parent being updated.
    const parentId = wp.parentId;
    if (wp.scheduling !== "automatic") {
      cursor = parentId;
      continue;
    }

    const children = (
      await ctx.db.query("workPackages").withIndex("by_parent", (q) => q.eq("parentId", wp._id)).collect()
    ).filter((c) => !c.deleted && (c.startAt !== undefined || c.finishAt !== undefined));

    let next: { startAt?: number; finishAt?: number } = {};
    if (children.length > 0) {
      next = wpDeriveParentDates(children);
    } else {
      // Predecessors are the `precedes` relations pointing AT this package.
      const incoming = await ctx.db
        .query("wpRelations")
        .withIndex("by_to", (q) => q.eq("toId", wp._id))
        .collect();
      const preds: { finishAt?: number; lagDays?: number }[] = [];
      for (const rel of incoming.filter((r) => r.type === "precedes")) {
        const from = await ctx.db.get(rel.fromId);
        if (from && !from.deleted) preds.push({ finishAt: from.finishAt, lagDays: rel.lagDays });
      }
      next = wpScheduleAfterPredecessors({ startAt: wp.startAt, finishAt: wp.finishAt }, preds);
    }

    const derivative = next.startAt !== undefined || next.finishAt !== undefined;
    const changed = next.startAt !== wp.startAt || next.finishAt !== wp.finishAt;
    if (derivative && changed) {
      await ctx.db.patch(wp._id, {
        startAt: next.startAt,
        finishAt: next.finishAt,
        updatedAt: Date.now(),
      });
      moved.push(wp._id);
    }
    cursor = parentId;
  }
  return moved;
}

/**
 * Re-plan a package, any automatic ancestors it belongs to, AND everything
 * downstream of it: a successor's start is derived, so moving one package has
 * to walk the `precedes` chain. The depth cap keeps a hand-made relation cycle
 * from looping forever.
 */
async function rescheduleCascade(
  ctx: MutationCtx,
  roots: Id<"workPackages">[],
  depth = 0,
  moved: Id<"workPackages">[] = [],
): Promise<Id<"workPackages">[]> {
  if (depth > 10) return moved;
  const next: Id<"workPackages">[] = [];
  for (const id of roots) {
    moved.push(...(await rescheduleFrom(ctx, id)));
    const outgoing = await ctx.db
      .query("wpRelations")
      .withIndex("by_from", (q) => q.eq("fromId", id))
      .collect();
    for (const rel of outgoing.filter((r) => r.type === "precedes")) next.push(rel.toId);
  }
  if (next.length > 0) await rescheduleCascade(ctx, next, depth + 1, moved);
  return moved;
}

/** Write the progress fields under the project's progress mode. */
function progressPatchFor(
  settings: WpSettings,
  status: string,
  stored: { doneRatio?: number; estimatedHours?: number; remainingHours?: number },
  edit: { doneRatio?: number; estimatedHours?: number; remainingHours?: number },
) {
  return wpApplyProgress(settings.progressMode, wpProgress(status), stored, edit);
}

/**
 * Validate a custom-field payload against the project's definitions: only
 * defined fields that are active for this type survive, and each value must
 * match its format (the UI's parser is convenience, not the authority).
 */
async function cleanCustomFields(
  ctx: Ctx,
  projectId: Id<"projects">,
  type: string,
  incoming: Record<string, string | number | boolean> | undefined,
): Promise<Record<string, string | number | boolean> | undefined> {
  if (!incoming) return undefined;
  const defs = await ctx.db
    .query("wpCustomFields")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const out: Record<string, string | number | boolean> = {};
  for (const def of defs) {
    const key = def._id as string;
    if (!(key in incoming)) continue;
    if (def.types.length > 0 && !def.types.includes(type)) continue;
    const raw = incoming[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (def.fieldFormat === "list" && !(def.possibleValues ?? []).includes(String(raw))) {
      throw new ConvexError(`“${def.name}”: pick one of the listed options`);
    }
    if (def.fieldFormat === "int" && !Number.isInteger(Number(raw))) {
      throw new ConvexError(`“${def.name}” must be a whole number`);
    }
    if (def.fieldFormat === "float" && !Number.isFinite(Number(raw))) {
      throw new ConvexError(`“${def.name}” must be a number`);
    }
    if (def.fieldFormat === "bool" && typeof raw !== "boolean") {
      throw new ConvexError(`“${def.name}” must be yes or no`);
    }
    out[key] = raw;
  }
  return out;
}

// ---------- queries ----------

/**
 * Everything the work-package screen needs for one project in a single
 * subscription: the packages plus the joins (people, versions, parents,
 * journal counts, relations, watchers) and the per-project roll-up.
 */
export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const access = await requireProjectAccess(ctx, projectId);

    const all = await ctx.db
      .query("workPackages")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const rows = all.filter((r) => !r.deleted) as WpRow[];

    const [
      journal,
      relations,
      watchers,
      time,
      versions,
      members,
      sprints,
      cfDefs,
      baselines,
      queries,
      settings,
    ] = await Promise.all([
      ctx.db.query("wpJournal").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpRelations").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpWatchers").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpTimeEntries").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("projectVersions").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("projectMembers").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpSprints").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpCustomFields").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpBaselines").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpQueries").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      settingsFor(ctx, projectId),
    ]);

    // One user lookup per distinct id, not per row.
    const userIds = new Set<Id<"users">>();
    for (const r of rows) {
      if (r.assigneeId) userIds.add(r.assigneeId);
      if (r.accountableId) userIds.add(r.accountableId);
      userIds.add(r.authorId);
    }
    const userMap = new Map<string, UserLite>();
    for (const id of userIds) {
      const u = (await ctx.db.get(id)) as UserLite | null;
      if (u) userMap.set(id, u);
    }
    const nameOf = (id?: Id<"users">) => (id ? displayName(userMap.get(id)) : undefined);

    const byId = new Map<string, WpRow>(rows.map((r) => [r._id as string, r]));

    const items = rows
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((r) => {
        const assigned = r.assigneeId
          ? Object.values(userMap).find((u) => u._id === r.assigneeId)
          : undefined;
        const version = versions.find((vv) => vv._id === r.versionId);
        const sprint = sprints.find((sp) => sp._id === r.sprintId);
        return {
          ...r,
          assigneeName: nameOf(r.assigneeId),
          assigneeImage: safeImage(assigned?.image),
          accountableName: nameOf(r.accountableId),
          authorName: nameOf(r.authorId),
          versionName: version?.name,
          parentSubject: r.parentId ? byId.get(r.parentId as string)?.subject : undefined,
          childCount: rows.filter((c) => c.parentId === r._id).length,
          childClosedCount: rows.filter((c) => c.parentId === r._id && wpIsClosed(c.status)).length,
          sprintName: sprint?.name,
          durationDays: wpDurationDays(r.startAt, r.finishAt),
          // A package is blocked while a `blocks` source is still open.
          blockedBy: relations.filter(
            (rr) =>
              rr.type === "blocks" &&
              rr.toId === r._id &&
              !wpIsClosed(byId.get(rr.fromId as string)?.status ?? "closed"),
          ).length,
          predecessorCount: relations.filter(
            (rr) => rr.type === "precedes" && rr.toId === r._id,
          ).length,
          commentCount: journal.filter((jj) => jj.workPackageId === r._id && jj.kind === "comment").length,
          journalCount: journal.filter((jj) => jj.workPackageId === r._id).length,
          relationCount: relations.filter(
            (rr) => rr.fromId === r._id || rr.toId === r._id,
          ).length,
          watcherCount: watchers.filter((ww) => ww.workPackageId === r._id).length,
          watching: watchers.some(
            (ww) => ww.workPackageId === r._id && ww.userId === access.me._id,
          ),
          spentHours: time
            .filter((tt) => tt.workPackageId === r._id)
            .reduce((sum, tt) => sum + tt.hours, 0),
        };
      });

    const open = items.filter((r) => !isClosedStatus(r.status));
    const stats = {
      total: items.length,
      open: open.length,
      closed: items.length - open.length,
      overdue: open.filter((r) => r.finishAt !== undefined && r.finishAt < Date.now()).length,
      unassigned: open.filter((r) => !r.assigneeId).length,
      storyPoints: items.reduce((s, r) => s + (r.storyPoints ?? 0), 0),
      estimatedHours: items.reduce((s, r) => s + (r.estimatedHours ?? 0), 0),
      spentHours: time.reduce((s, tt) => s + tt.hours, 0),
      remainingHours: items.reduce((s, r) => s + (r.remainingHours ?? 0), 0),
      blocked: open.filter((r) => r.blockedBy > 0).length,
    };

    return {
      items,
      versions: versions
        .slice()
        .sort((a, b) => (a.effectiveAt ?? Infinity) - (b.effectiveAt ?? Infinity)),
      sprints: sprints.slice().sort((a, b) => a.position - b.position || a.createdAt - b.createdAt),
      customFields: cfDefs.slice().sort((a, b) => a.position - b.position),
      baselines: baselines
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((b) => ({
          _id: b._id,
          name: b.name,
          createdAt: b.createdAt,
          count: b.snapshot.length,
          // The snapshot travels with the list so the table can diff against it
          // without a second subscription.
          snapshot: b.snapshot,
        })),
      queries: queries
        .filter((q) => q.shared || q.ownerId === access.me._id)
        .sort((a, b) => a.name.localeCompare(b.name)),
      settings,
      stats,
      teamSize: members.filter((m) => !m.leftAt).length,
      me: {
        userId: access.me._id,
        canManage: access.canManage,
        isMember: access.isMember,
      },
    };
  },
});

/** OpenProject treats a few statuses as closing ones; kept in one place. */
function isClosedStatus(status: string): boolean {
  return status === "closed" || status === "rejected";
}

/** The split-screen / full-screen detail: package + activity + relations. */
export const detail = query({
  args: { id: v.id("workPackages") },
  handler: async (ctx, { id }) => {
    const wp = await ctx.db.get(id);
    if (!wp || wp.deleted) return null;
    const access = await requireProjectAccess(ctx, wp.projectId);

    const [journal, outRels, inRels, watchers, time, children, candidates, sprints, cfDefs, settings, blockers] =
      await Promise.all([
      ctx.db.query("wpJournal").withIndex("by_wp", (q) => q.eq("workPackageId", id)).collect(),
      ctx.db.query("wpRelations").withIndex("by_from", (q) => q.eq("fromId", id)).collect(),
      ctx.db.query("wpRelations").withIndex("by_to", (q) => q.eq("toId", id)).collect(),
      ctx.db.query("wpWatchers").withIndex("by_wp", (q) => q.eq("workPackageId", id)).collect(),
      ctx.db.query("wpTimeEntries").withIndex("by_wp", (q) => q.eq("workPackageId", id)).collect(),
      ctx.db.query("workPackages").withIndex("by_parent", (q) => q.eq("parentId", id)).collect(),
      ctx.db.query("workPackages").withIndex("by_project", (q) => q.eq("projectId", wp.projectId)).collect(),
      ctx.db.query("wpSprints").withIndex("by_project", (q) => q.eq("projectId", wp.projectId)).collect(),
      ctx.db.query("wpCustomFields").withIndex("by_project", (q) => q.eq("projectId", wp.projectId)).collect(),
      settingsFor(ctx, wp.projectId),
      openBlockersOf(ctx, id),
    ]);

    const others = candidates.filter((c) => !c.deleted && c._id !== id);

    // Resolve every user we are about to name, once.
    const userIds = new Set<Id<"users">>();
    if (wp.assigneeId) userIds.add(wp.assigneeId);
    if (wp.accountableId) userIds.add(wp.accountableId);
    userIds.add(wp.authorId);
    for (const jj of journal) userIds.add(jj.authorId);
    for (const ww of watchers) userIds.add(ww.userId);
    for (const tt of time) userIds.add(tt.userId);
    const userMap = new Map<string, UserLite>();
    for (const uid of userIds) {
      const u = (await ctx.db.get(uid)) as UserLite | null;
      if (u) userMap.set(uid, u);
    }
    const nameOf = (uid: Id<"users">) => displayName(userMap.get(uid));
    const imgOf = (uid: Id<"users">) => safeImage(userMap.get(uid)?.image);

    const version = wp.versionId ? await ctx.db.get(wp.versionId) : null;
    const parent = wp.parentId ? await ctx.db.get(wp.parentId) : null;

    const makeRel = (
      r: (typeof outRels)[number],
      inverse: boolean,
    ) => {
      const otherId = inverse ? r.fromId : r.toId;
      const other = others.find((o) => o._id === otherId);
      return {
        _id: r._id,
        type: r.type,
        inverse,
        lagDays: r.lagDays,
        other: other
          ? {
              _id: other._id,
              subject: other.subject,
              type: other.type,
              status: other.status,
              doneRatio: other.doneRatio,
            }
          : null,
      };
    };

    const sprint = wp.sprintId ? sprints.find((sp) => sp._id === wp.sprintId) : undefined;

    return {
      wp: {
        ...wp,
        assigneeName: wp.assigneeId ? nameOf(wp.assigneeId) : undefined,
        accountableName: wp.accountableId ? nameOf(wp.accountableId) : undefined,
        authorName: nameOf(wp.authorId),
        versionName: version?.name,
        sprintName: sprint?.name,
        parentSubject: parent?.subject,
        durationDays: wpDurationDays(wp.startAt, wp.finishAt),
      },
      settings,
      // The statuses the type's workflow allows from where it stands now.
      allowedStatuses: wpAllowedStatuses(settings.workflow, wp.type, wp.status),
      // A blocked package cannot be closed until its blockers are closed.
      blockers,
      sprints: sprints.slice().sort((a, b) => a.position - b.position),
      // Custom fields active for THIS type, each with the current value.
      customFields: cfDefs
        .slice()
        .sort((a, b) => a.position - b.position)
        .filter((d) => d.types.length === 0 || d.types.includes(wp.type))
        .map((d) => ({
          _id: d._id,
          name: d.name,
          fieldFormat: d.fieldFormat,
          possibleValues: d.possibleValues,
          types: d.types,
          value: (wp.customFields ?? {})[d._id as string],
        })),
      journal: journal
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((jj) => ({
          ...jj,
          authorName: nameOf(jj.authorId),
          authorImage: imgOf(jj.authorId),
        })),
      relations: [
        ...outRels.map((r) => makeRel(r, false)),
        ...inRels.map((r) => makeRel(r, true)),
      ].filter((r) => r.other !== null),
      watchers: watchers.map((ww) => ({
        _id: ww._id,
        userId: ww.userId,
        name: nameOf(ww.userId),
        image: imgOf(ww.userId),
      })),
      time: time
        .slice()
        .sort((a, b) => b.spentOn - a.spentOn)
        .map((tt) => ({
          ...tt,
          userName: nameOf(tt.userId),
        })),
      children: children
        .filter((c) => !c.deleted)
        .map((c) => ({
          _id: c._id,
          subject: c.subject,
          type: c.type,
          status: c.status,
          doneRatio: c.doneRatio,
          assigneeId: c.assigneeId,
        }))
        .sort((a, b) => a.subject.localeCompare(b.subject)),
      // Candidates a relation or a parent may point at.
      candidates: others
        .map((o) => ({ _id: o._id, subject: o.subject, type: o.type, status: o.status }))
        .sort((a, b) => a.subject.localeCompare(b.subject)),
      me: {
        userId: access.me._id,
        canManage: access.canManage,
        isMember: access.isMember,
        watching: watchers.some((ww) => ww.userId === access.me._id),
      },
    };
  },
});

// ---------- mutations ----------

/** Shared guard for writes: manager, or the author/assignee of a package. */
async function canEdit(
  ctx: Ctx,
  projectId: Id<"projects">,
  authorId: Id<"users">,
  assigneeId?: Id<"users">,
) {
  const access = await requireProjectAccess(ctx, projectId);
  const ownerish = access.me._id === authorId || access.me._id === assigneeId;
  return { ...access, ownerish };
}

/** Insert a journal entry (comment or change set). */
async function journalEntry(
  ctx: MutationCtx,
  entry: {
    projectId: Id<"projects">;
    workPackageId: Id<"workPackages">;
    authorId: Id<"users">;
    kind: "comment" | "change";
    body?: string;
    changes?: { field: string; from?: string; to?: string }[];
  },
) {
  await ctx.db.insert("wpJournal", { ...entry, createdAt: Date.now() });
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    type: typeValidator,
    subject: v.string(),
    description: v.optional(v.string()),
    status: v.optional(statusValidator),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    accountableId: v.optional(v.id("users")),
    startAt: v.optional(v.number()),
    finishAt: v.optional(v.number()),
    estimatedHours: v.optional(v.number()),
    remainingHours: v.optional(v.number()),
    storyPoints: v.optional(v.number()),
    versionId: v.optional(v.id("projectVersions")),
    sprintId: v.optional(v.id("wpSprints")),
    category: v.optional(v.string()),
    parentId: v.optional(v.id("workPackages")),
    scheduling: v.optional(schedulingValidator),
    customFields: v.optional(v.record(v.string(), customFieldValueValidator)),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectAccess(ctx, args.projectId);
    if (!access.isMember) throw new ConvexError("Join the project team to add work packages");
    if (!access.canManage && args.assigneeId && args.assigneeId !== access.me._id) {
      throw new ConvexError("Only the team leader or an admin can assign someone else");
    }
    const subject = args.subject.trim();
    if (subject.length < 2) throw new ConvexError("Subject is too short");

    if (args.assigneeId) {
      const m = await membershipOf(ctx, args.projectId, args.assigneeId);
      if (!m) throw new ConvexError("Assignee must be on this project's team");
    }
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== args.projectId) {
        throw new ConvexError("Parent must be a work package of the same project");
      }
    }

    const settings = await settingsFor(ctx, args.projectId);
    const status = args.status ?? "new";
    // The workflow gates even the FIRST status: a type whose flow starts at
    // "New" cannot be created straight in "Closed".
    assertTransition(settings, args.type, "new", status);
    if (args.sprintId) {
      const sprint = await ctx.db.get(args.sprintId);
      if (!sprint || sprint.projectId !== args.projectId) {
        throw new ConvexError("Sprint must belong to the same project");
      }
    }
    const scheduling = args.scheduling ?? settings.scheduling;
    const progress = progressPatchFor(settings, status, {}, {
      estimatedHours: args.estimatedHours,
      remainingHours: args.remainingHours,
    });
    const customFields = await cleanCustomFields(
      ctx,
      args.projectId,
      args.type,
      args.customFields,
    );
    const now = Date.now();
    const id = await ctx.db.insert("workPackages", {
      projectId: args.projectId,
      type: args.type,
      subject,
      description: args.description?.trim() || undefined,
      status,
      priority: args.priority ?? "normal",
      assigneeId: args.assigneeId,
      accountableId: args.accountableId,
      authorId: access.me._id,
      startAt: args.startAt,
      finishAt: args.finishAt,
      doneRatio: progress.doneRatio ?? wpProgress(status),
      estimatedHours: progress.estimatedHours ?? args.estimatedHours,
      remainingHours: progress.remainingHours ?? args.remainingHours,
      storyPoints: args.storyPoints,
      versionId: args.versionId,
      sprintId: args.sprintId,
      category: args.category?.trim() || undefined,
      parentId: args.parentId,
      scheduling,
      customFields,
      position: now,
      createdAt: now,
      updatedAt: now,
    });

    // Dates are derived DOWNSTREAM of this package (successors) and UPWARD
    // from it (an automatic parent spans its new child), whichever mode it is
    // in — a manual child still stretches an automatic parent.
    const moved = await rescheduleCascade(ctx, [id]);
    for (const movedId of moved.filter((m) => m !== id)) {
      await journalEntry(ctx, {
        projectId: args.projectId,
        workPackageId: movedId,
        authorId: access.me._id,
        kind: "change",
        changes: [{ field: "Dates", to: "rescheduled" }],
      });
    }

    await journalEntry(ctx, {
      projectId: args.projectId,
      workPackageId: id,
      authorId: access.me._id,
      kind: "change",
      changes: [
        { field: "type", to: args.type },
        { field: "status", to: status },
      ],
    });

    // The author follows their own package, exactly like OpenProject.
    await ctx.db.insert("wpWatchers", {
      projectId: args.projectId,
      workPackageId: id,
      userId: access.me._id,
      createdAt: now,
    });

    if (args.assigneeId) {
      const u = (await ctx.db.get(args.assigneeId)) as UserLite | null;
      await telegramDM(
        ctx,
        { name: u?.name, telegramUsername: u?.telegramUsername, telegramChatId: u?.telegramChatId },
        `🎯 New work package in “${access.project.name}”: ${args.type.replace("_", " ")} — ${subject}`,
        { name: access.me.name ?? access.me.email ?? undefined },
        "projects",
      );
    }
    return id;
  },
});

/**
 * Update a work package. Every changed field is diffed into a journal change
 * set so the Activity tab shows what moved, old → new, not just that it moved.
 *
 * `unset` clears nullable fields (pass e.g. ["assigneeId"]); a field listed
 * there is always applied as `undefined`, which is how Convex removes it.
 */
export const update = mutation({
  args: {
    id: v.id("workPackages"),
    subject: v.optional(v.string()),
    description: v.optional(v.string()),
    type: v.optional(typeValidator),
    status: v.optional(statusValidator),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    accountableId: v.optional(v.id("users")),
    startAt: v.optional(v.number()),
    finishAt: v.optional(v.number()),
    doneRatio: v.optional(v.number()),
    estimatedHours: v.optional(v.number()),
    remainingHours: v.optional(v.number()),
    storyPoints: v.optional(v.number()),
    versionId: v.optional(v.id("projectVersions")),
    sprintId: v.optional(v.id("wpSprints")),
    category: v.optional(v.string()),
    parentId: v.optional(v.id("workPackages")),
    scheduling: v.optional(schedulingValidator),
    customFields: v.optional(v.record(v.string(), customFieldValueValidator)),
    unset: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const wp = await ctx.db.get(args.id);
    if (!wp || wp.deleted) throw new ConvexError("Work package not found");
    const settings = await settingsFor(ctx, wp.projectId);
    const access = await canEdit(ctx, wp.projectId, wp.authorId, wp.assigneeId);

    // A member who is neither the author nor the assignee may still comment,
    // but not restructure the package.
    if (!access.canManage && !access.ownerish) {
      throw new ConvexError("Only the team leader, an admin, the author or the assignee can edit this");
    }
    const reassigning = args.assigneeId !== undefined || (args.unset ?? []).includes("assigneeId");
    const restructuring =
      args.subject !== undefined ||
      args.type !== undefined ||
      args.parentId !== undefined ||
      args.versionId !== undefined ||
      (args.unset ?? []).some((f) => ["assigneeId", "parentId", "versionId"].includes(f));
    if (!access.canManage && (reassigning || restructuring)) {
      throw new ConvexError("Only the team leader or an admin can reassign or restructure");
    }

    if (args.assigneeId) {
      const m = await membershipOf(ctx, wp.projectId, args.assigneeId);
      if (!m) throw new ConvexError("Assignee must be on this project's team");
    }
    if (args.parentId) {
      if (args.parentId === args.id) throw new ConvexError("A work package cannot be its own parent");
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== wp.projectId) {
        throw new ConvexError("Parent must be a work package of the same project");
      }
      // Walk up the chain: a cycle would detach the whole subtree from the list.
      let cursor = parent.parentId;
      for (let depth = 0; cursor && depth < 50; depth++) {
        if (cursor === args.id) throw new ConvexError("That parent would create a cycle");
        const next = await ctx.db.get(cursor);
        cursor = next?.parentId;
      }
    }

    const patch: Record<string, unknown> = {};
    const changes: { field: string; from?: string; to?: string }[] = [];
    const now = Date.now();

    /** Record a diff only when the value genuinely changed. */
    const set = (field: string, next: unknown, prev: unknown) => {
      if (next === undefined) return;
      if (next === prev) return;
      patch[field] = next;
      changes.push({ field, from: label(prev), to: label(next) });
    };

    if (args.subject !== undefined) {
      const subject = args.subject.trim();
      if (subject.length < 2) throw new ConvexError("Subject is too short");
      set("subject", subject, wp.subject);
    }
    if (args.description !== undefined) {
      set("description", args.description.trim() || undefined, wp.description);
    }
    if (args.type !== undefined) set("type", args.type, wp.type);
    if (args.priority !== undefined) set("priority", args.priority, wp.priority);
    if (args.category !== undefined) set("category", args.category.trim() || undefined, wp.category);
    if (args.startAt !== undefined) set("startAt", args.startAt, wp.startAt);
    if (args.finishAt !== undefined) set("finishAt", args.finishAt, wp.finishAt);
    if (args.estimatedHours !== undefined) set("estimatedHours", args.estimatedHours, wp.estimatedHours);
    if (args.storyPoints !== undefined) set("storyPoints", args.storyPoints, wp.storyPoints);
    if (args.scheduling !== undefined) set("scheduling", args.scheduling, wp.scheduling);

    // Progress follows the project's mode: work-based derives % Complete from
    // Work and Remaining work; status-based mirrors the status instead.
    const progress = progressPatchFor(
      settings,
      args.status ?? wp.status,
      {
        doneRatio: wp.doneRatio,
        estimatedHours: wp.estimatedHours,
        remainingHours: wp.remainingHours,
      },
      {
        doneRatio: args.doneRatio,
        estimatedHours: args.estimatedHours,
        remainingHours: args.remainingHours,
      },
    );
    if (progress.doneRatio !== undefined && progress.doneRatio !== wp.doneRatio) {
      set("doneRatio", progress.doneRatio, wp.doneRatio);
    }
    if (progress.remainingHours !== undefined && progress.remainingHours !== wp.remainingHours) {
      set("remainingHours", progress.remainingHours, wp.remainingHours);
    }

    // People, versions and parents are journalled with their NAMES, not ids.
    if (args.assigneeId !== undefined && args.assigneeId !== wp.assigneeId) {
      const from = await userNameOf(ctx, wp.assigneeId);
      const to = await userNameOf(ctx, args.assigneeId);
      patch.assigneeId = args.assigneeId;
      changes.push({ field: FIELD_LABEL.assigneeId, from: from ?? "nobody", to: to ?? "nobody" });
    }
    if (args.accountableId !== undefined && args.accountableId !== wp.accountableId) {
      const from = await userNameOf(ctx, wp.accountableId);
      const to = await userNameOf(ctx, args.accountableId);
      patch.accountableId = args.accountableId;
      changes.push({ field: FIELD_LABEL.accountableId, from: from ?? "nobody", to: to ?? "nobody" });
    }
    if (args.versionId !== undefined && args.versionId !== wp.versionId) {
      const from = wp.versionId ? (await ctx.db.get(wp.versionId))?.name : undefined;
      const to = args.versionId ? (await ctx.db.get(args.versionId))?.name : undefined;
      patch.versionId = args.versionId;
      changes.push({ field: FIELD_LABEL.versionId, from: from ?? "none", to: to ?? "none" });
    }
    if (args.sprintId !== undefined && args.sprintId !== wp.sprintId) {
      if (args.sprintId) {
        const sprint = await ctx.db.get(args.sprintId);
        if (!sprint || sprint.projectId !== wp.projectId) {
          throw new ConvexError("Sprint must belong to the same project");
        }
      }
      const from = wp.sprintId ? (await ctx.db.get(wp.sprintId))?.name : undefined;
      const to = args.sprintId ? (await ctx.db.get(args.sprintId))?.name : undefined;
      patch.sprintId = args.sprintId;
      changes.push({ field: FIELD_LABEL.sprintId, from: from ?? "backlog", to: to ?? "backlog" });
    }
    if (args.parentId !== undefined && args.parentId !== wp.parentId) {
      const from = wp.parentId ? (await ctx.db.get(wp.parentId))?.subject : undefined;
      const to = args.parentId ? (await ctx.db.get(args.parentId))?.subject : undefined;
      patch.parentId = args.parentId;
      changes.push({ field: FIELD_LABEL.parentId, from: from ?? "top level", to: to ?? "top level" });
    }

    if (args.customFields !== undefined) {
      const type = args.type ?? wp.type;
      const merged = { ...(wp.customFields ?? {}), ...args.customFields };
      const cleaned = await cleanCustomFields(ctx, wp.projectId, type, merged);
      patch.customFields = cleaned;
      changes.push({ field: "Custom fields", from: label(Object.keys(wp.customFields ?? {}).length), to: label(Object.keys(cleaned ?? {}).length) });
    }

    if (args.status !== undefined) {
      // The workflow gates the move, and a blocked package may not close.
      assertTransition(settings, args.type ?? wp.type, wp.status, args.status);
      if (isClosedStatus(args.status) && !isClosedStatus(wp.status)) {
        const blockers = await openBlockersOf(ctx, args.id);
        if (blockers.length > 0) {
          throw new ConvexError(
            `Blocked by “${blockers[0].subject}” — close that one first`,
          );
        }
      }
      set("status", args.status, wp.status);
      // A closing status stamps the completion date; leaving it clears it.
      const closing = isClosedStatus(args.status);
      patch.closedAt = closing ? (wp.closedAt ?? now) : undefined;
      if (closing && wp.doneRatio !== 100) {
        patch.doneRatio = 100;
        // The progress step above may already have journalled a derived
        // percentage; a close supersedes it rather than doubling up on it.
        const forced = { field: "doneRatio", from: label(wp.doneRatio), to: "100" };
        const existing = changes.findIndex((c) => c.field === "doneRatio");
        if (existing >= 0) changes[existing] = forced;
        else changes.push(forced);
      }
    }

    // Explicit clears. Assignee/accountable/version/parent carry no history
    // text of their own beyond the "—" the journal already renders.
    for (const field of args.unset ?? []) {
      if (!CLEARABLE.has(field)) continue;
      const prev = (wp as unknown as Record<string, unknown>)[field];
      if (prev === undefined) continue;
      patch[field] = undefined;
      if (!changes.some((c) => c.field === field || c.field === FIELD_LABEL[field])) {
        changes.push({ field: FIELD_LABEL[field] ?? field, from: label(prev) });
      }
    }

    if (Object.keys(patch).length === 0) return; // nothing to write, no journal noise
    await ctx.db.patch(args.id, { ...patch, updatedAt: now });

    // Automatic scheduling: recompute this package and any automatic ancestor
    // whose span it may have changed.
    // A manual edit still re-plans everything DERIVED from this package, so
    // the cascade runs whichever mode this one is in.
    const rescheduled = (await rescheduleCascade(ctx, [args.id])).filter((m) => m !== args.id);

    if (changes.length > 0) {
      await journalEntry(ctx, {
        projectId: wp.projectId,
        workPackageId: args.id,
        authorId: access.me._id,
        kind: "change",
        changes,
      });
    }

    for (const movedId of rescheduled) {
      await journalEntry(ctx, {
        projectId: wp.projectId,
        workPackageId: movedId,
        authorId: access.me._id,
        kind: "change",
        changes: [{ field: "Dates", to: "rescheduled" }],
      });
    }

    // Assignment changed → tell the new assignee.
    if (args.assigneeId !== undefined && args.assigneeId !== wp.assigneeId) {
      const u = (await ctx.db.get(args.assigneeId)) as UserLite | null;
      await telegramDM(
        ctx,
        { name: u?.name, telegramUsername: u?.telegramUsername, telegramChatId: u?.telegramChatId },
        `🎯 Assigned to you in “${access.project.name}”: ${(patch.subject as string | undefined) ?? wp.subject}`,
        { name: access.me.name ?? access.me.email ?? undefined },
        "projects",
      );
    }
    // Just closed → post to the club group, like the missions board does.
    if (patch.status !== undefined && isClosedStatus(args.status as string) && !isClosedStatus(wp.status)) {
      await telegramGroup(
        ctx,
        `✅ “${access.project.name}” — ${(patch.subject as string | undefined) ?? wp.subject} is ${String(args.status).replace("_", " ")}`,
        undefined,
        "projects",
      );
    }
  },
});

/** Human field names for the journal, so change sets read like OpenProject. */
const FIELD_LABEL: Record<string, string> = {
  description: "Description",
  assigneeId: "Assignee",
  accountableId: "Accountable",
  versionId: "Version",
  sprintId: "Sprint",
  parentId: "Parent",
  startAt: "Start date",
  finishAt: "Finish date",
  estimatedHours: "Estimated time",
  remainingHours: "Remaining work",
  storyPoints: "Story points",
  category: "Category",
};

/** Fields a caller may explicitly clear through `unset`. */
const CLEARABLE = new Set([
  "description",
  "assigneeId",
  "sprintId",
  "accountableId",
  "versionId",
  "parentId",
  "startAt",
  "finishAt",
  "estimatedHours",
  "remainingHours",
  "storyPoints",
  "category",
]);

/** Move a card on the board — a status change with optional reordering. */
export const move = mutation({
  args: {
    id: v.id("workPackages"),
    status: statusValidator,
    position: v.optional(v.number()),
  },
  handler: async (ctx, { id, status, position }) => {
    const wp = await ctx.db.get(id);
    if (!wp || wp.deleted) throw new ConvexError("Work package not found");
    const access = await canEdit(ctx, wp.projectId, wp.authorId, wp.assigneeId);
    if (!access.canManage && !access.ownerish) {
      throw new ConvexError("Only the team leader, an admin, the author or the assignee can move this");
    }
    if (wp.status === status && position === undefined) return;
    const settings = await settingsFor(ctx, wp.projectId);
    assertTransition(settings, wp.type, wp.status, status);
    const now = Date.now();
    const closing = isClosedStatus(status);
    // A blocked package cannot be closed, exactly as in OpenProject.
    if (closing && !isClosedStatus(wp.status)) {
      const blockers = await openBlockersOf(ctx, id);
      if (blockers.length > 0) {
        throw new ConvexError(`Blocked by “${blockers[0].subject}” — close that one first`);
      }
    }
    await ctx.db.patch(id, {
      status,
      position: position ?? Date.now(),
      closedAt: closing ? (wp.closedAt ?? now) : undefined,
      doneRatio: closing ? 100 : wp.doneRatio,
      updatedAt: now,
    });
    await journalEntry(ctx, {
      projectId: wp.projectId,
      workPackageId: id,
      authorId: access.me._id,
      kind: "change",
      changes: [{ field: "Status", from: label(wp.status), to: label(status) }],
    });
    // A moved predecessor re-plans its automatic successors; an automatic
    // package re-plans itself and its ancestors.
    await rescheduleCascade(ctx, [id]);
    if (closing && !isClosedStatus(wp.status)) {
      await telegramGroup(
        ctx,
        `✅ “${access.project.name}” — ${wp.subject} moved to ${status.replace("_", " ")}`,
        undefined,
        "projects",
      );
    }
  },
});

/** Soft delete — the journal and time entries stay for the record. */
export const remove = mutation({
  args: { id: v.id("workPackages") },
  handler: async (ctx, { id }) => {
    const wp = await ctx.db.get(id);
    if (!wp) return;
    const access = await canEdit(ctx, wp.projectId, wp.authorId, wp.assigneeId);
    if (!access.canManage && !access.ownerish) {
      throw new ConvexError("Only the team leader, an admin, the author or the assignee can delete this");
    }
    await ctx.db.patch(id, { deleted: true, updatedAt: Date.now() });
    // Relations pointing at a deleted package would dangle on the other side.
    const outRels = await ctx.db.query("wpRelations").withIndex("by_from", (q) => q.eq("fromId", id)).collect();
    const inRels = await ctx.db.query("wpRelations").withIndex("by_to", (q) => q.eq("toId", id)).collect();
    for (const r of [...outRels, ...inRels]) await ctx.db.delete(r._id);
    // Children are re-parented to the top level rather than orphaned.
    const kids = await ctx.db.query("workPackages").withIndex("by_parent", (q) => q.eq("parentId", id)).collect();
    for (const kid of kids) await ctx.db.patch(kid._id, { parentId: undefined, updatedAt: Date.now() });
  },
});

/** Bulk edit, the way OpenProject's multi-row context menu works. */
export const bulkUpdate = mutation({
  args: {
    ids: v.array(v.id("workPackages")),
    status: v.optional(statusValidator),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    clearAssignee: v.optional(v.boolean()),
    versionId: v.optional(v.id("projectVersions")),
    doneRatio: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.ids.length === 0) return { updated: 0 };
    const first = await ctx.db.get(args.ids[0]);
    if (!first) throw new ConvexError("Work package not found");
    const access = await requireProjectAccess(ctx, first.projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can bulk edit");
    const settings = await settingsFor(ctx, first.projectId);

    let updated = 0;
    for (const id of args.ids) {
      const wp = await ctx.db.get(id);
      if (!wp || wp.deleted || wp.projectId !== first.projectId) continue;
      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      const changes: { field: string; from?: string; to?: string }[] = [];      if (args.status !== undefined && args.status !== wp.status) {
        // The same workflow and blocker rules apply to a bulk change.
        assertTransition(settings, wp.type, wp.status, args.status);
        if (isClosedStatus(args.status) && !isClosedStatus(wp.status)) {
          const blockers = await openBlockersOf(ctx, id);
          if (blockers.length > 0) {
            throw new ConvexError(`“${wp.subject}” is blocked by “${blockers[0].subject}”`);
          }
        }
        patch.status = args.status;
        patch.closedAt = isClosedStatus(args.status) ? (wp.closedAt ?? Date.now()) : undefined;
        patch.doneRatio = isClosedStatus(args.status) ? 100 : wp.doneRatio;

        changes.push({ field: "Status", from: wp.status, to: args.status });
      }
      if (args.priority !== undefined && args.priority !== wp.priority) {
        patch.priority = args.priority;
        changes.push({ field: "priority", from: wp.priority, to: args.priority });
      }
      if (args.clearAssignee) {
        patch.assigneeId = undefined;
        changes.push({ field: "assigneeId", from: label(wp.assigneeId) });
      } else if (args.assigneeId !== undefined && args.assigneeId !== wp.assigneeId) {
        const m = await membershipOf(ctx, wp.projectId, args.assigneeId);
        if (!m) throw new ConvexError("Assignee must be on this project's team");
        patch.assigneeId = args.assigneeId;
        changes.push({ field: "assigneeId", to: label(args.assigneeId) });
      }
      if (args.versionId !== undefined && args.versionId !== wp.versionId) {
        patch.versionId = args.versionId;
        changes.push({ field: "versionId", to: label(args.versionId) });
      }
      if (args.doneRatio !== undefined) {
        patch.doneRatio = Math.max(0, Math.min(100, Math.round(args.doneRatio)));
        changes.push({ field: "doneRatio", from: label(wp.doneRatio), to: label(patch.doneRatio) });
      }
      await ctx.db.patch(id, patch);
      if (changes.length > 0) {
        await journalEntry(ctx, {
          projectId: wp.projectId,
          workPackageId: id,
          authorId: access.me._id,
          kind: "change",
          changes,
        });
      }
      updated++;
    }
    return { updated };
  },
});

/** Post a comment on the Activity tab. Any team member may comment. */
export const addComment = mutation({
  args: { id: v.id("workPackages"), body: v.string() },
  handler: async (ctx, { id, body }) => {
    const wp = await ctx.db.get(id);
    if (!wp || wp.deleted) throw new ConvexError("Work package not found");
    const access = await requireProjectAccess(ctx, wp.projectId);
    if (!access.isMember) throw new ConvexError("Join the project team to comment");
    const text = body.trim();
    if (text.length < 1) throw new ConvexError("Write something first");
    await journalEntry(ctx, {
      projectId: wp.projectId,
      workPackageId: id,
      authorId: access.me._id,
      kind: "comment",
      body: text,
    });
    // Commenting makes you a watcher — OpenProject counts you as a participant.
    const already = await ctx.db
      .query("wpWatchers")
      .withIndex("by_wp", (q) => q.eq("workPackageId", id))
      .collect();
    if (!already.some((w) => w.userId === access.me._id)) {
      await ctx.db.insert("wpWatchers", {
        projectId: wp.projectId,
        workPackageId: id,
        userId: access.me._id,
        createdAt: Date.now(),
      });
    }
    // @mentions notify the named team members, exactly like OpenProject.
    const mentioned = wpMentions(text);
    if (mentioned.length > 0) {
      const teamRows = await ctx.db
        .query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", wp.projectId))
        .collect();
      for (const handle of mentioned) {
        for (const row of teamRows.filter((r) => !r.leftAt && r.userId !== access.me._id)) {
          const u = (await ctx.db.get(row.userId)) as UserLite | null;
          if (!u) continue;
          const slug = (u.name ?? "").toLowerCase().replace(/[^\w]/g, "");
          const mail = (u.email ?? "").split("@")[0]?.toLowerCase();
          const tg = (u.telegramUsername ?? "").toLowerCase();
          if (handle !== slug && handle !== mail && handle !== tg) continue;
          await telegramDM(
            ctx,
            {
              name: u.name,
              telegramUsername: u.telegramUsername,
              telegramChatId: u.telegramChatId,
            },
            `💬 ${access.me.name ?? access.me.email ?? "Someone"} mentioned you on “${wp.subject}”: ${text.slice(0, 200)}`,
            { name: access.me.name ?? access.me.email ?? undefined },
            "projects",
          );
          break;
        }
      }
    }

    // Notify the assignee when someone else comments.
    if (wp.assigneeId && wp.assigneeId !== access.me._id) {
      const u = (await ctx.db.get(wp.assigneeId)) as UserLite | null;
      await telegramDM(
        ctx,
        { name: u?.name, telegramUsername: u?.telegramUsername, telegramChatId: u?.telegramChatId },
        `💬 New comment on “${wp.subject}”: ${text.slice(0, 200)}`,
        { name: access.me.name ?? access.me.email ?? undefined },
        "projects",
      );
    }
  },
});

export const addWatcher = mutation({
  args: { id: v.id("workPackages"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { id, userId }) => {
    const wp = await ctx.db.get(id);
    if (!wp || wp.deleted) throw new ConvexError("Work package not found");
    const access = await requireProjectAccess(ctx, wp.projectId);
    const target = userId ?? access.me._id;
    if (!access.isMember) throw new ConvexError("Join the project team to watch");
    const rows = await ctx.db
      .query("wpWatchers")
      .withIndex("by_wp", (q) => q.eq("workPackageId", id))
      .collect();
    if (rows.some((w) => w.userId === target)) return;
    await ctx.db.insert("wpWatchers", {
      projectId: wp.projectId,
      workPackageId: id,
      userId: target,
      createdAt: Date.now(),
    });
  },
});

export const removeWatcher = mutation({
  args: { id: v.id("workPackages"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { id, userId }) => {
    const wp = await ctx.db.get(id);
    if (!wp || wp.deleted) throw new ConvexError("Work package not found");
    const access = await requireProjectAccess(ctx, wp.projectId);
    const target = userId ?? access.me._id;
    if (target !== access.me._id && !access.canManage) {
      throw new ConvexError("Only the team leader or an admin can unwatch someone else");
    }
    const rows = await ctx.db
      .query("wpWatchers")
      .withIndex("by_wp", (q) => q.eq("workPackageId", id))
      .collect();
    for (const w of rows.filter((r) => r.userId === target)) await ctx.db.delete(w._id);
  },
});

export const addRelation = mutation({
  args: {
    fromId: v.id("workPackages"),
    toId: v.id("workPackages"),
    type: relationValidator,
    lagDays: v.optional(v.number()),
  },
  handler: async (ctx, { fromId, toId, type, lagDays }) => {
    if (fromId === toId) throw new ConvexError("A work package cannot relate to itself");
    const from = await ctx.db.get(fromId);
    const to = await ctx.db.get(toId);
    if (!from || !to || from.deleted || to.deleted) throw new ConvexError("Work package not found");
    if (from.projectId !== to.projectId) {
      throw new ConvexError("Both work packages must belong to the same project");
    }
    const access = await requireProjectAccess(ctx, from.projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can add relations");
    const existing = await ctx.db
      .query("wpRelations")
      .withIndex("by_from", (q) => q.eq("fromId", fromId))
      .collect();
    const dup =
      existing.find((r) => r.toId === toId && r.type === type) ??
      (
        await ctx.db.query("wpRelations").withIndex("by_to", (q) => q.eq("toId", fromId)).collect()
      ).find((r) => r.fromId === toId && r.type === type);
    if (dup) throw new ConvexError("That relation already exists");
    await ctx.db.insert("wpRelations", {
      projectId: from.projectId,
      fromId,
      toId,
      type,
      lagDays,
      createdBy: access.me._id,
      createdAt: Date.now(),
    });
    // A new predecessor (or a child) can move automatic dates immediately.
    await rescheduleCascade(ctx, [toId]);
  },
});

export const removeRelation = mutation({
  args: { relationId: v.id("wpRelations") },
  handler: async (ctx, { relationId }) => {
    const rel = await ctx.db.get(relationId);
    if (!rel) return;
    const access = await requireProjectAccess(ctx, rel.projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can remove relations");
    await ctx.db.delete(relationId);
  },
});

/** Log time against a package (OpenProject: date + hours + activity). */
export const logTime = mutation({
  args: {
    id: v.id("workPackages"),
    hours: v.number(),
    activity: activityValidator,
    spentOn: v.number(),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const wp = await ctx.db.get(args.id);
    if (!wp || wp.deleted) throw new ConvexError("Work package not found");
    const access = await requireProjectAccess(ctx, wp.projectId);
    if (!access.isMember) throw new ConvexError("Join the project team to log time");
    const hours = Math.round(args.hours * 100) / 100;
    if (!(hours > 0)) throw new ConvexError("Hours must be greater than zero");
    if (hours > 24 * 31) throw new ConvexError("That is more time than a month — check the number");
    await ctx.db.insert("wpTimeEntries", {
      projectId: wp.projectId,
      workPackageId: args.id,
      userId: access.me._id,
      hours,
      activity: args.activity,
      comment: args.comment?.trim() || undefined,
      spentOn: args.spentOn,
      createdAt: Date.now(),
    });
    // OpenProject maintains "Remaining work" from the estimate as time lands;
    // mirror that when an estimate exists.
    if (wp.estimatedHours !== undefined) {
      const spent = await ctx.db
        .query("wpTimeEntries")
        .withIndex("by_wp", (q) => q.eq("workPackageId", args.id))
        .collect();
      const total = spent.reduce((s, t) => s + t.hours, 0);
      await ctx.db.patch(args.id, {
        remainingHours: Math.max(0, Math.round((wp.estimatedHours - total) * 100) / 100),
        updatedAt: Date.now(),
      });
    }
  },
});

export const deleteTimeEntry = mutation({
  args: { entryId: v.id("wpTimeEntries") },
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get(entryId);
    if (!entry) return;
    const access = await requireProjectAccess(ctx, entry.projectId);
    if (entry.userId !== access.me._id && !access.canManage) {
      throw new ConvexError("Only the person who logged it, the leader or an admin can remove it");
    }
    await ctx.db.delete(entryId);
  },
});

// ---------- versions (release goals / milestones) ----------

export const upsertVersion = mutation({
  args: {
    projectId: v.id("projects"),
    id: v.optional(v.id("projectVersions")),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.optional(versionStatusValidator),
    startAt: v.optional(v.number()),
    effectiveAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectAccess(ctx, args.projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can manage versions");
    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Name is too short");
    const now = Date.now();
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.projectId !== args.projectId) {
        throw new ConvexError("Version not found");
      }
      await ctx.db.patch(args.id, {
        name,
        description: args.description?.trim() || undefined,
        status: args.status ?? existing.status,
        startAt: args.startAt ?? existing.startAt,
        effectiveAt: args.effectiveAt ?? existing.effectiveAt,
        updatedAt: now,
      });
      return args.id;
    }
    return ctx.db.insert("projectVersions", {
      projectId: args.projectId,
      name,
      description: args.description?.trim() || undefined,
      status: args.status ?? "open",
      startAt: args.startAt,
      effectiveAt: args.effectiveAt,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteVersion = mutation({
  args: { id: v.id("projectVersions") },
  handler: async (ctx, { id }) => {
    const version = await ctx.db.get(id);
    if (!version) return;
    const access = await requireProjectAccess(ctx, version.projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can manage versions");
    // Detach the packages that pointed at it rather than leaving a dead link.
    const rows = await ctx.db
      .query("workPackages")
      .withIndex("by_project", (q) => q.eq("projectId", version.projectId))
      .collect();
    for (const wp of rows.filter((r) => r.versionId === id)) {
      await ctx.db.patch(wp._id, { versionId: undefined, updatedAt: Date.now() });
    }
    await ctx.db.delete(id);
  },
});

// ---------- settings (progress mode, workflow, scheduling defaults) ----------

/**
 * Save the project's work-package configuration. Switching the progress mode
 * also re-derives every package's % Complete and Remaining work from the
 * stored estimates, which is what OpenProject does when the setting flips.
 */
export const saveSettings = mutation({
  args: {
    projectId: v.id("projects"),
    progressMode: progressModeValidator,
    scheduling: schedulingValidator,
    workingDaysOnly: v.boolean(),
    workflow: v.array(v.object({ type: v.string(), from: v.string(), to: v.string() })),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectAccess(ctx, args.projectId);
    if (!access.canManage) {
      throw new ConvexError("Only the team leader or an admin can change these settings");
    }
    // Drop rows naming a status or type that does not exist, so a stale client
    // can never poison the workflow into blocking everything.
    const workflowWanted = args.workflow.filter(
      (t) =>
        (WP_TYPES as readonly string[]).includes(t.type) &&
        (WP_STATUSES as readonly string[]).includes(t.from) &&
        (WP_STATUSES as readonly string[]).includes(t.to),
    );
    // Narrowed to the lib's vocabulary now that the members are known-good.
    const workflow = workflowWanted as WorkPackageTransition[];
    const existing = await ctx.db
      .query("wpSettings")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    const now = Date.now();
    const payload = {
      projectId: args.projectId,
      progressMode: args.progressMode,
      scheduling: args.scheduling,
      workingDaysOnly: args.workingDaysOnly,
      workflow,
      updatedBy: access.me._id,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, payload);
    else await ctx.db.insert("wpSettings", payload);

    const settings: WpSettings = {
      progressMode: args.progressMode,
      scheduling: args.scheduling,
      workingDaysOnly: args.workingDaysOnly,
      workflow,
    };
    const rows = (
      await ctx.db
        .query("workPackages")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect()
    ).filter((r) => !r.deleted);
    let redone = 0;
    for (const wp of rows) {
      const next = progressPatchFor(
        settings,
        wp.status,
        {
          doneRatio: wp.doneRatio,
          estimatedHours: wp.estimatedHours,
          remainingHours: wp.remainingHours,
        },
        {},
      );
      const patch: Record<string, unknown> = {};
      if (next.doneRatio !== undefined && next.doneRatio !== wp.doneRatio) patch.doneRatio = next.doneRatio;
      if (next.remainingHours !== undefined && next.remainingHours !== wp.remainingHours) {
        patch.remainingHours = next.remainingHours;
      }
      if (Object.keys(patch).length === 0) continue;
      await ctx.db.patch(wp._id, { ...patch, updatedAt: now });
      redone += 1;
    }
    return { workflowRows: workflow.length, progressRedone: redone };
  },
});

// ---------- custom fields ----------

export const upsertCustomField = mutation({
  args: {
    projectId: v.id("projects"),
    id: v.optional(v.id("wpCustomFields")),
    name: v.string(),
    fieldFormat: customFieldFormatValidator,
    possibleValues: v.optional(v.array(v.string())),
    types: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectAccess(ctx, args.projectId);
    if (!access.canManage) {
      throw new ConvexError("Only the team leader or an admin can configure custom fields");
    }
    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Field name is too short");
    const possibleValues =
      args.fieldFormat === "list"
        ? (args.possibleValues ?? []).map((s) => s.trim()).filter(Boolean)
        : undefined;
    if (args.fieldFormat === "list" && (possibleValues ?? []).length === 0) {
      throw new ConvexError("A list field needs at least one option");
    }
    const types = (args.types ?? []).filter((t) => (WP_TYPES as readonly string[]).includes(t));
    const now = Date.now();
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.projectId !== args.projectId) {
        throw new ConvexError("Custom field not found");
      }
      await ctx.db.patch(args.id, {
        name,
        fieldFormat: args.fieldFormat,
        possibleValues,
        types: args.types ? types : existing.types,
        updatedAt: now,
      });
      return args.id;
    }
    const count = (
      await ctx.db
        .query("wpCustomFields")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect()
    ).length;
    return ctx.db.insert("wpCustomFields", {
      projectId: args.projectId,
      name,
      fieldFormat: args.fieldFormat,
      possibleValues,
      types,
      position: count,
      createdBy: access.me._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteCustomField = mutation({
  args: { id: v.id("wpCustomFields") },
  handler: async (ctx, { id }) => {
    const def = await ctx.db.get(id);
    if (!def) return;
    const access = await requireProjectAccess(ctx, def.projectId);
    if (!access.canManage) {
      throw new ConvexError("Only the team leader or an admin can configure custom fields");
    }
    // Strip the value off every package before the definition disappears.
    const rows = await ctx.db
      .query("workPackages")
      .withIndex("by_project", (q) => q.eq("projectId", def.projectId))
      .collect();
    for (const wp of rows) {
      if (!wp.customFields || !(id as string in wp.customFields)) continue;
      const next = { ...wp.customFields };
      delete next[id as string];
      await ctx.db.patch(wp._id, { customFields: next, updatedAt: Date.now() });
    }
    await ctx.db.delete(id);
  },
});

// ---------- sprints (the Backlogs module) ----------

export const upsertSprint = mutation({
  args: {
    projectId: v.id("projects"),
    id: v.optional(v.id("wpSprints")),
    name: v.string(),
    goal: v.optional(v.string()),
    status: v.optional(sprintStatusValidator),
    startAt: v.optional(v.number()),
    finishAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectAccess(ctx, args.projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can plan sprints");
    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Sprint name is too short");
    if (args.startAt !== undefined && args.finishAt !== undefined && args.finishAt < args.startAt) {
      throw new ConvexError("The sprint ends before it starts");
    }
    const now = Date.now();
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.projectId !== args.projectId) throw new ConvexError("Sprint not found");
      await ctx.db.patch(args.id, {
        name,
        goal: args.goal?.trim() || undefined,
        status: args.status ?? existing.status,
        startAt: args.startAt ?? existing.startAt,
        finishAt: args.finishAt ?? existing.finishAt,
        updatedAt: now,
      });
      return args.id;
    }
    const count = (
      await ctx.db
        .query("wpSprints")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect()
    ).length;
    return ctx.db.insert("wpSprints", {
      projectId: args.projectId,
      name,
      goal: args.goal?.trim() || undefined,
      status: args.status ?? "open",
      startAt: args.startAt,
      finishAt: args.finishAt,
      position: count,
      createdBy: access.me._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Start or close a sprint. Closing returns its unfinished packages to the
 * backlog, which is what a Backlogs board does at the end of a sprint.
 */
export const setSprintStatus = mutation({
  args: { id: v.id("wpSprints"), status: sprintStatusValidator },
  handler: async (ctx, { id, status }) => {
    const sprint = await ctx.db.get(id);
    if (!sprint) throw new ConvexError("Sprint not found");
    const access = await requireProjectAccess(ctx, sprint.projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can plan sprints");
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    if (status !== "closed") return { returned: 0 };
    const rows = await ctx.db
      .query("workPackages")
      .withIndex("by_sprint", (q) => q.eq("sprintId", id))
      .collect();
    let returned = 0;
    for (const wp of rows.filter((r) => !r.deleted && !wpIsClosed(r.status))) {
      await ctx.db.patch(wp._id, { sprintId: undefined, updatedAt: Date.now() });
      returned += 1;
    }
    return { returned };
  },
});

export const deleteSprint = mutation({
  args: { id: v.id("wpSprints") },
  handler: async (ctx, { id }) => {
    const sprint = await ctx.db.get(id);
    if (!sprint) return;
    const access = await requireProjectAccess(ctx, sprint.projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can plan sprints");
    const rows = await ctx.db
      .query("workPackages")
      .withIndex("by_sprint", (q) => q.eq("sprintId", id))
      .collect();
    for (const wp of rows) await ctx.db.patch(wp._id, { sprintId: undefined, updatedAt: Date.now() });
    await ctx.db.delete(id);
  },
});

// ---------- baselines (compare against a past state) ----------

export const createBaseline = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, args) => {
    const access = await requireProjectAccess(ctx, args.projectId);
    if (!access.canManage) {
      throw new ConvexError("Only the team leader or an admin can snapshot a baseline");
    }
    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Give the baseline a name");
    const rows = (
      await ctx.db
        .query("workPackages")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect()
    ).filter((r) => !r.deleted);
    const snapshot = rows.map((r) => ({
      id: r._id as string,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
      assigneeId: r.assigneeId as string | undefined,
      doneRatio: r.doneRatio,
      storyPoints: r.storyPoints,
      startAt: r.startAt,
      finishAt: r.finishAt,
      updatedAt: r.updatedAt,
    }));
    return ctx.db.insert("wpBaselines", {
      projectId: args.projectId,
      name,
      snapshot,
      createdBy: access.me._id,
      createdAt: Date.now(),
    });
  },
});

export const deleteBaseline = mutation({
  args: { id: v.id("wpBaselines") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    const access = await requireProjectAccess(ctx, row.projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can delete a baseline");
    await ctx.db.delete(id);
  },
});

// ---------- saved queries (named views) ----------

export const saveQuery = mutation({
  args: {
    projectId: v.id("projects"),
    id: v.optional(v.id("wpQueries")),
    name: v.string(),
    shared: v.optional(v.boolean()),
    config: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectAccess(ctx, args.projectId);
    if (!access.isMember) throw new ConvexError("Join the project team to save a view");
    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Give the view a name");
    const now = Date.now();
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (!existing || existing.projectId !== args.projectId) throw new ConvexError("View not found");
      if (existing.ownerId !== access.me._id && !access.canManage) {
        throw new ConvexError("Only the owner can change this view");
      }
      await ctx.db.patch(args.id, {
        name,
        shared: args.shared ?? existing.shared,
        config: args.config,
        updatedAt: now,
      });
      return args.id;
    }
    return ctx.db.insert("wpQueries", {
      projectId: args.projectId,
      name,
      ownerId: access.me._id,
      shared: args.shared ?? false,
      config: args.config,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteQuery = mutation({
  args: { id: v.id("wpQueries") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    const access = await requireProjectAccess(ctx, row.projectId);
    if (row.ownerId !== access.me._id && !access.canManage) {
      throw new ConvexError("Only the owner or a manager can delete this view");
    }
    await ctx.db.delete(id);
  },
});

// ---------- board moves, copying, rescheduling ----------

/**
 * The board's drop handler. One mutation covers every board mode — a drop can
 * change the status, the assignee, the version or the parent — and every rule
 * (workflow, blockers, journal, scheduling) is applied to it.
 */
export const moveCard = mutation({
  args: {
    id: v.id("workPackages"),
    status: v.optional(statusValidator),
    assigneeId: v.optional(v.id("users")),
    clearAssignee: v.optional(v.boolean()),
    versionId: v.optional(v.id("projectVersions")),
    clearVersion: v.optional(v.boolean()),
    parentId: v.optional(v.id("workPackages")),
    clearParent: v.optional(v.boolean()),
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const wp = await ctx.db.get(args.id);
    if (!wp || wp.deleted) throw new ConvexError("Work package not found");
    const access = await canEdit(ctx, wp.projectId, wp.authorId, wp.assigneeId);
    if (!access.canManage && !access.ownerish) {
      throw new ConvexError("Only the team leader, an admin, the author or the assignee can move this");
    }
    const settings = await settingsFor(ctx, wp.projectId);
    const now = Date.now();
    const patch: Record<string, unknown> = { position: args.position ?? now, updatedAt: now };
    const changes: { field: string; from?: string; to?: string }[] = [];

    if (args.status !== undefined && args.status !== wp.status) {
      assertTransition(settings, wp.type, wp.status, args.status);
      if (isClosedStatus(args.status)) {
        const blockers = await openBlockersOf(ctx, args.id);
        if (blockers.length > 0) {
          throw new ConvexError(`Blocked by “${blockers[0].subject}” — close that one first`);
        }
      }
      patch.status = args.status;
      patch.closedAt = isClosedStatus(args.status) ? (wp.closedAt ?? now) : undefined;
      if (isClosedStatus(args.status)) patch.doneRatio = 100;
      changes.push({ field: "Status", from: wp.status, to: args.status });
    }
    if (args.clearAssignee) {
      if (wp.assigneeId) {
        patch.assigneeId = undefined;
        changes.push({ field: FIELD_LABEL.assigneeId, from: await userNameOf(ctx, wp.assigneeId) });
      }
    } else if (args.assigneeId !== undefined && args.assigneeId !== wp.assigneeId) {
      const m = await membershipOf(ctx, wp.projectId, args.assigneeId);
      if (!m) throw new ConvexError("Assignee must be on this project's team");
      patch.assigneeId = args.assigneeId;
      changes.push({
        field: FIELD_LABEL.assigneeId,
        from: (await userNameOf(ctx, wp.assigneeId)) ?? "nobody",
        to: (await userNameOf(ctx, args.assigneeId)) ?? "nobody",
      });
    }
    if (args.clearVersion) {
      if (wp.versionId) {
        patch.versionId = undefined;
        changes.push({ field: FIELD_LABEL.versionId, from: (await ctx.db.get(wp.versionId))?.name });
      }
    } else if (args.versionId !== undefined && args.versionId !== wp.versionId) {
      const version = await ctx.db.get(args.versionId);
      if (!version || version.projectId !== wp.projectId) {
        throw new ConvexError("Version must belong to the same project");
      }
      patch.versionId = args.versionId;
      changes.push({ field: FIELD_LABEL.versionId, to: version.name });
    }
    if (args.clearParent) {
      if (wp.parentId) {
        patch.parentId = undefined;
        changes.push({ field: FIELD_LABEL.parentId, from: (await ctx.db.get(wp.parentId))?.subject });
      }
    } else if (args.parentId !== undefined && args.parentId !== wp.parentId) {
      if (args.parentId === args.id) throw new ConvexError("A work package cannot be its own parent");
      const parent = await ctx.db.get(args.parentId);
      if (!parent || parent.projectId !== wp.projectId) {
        throw new ConvexError("Parent must be a work package of the same project");
      }
      let cursor = parent.parentId;
      for (let depth = 0; cursor && depth < 50; depth += 1) {
        if (cursor === args.id) throw new ConvexError("That parent would create a cycle");
        const next = await ctx.db.get(cursor);
        cursor = next?.parentId;
      }
      patch.parentId = args.parentId;
      changes.push({ field: FIELD_LABEL.parentId, to: parent.subject });
    }

    await ctx.db.patch(args.id, patch);
    await journalEntry(ctx, {
      projectId: wp.projectId,
      workPackageId: args.id,
      authorId: access.me._id,
      kind: "change",
      changes,
    });
    await rescheduleCascade(ctx, [args.id]);
    if (patch.status !== undefined && isClosedStatus(args.status as string) && !isClosedStatus(wp.status)) {
      await telegramGroup(
        ctx,
        `✅ “${access.project.name}” — ${wp.subject} moved to ${String(args.status).replace("_", " ")}`,
        undefined,
        "projects",
      );
    }
  },
});

/** Copy a work package (optionally with its subtree) — OpenProject's "Copy". */
export const duplicate = mutation({
  args: { id: v.id("workPackages"), includeChildren: v.optional(v.boolean()) },
  handler: async (ctx, { id, includeChildren }) => {
    const wp = await ctx.db.get(id);
    if (!wp || wp.deleted) throw new ConvexError("Work package not found");
    const access = await requireProjectAccess(ctx, wp.projectId);
    if (!access.isMember) throw new ConvexError("Join the project team to copy work packages");
    const now = Date.now();

    // Copied field by field rather than spread: `_id`, `_creationTime`, the
    // soft-delete flag and the closed stamp must NOT come along for the ride.
    const copyOne = async (src: typeof wp, parentId?: Id<"workPackages">) => {
      const newId = await ctx.db.insert("workPackages", {
        projectId: src.projectId,
        type: src.type,
        subject: `${src.subject} (copy)`,
        description: src.description,
        status: "new",
        priority: src.priority,
        assigneeId: src.assigneeId,
        accountableId: src.accountableId,
        authorId: access.me._id,
        startAt: src.startAt,
        finishAt: src.finishAt,
        doneRatio: 0,
        remainingHours: src.estimatedHours,
        estimatedHours: src.estimatedHours,
        storyPoints: src.storyPoints,
        versionId: src.versionId,
        sprintId: src.sprintId,
        category: src.category,
        parentId: parentId ?? src.parentId,
        scheduling: src.scheduling,
        customFields: src.customFields,
        position: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("wpWatchers", {
        projectId: src.projectId,
        workPackageId: newId,
        userId: access.me._id,
        createdAt: now,
      });
      await journalEntry(ctx, {
        projectId: src.projectId,
        workPackageId: newId,
        authorId: access.me._id,
        kind: "change",
        changes: [{ field: "Copied from", to: `#${(src._id as string).slice(-4).toUpperCase()}` }],
      });
      return newId;
    };

    const copyId = await copyOne(wp);
    if (includeChildren) {
      const kids = (
        await ctx.db
          .query("workPackages")
          .withIndex("by_parent", (q) => q.eq("parentId", id))
          .collect()
      ).filter((k) => !k.deleted);
      for (const kid of kids) await copyOne(kid, copyId);
    }
    return copyId;
  },
});

/** Recompute every automatic date in the project (a manual "Reschedule"). */
export const rescheduleAll = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const access = await requireProjectAccess(ctx, projectId);
    if (!access.canManage) throw new ConvexError("Only the team leader or an admin can reschedule");
    const rows = (
      await ctx.db
        .query("workPackages")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect()
    ).filter((r) => !r.deleted && r.scheduling === "automatic");
    // Depth-sort so children settle before their parents read them.
    const byId = new Map(rows.map((r) => [r._id as string, r]));
    const depthOf = (r: (typeof rows)[number]) => {
      let d = 0;
      let p = r.parentId as string | undefined;
      while (p && d < 30) {
        d += 1;
        p = byId.get(p)?.parentId as string | undefined;
      }
      return d;
    };
    const ordered = rows.slice().sort((a, b) => depthOf(a) - depthOf(b));
    let moved = 0;
    for (const row of ordered) moved += (await rescheduleFrom(ctx, row._id)).length;
    return { moved };
  },
});
