import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireNonStudent, safeImage } from "./lib";
import { telegramDM, telegramGroup } from "./notify";

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
  category?: string;
  parentId?: Id<"workPackages">;
  position: number;
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

    const [journal, relations, watchers, time, versions, members] = await Promise.all([
      ctx.db.query("wpJournal").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpRelations").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpWatchers").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("wpTimeEntries").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("projectVersions").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("projectMembers").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
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
        return {
          ...r,
          assigneeName: nameOf(r.assigneeId),
          assigneeImage: safeImage(assigned?.image),
          accountableName: nameOf(r.accountableId),
          authorName: nameOf(r.authorId),
          versionName: version?.name,
          parentSubject: r.parentId ? byId.get(r.parentId as string)?.subject : undefined,
          childCount: rows.filter((c) => c.parentId === r._id).length,
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
    };

    return {
      items,
      versions: versions
        .slice()
        .sort((a, b) => (a.effectiveAt ?? Infinity) - (b.effectiveAt ?? Infinity)),
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

    const [journal, outRels, inRels, watchers, time, children, candidates] = await Promise.all([
      ctx.db.query("wpJournal").withIndex("by_wp", (q) => q.eq("workPackageId", id)).collect(),
      ctx.db.query("wpRelations").withIndex("by_from", (q) => q.eq("fromId", id)).collect(),
      ctx.db.query("wpRelations").withIndex("by_to", (q) => q.eq("toId", id)).collect(),
      ctx.db.query("wpWatchers").withIndex("by_wp", (q) => q.eq("workPackageId", id)).collect(),
      ctx.db.query("wpTimeEntries").withIndex("by_wp", (q) => q.eq("workPackageId", id)).collect(),
      ctx.db.query("workPackages").withIndex("by_parent", (q) => q.eq("parentId", id)).collect(),
      ctx.db.query("workPackages").withIndex("by_project", (q) => q.eq("projectId", wp.projectId)).collect(),
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

    return {
      wp: {
        ...wp,
        assigneeName: wp.assigneeId ? nameOf(wp.assigneeId) : undefined,
        accountableName: wp.accountableId ? nameOf(wp.accountableId) : undefined,
        authorName: nameOf(wp.authorId),
        versionName: version?.name,
        parentSubject: parent?.subject,
      },
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
    category: v.optional(v.string()),
    parentId: v.optional(v.id("workPackages")),
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

    const status = args.status ?? "new";
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
      doneRatio: 0,
      estimatedHours: args.estimatedHours,
      remainingHours: args.remainingHours,
      storyPoints: args.storyPoints,
      versionId: args.versionId,
      category: args.category?.trim() || undefined,
      parentId: args.parentId,
      position: now,
      createdAt: now,
      updatedAt: now,
    });

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
    category: v.optional(v.string()),
    parentId: v.optional(v.id("workPackages")),
    unset: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const wp = await ctx.db.get(args.id);
    if (!wp || wp.deleted) throw new ConvexError("Work package not found");
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
    if (args.doneRatio !== undefined) {
      const pct = Math.max(0, Math.min(100, Math.round(args.doneRatio)));
      set("doneRatio", pct, wp.doneRatio);
    }
    if (args.estimatedHours !== undefined) set("estimatedHours", args.estimatedHours, wp.estimatedHours);
    if (args.remainingHours !== undefined) set("remainingHours", args.remainingHours, wp.remainingHours);
    if (args.storyPoints !== undefined) set("storyPoints", args.storyPoints, wp.storyPoints);
    if (args.assigneeId !== undefined) set("assigneeId", args.assigneeId, wp.assigneeId);
    if (args.accountableId !== undefined) set("accountableId", args.accountableId, wp.accountableId);
    if (args.versionId !== undefined) set("versionId", args.versionId, wp.versionId);
    if (args.parentId !== undefined) set("parentId", args.parentId, wp.parentId);

    if (args.status !== undefined) {
      set("status", args.status, wp.status);
      // A closing status stamps the completion date; leaving it clears it.
      const closing = isClosedStatus(args.status);
      patch.closedAt = closing ? (wp.closedAt ?? now) : undefined;
      if (closing) {
        patch.doneRatio = 100;
        changes.push({ field: "doneRatio", from: label(wp.doneRatio), to: "100" });
      }
    }

    // Explicit clears. Assignee/accountable/version/parent carry no history
    // text of their own beyond the "—" the journal already renders.
    for (const field of args.unset ?? []) {
      if (!CLEARABLE.has(field)) continue;
      const prev = (wp as unknown as Record<string, unknown>)[field];
      if (prev === undefined) continue;
      patch[field] = undefined;
      if (!changes.some((c) => c.field === field)) {
        changes.push({ field, from: label(prev) });
      }
    }

    if (Object.keys(patch).length === 0) return; // nothing to write, no journal noise
    await ctx.db.patch(args.id, { ...patch, updatedAt: now });

    if (changes.length > 0) {
      await journalEntry(ctx, {
        projectId: wp.projectId,
        workPackageId: args.id,
        authorId: access.me._id,
        kind: "change",
        changes,
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

/** Fields a caller may explicitly clear through `unset`. */
const CLEARABLE = new Set([
  "description",
  "assigneeId",
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
    const now = Date.now();
    const closing = isClosedStatus(status);
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
      changes: [{ field: "status", from: label(wp.status), to: label(status) }],
    });
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

    let updated = 0;
    for (const id of args.ids) {
      const wp = await ctx.db.get(id);
      if (!wp || wp.deleted || wp.projectId !== first.projectId) continue;
      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      const changes: { field: string; from?: string; to?: string }[] = [];
      if (args.status !== undefined && args.status !== wp.status) {
        patch.status = args.status;
        patch.closedAt = isClosedStatus(args.status) ? (wp.closedAt ?? Date.now()) : undefined;
        patch.doneRatio = isClosedStatus(args.status) ? 100 : wp.doneRatio;
        changes.push({ field: "status", from: wp.status, to: args.status });
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
