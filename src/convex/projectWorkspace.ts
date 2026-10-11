import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireNonStudent, safeImage } from "./lib";
import { telegramDM, telegramGroup } from "./notify";

/**
 * Project workspace — the professional working center behind the Projects tab.
 *
 * Every project gets:
 *  - a TEAM (projectMembers): a leader who assigns missions and follows the
 *    team, plus regular contributors, each optionally tied to a center.
 *  - six CENTERS (mechanical / electrical / inventory / programming /
 *    references / students), each holding its own mission board and notes.
 *  - MISSIONS (projectTasks): todo → doing → review → done, with priority,
 *    assignee and due date; the assignee is DM'd on Telegram on assignment
 *    and the club group is posted when a mission lands.
 *
 * Permissions: admins can do everything; the project LEADER manages the team
 * and missions of their own project; regular members can move the missions
 * they are assigned to and add notes. Students are blocked from this module
 * server-side (requireNonStudent), matching the app's RBAC matrix.
 */

const CENTERS = [
  "mechanical",
  "electrical",
  "inventory",
  "programming",
  "references",
  "students",
] as const;
type Center = (typeof CENTERS)[number];

const centerValidator = v.union(
  v.literal("mechanical"),
  v.literal("electrical"),
  v.literal("inventory"),
  v.literal("programming"),
  v.literal("references"),
  v.literal("students"),
);

const taskStatusValidator = v.union(
  v.literal("todo"),
  v.literal("doing"),
  v.literal("review"),
  v.literal("done"),
);

const priorityValidator = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent"),
);

const centerValidatorForMembers = v.union(
  v.literal("mechanical"),
  v.literal("electrical"),
  v.literal("programming"),
  v.literal("inventory"),
);

// ---------- internal helpers ----------

type MemberRow = {
  _id: Id<"projectMembers">;
  projectId: Id<"projects">;
  userId: Id<"users">;
  role: "leader" | "member";
  center?: "mechanical" | "electrical" | "programming" | "inventory";
  addedAt: number;
  addedBy?: Id<"users">;
  /** Set when the person left (ex-member) or a new team started. */
  leftAt?: number;
  /** Team epoch this membership belongs to. */
  team?: number;
};

async function myMembership(
  ctx: MutationCtx | QueryCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<MemberRow | null> {
  const rows: MemberRow[] = await ctx.db
    .query("projectMembers")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  // ACTIVE membership only: an ex-member (or a member of a previous team)
  // keeps their row for the record but carries no permissions.
  return rows.find((r) => r.userId === userId && !r.leftAt) ?? null;
}

type UserDoc = {
  _id: Id<"users">;
  name?: string;
  email?: string;
  image?: string;
  telegramUsername?: string;
  telegramChatId?: string;
  isAnonymous?: boolean;
  role?: string;
};

async function personRefOf(ctx: unknown, userId: Id<"users">): Promise<PersonRefLite> {
  const u = (await (ctx as any).db.get(userId)) as UserDoc | null;
  return {
    _id: userId,
    name: u?.name,
    telegramUsername: u?.telegramUsername,
    telegramChatId: u?.telegramChatId,
  };
}

type PersonRefLite = {
  _id: Id<"users">;
  name?: string;
  telegramUsername?: string;
  telegramChatId?: string;
};

// ---------- queries ----------

/** Lightweight rows for the Projects grid: team size, leader, task progress. */
export const listSummaries = query({
  args: {},
  handler: async (ctx) => {
    await requireNonStudent(ctx);
    const projects = await ctx.db
      .query("projects")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const allMembers = await ctx.db.query("projectMembers").collect();
    const allTasks = await ctx.db.query("projectTasks").collect();
    // Work packages are the OpenProject-style tracking plane; the grid shows
    // their roll-up next to the missions count so both read on one card.
    const allWps = (await ctx.db.query("workPackages").collect()).filter((w) => !w.deleted);

    const out = [];
    for (const p of projects.sort((a, b) => a.name.localeCompare(b.name))) {
      const members = allMembers.filter((m) => m.projectId === p._id);
      // The ACTIVE team only — previous teams are history, not headcount.
      const active = members.filter((m) => !m.leftAt);
      const tasks = allTasks.filter((t) => t.projectId === p._id);
      const leaderRow = active.find((m) => m.role === "leader");
      const ownerIdRow = active.find((m) => m.userId === p.ownerId);
      const ownerRow = leaderRow ?? ownerIdRow ?? null;
      const owner = ownerRow ? await ctx.db.get(ownerRow.userId) : null;
      const wps = allWps.filter((w) => w.projectId === p._id);
      const wpDone = wps.filter((w) => w.status === "closed" || w.status === "rejected").length;
      out.push({
        project: p,
        teamSize: active.length,
        leaderName: (owner?.name ?? owner?.email) as string | undefined,
        taskTotal: tasks.length,
        taskDone: tasks.filter((t) => t.status === "done").length,
        taskDoing: tasks.filter((t) => t.status === "doing" || t.status === "review").length,
        wpTotal: wps.length,
        wpDone,
        wpOpen: wps.length - wpDone,
        wpOverdue: wps.filter(
          (w) =>
            w.status !== "closed" &&
            w.status !== "rejected" &&
            w.finishAt !== undefined &&
            w.finishAt < Date.now(),
        ).length,
      });
    }
    return out;
  },
});

/** The full workspace for one project: team, missions, notes, parts, stats. */
export const workspace = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const me = await requireNonStudent(ctx);
    const project = await ctx.db.get(id);
    if (!project || project.deleted) return null;

    // Team with user join.
    const memberRows = await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .collect();
    const members = [];
    for (const m of memberRows.sort((a, b) => a.addedAt - b.addedAt)) {
      const u = await ctx.db.get(m.userId);
      if (!u) continue; // user was deleted; the row will be cleaned up lazily
      members.push({
        _id: m._id,
        userId: m.userId,
        role: m.role,
        center: m.center,
        addedAt: m.addedAt,
        leftAt: m.leftAt,
        team: m.team,
        user: {
          name: u.name,
          email: u.email,
          image: safeImage(u.image),
          appRole: u.role,
        },
      });
    }

    // Missions + notes with light user joins (assignee / creator names).
    const taskRows = await ctx.db
      .query("projectTasks")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .collect();
    const userCache = new Map<string, Promise<UserDoc | null>>();
    const getUser = (uid: Id<"users">) => {
      if (!userCache.has(uid)) userCache.set(uid, ctx.db.get(uid));
      return userCache.get(uid)!;
    };
    const tasks: {
      _id: Id<"projectTasks">;
      projectId: Id<"projects">;
      center: string;
      title: string;
      details?: string;
      status: "todo" | "doing" | "review" | "done";
      priority: "low" | "normal" | "high" | "urgent";
      assigneeId?: Id<"users">;
      createdBy: Id<"users">;
      createdAt: number;
      updatedAt: number;
      completedAt?: number;
      dueAt?: number;
      assigneeName?: string;
      assigneeImage?: string;
      creatorName?: string;
    }[] = [];
    for (const t of taskRows.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const assignee = t.assigneeId ? await getUser(t.assigneeId) : null;
      const creator = await getUser(t.createdBy);
      tasks.push({
        ...t,
        assigneeName: assignee?.name ?? assignee?.email,
        assigneeImage: safeImage(assignee?.image),
        creatorName: creator?.name ?? creator?.email,
      });
    }

    const noteRows = await ctx.db
      .query("projectNotes")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .collect();
    const notes = [];
    for (const n of noteRows.sort((a, b) => b.createdAt - a.createdAt)) {
      const creator = await getUser(n.createdBy);
      notes.push({ ...n, creatorName: creator?.name ?? creator?.email });
    }

    // Parts currently checked out to the project (with their group names).
    const partRows = await ctx.db
      .query("parts")
      .filter((q) => q.eq(q.field("currentProjectId"), id))
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const parts = [];
    for (const p of partRows.sort((a, b) => a.tag.localeCompare(b.tag))) {
      const group = await ctx.db.get(p.groupId);
      parts.push({ part: p, groupName: group?.name ?? "Unit" });
    }

    // Progress math: overall + per center.
    const done = tasks.filter((t) => t.status === "done").length;
    const stats = {
      taskTotal: tasks.length,
      done,
      doing: tasks.filter((t) => t.status === "doing").length,
      review: tasks.filter((t) => t.status === "review").length,
      todo: tasks.filter((t) => t.status === "todo").length,
      progressPct: tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100),
      perCenter: CENTERS.map((c) => {
        const ct = tasks.filter((t) => t.center === c);
        const cdone = ct.filter((t) => t.status === "done").length;
        return {
          center: c,
          total: ct.length,
          done: cdone,
          pct: ct.length === 0 ? 0 : Math.round((cdone / ct.length) * 100),
        };
      }),
    };

    const mine = members.find((m) => m.userId === me._id && !m.leftAt) ?? null;
    const myRole =
      me.role === "admin" ? ("admin" as const) : mine ? (mine.role as "leader" | "member") : null;
    const canManage = me.role === "admin" || mine?.role === "leader";

    return {
      project,
      members,
      tasks,
      notes,
      parts,
      stats,
      me: {
        userId: me._id,
        isMember: Boolean(mine),
        membershipRole: mine?.role ?? null,
        myRole,
        canManage,
      },
    };
  },
});

// ---------- team management ----------

/** Add a person to the project team (admin or the project leader). */
export const addMember = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    center: v.optional(centerValidatorForMembers),
  },
  handler: async (ctx, { projectId, userId, center }) => {
    const me = await requireNonStudent(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.deleted) throw new Error("Project not found");
    if (project.status === "dismantled") throw new Error("This project is dismantled");
    const mine = await myMembership(ctx, projectId, me._id);
    if (me.role !== "admin" && mine?.role !== "leader") {
      throw new Error("Only the team leader or an admin can add people");
    }
    const person = await ctx.db.get(userId);
    if (!person || person.isAnonymous) throw new Error("Person not found");

    const existing = await myMembership(ctx, projectId, userId);
    if (existing) {
      if (center !== undefined) await ctx.db.patch(existing._id, { center });
      return existing._id;
    }
    const rowId = await ctx.db.insert("projectMembers", {
      projectId,
      userId,
      role: "member",
      center,
      addedAt: Date.now(),
      addedBy: me._id,
      // Joining (or re-joining after leaving) always lands on the CURRENT
      // team — the old membership row stays behind as previous-team history.
      team: project.teamNo ?? 1,
    });

    const actor = { name: me.name ?? me.email ?? undefined };
    const ref = await personRefOf(ctx, userId);
    await telegramDM(
      ctx,
      ref,
      `🤖 You were added to the project “${project.name}”${center ? ` · ${center} center` : ""}.`,
      actor,
      "projects",
    );
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "project",
      text: `${me.name ?? me.email} added ${person.name ?? person.email} to ${project.name}`,
      link: `/projects/${projectId}`,
    });
    return rowId;
  },
});

/** Remove a person from the team; their open missions are unassigned. */
export const removeMember = mutation({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, { projectId, userId }) => {
    const me = await requireNonStudent(ctx);
    const mine = await myMembership(ctx, projectId, me._id);
    if (me.role !== "admin" && mine?.role !== "leader") {
      throw new Error("Only the team leader or an admin can remove people");
    }
    const target = await myMembership(ctx, projectId, userId);
    if (!target) return;
    if (target.role === "leader" && me.role !== "admin") {
      throw new Error("Only an admin can remove a team leader");
    }
    // Unassign their open missions so nothing dangles on a departed member.
    const tasks = await ctx.db
      .query("projectTasks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const t of tasks) {
      if (t.assigneeId === userId && t.status !== "done") {
        await ctx.db.patch(t._id, { assigneeId: undefined, updatedAt: Date.now() });
      }
    }
    await ctx.db.delete(target._id);
  },
});

/** Promote/demote within the team. Admin-only (leaders are appointed by the club). */
export const setMemberRole = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: v.union(v.literal("leader"), v.literal("member")),
  },
  handler: async (ctx, { projectId, userId, role }) => {
    await requireAdmin(ctx);
    const project = await ctx.db.get(projectId);
    const existing = await myMembership(ctx, projectId, userId);
    if (existing) {
      await ctx.db.patch(existing._id, { role });
    } else {
      await ctx.db.insert("projectMembers", {
        projectId,
        userId,
        role,
        addedAt: Date.now(),
        team: project?.teamNo ?? 1,
      });
    }
    if (role === "leader") {
      // The leader becomes the project owner (single canonical leader field).
      await ctx.db.patch(projectId, { ownerId: userId });
    } else if (project?.ownerId === userId) {
      // Demoting a leader also clears them as the canonical owner so every
      // "leader" surface (cards, summaries) reflects the change.
      await ctx.db.patch(projectId, { ownerId: undefined });
    }
  },
});

/**
 * Mark a person as an EX-MEMBER — for the record: the row stays with their
 * name, work and history fully attributed, but they carry no permissions and
 * stop counting as part of the active team.
 */
export const markMemberEx = mutation({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, { projectId, userId }) => {
    const me = await requireNonStudent(ctx);
    const mine = await myMembership(ctx, projectId, me._id);
    if (me.role !== "admin" && mine?.role !== "leader") {
      throw new Error("Only the team leader or an admin can update the team");
    }
    const target = await myMembership(ctx, projectId, userId);
    if (!target || target.leftAt) return;
    if (target.role === "leader" && me.role !== "admin") {
      throw new Error("Only an admin can change a team leader");
    }
    // Keep every mission/note as-is — the record must show who did the work.
    await ctx.db.patch(target._id, { leftAt: Date.now() });
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "project",
      text: `${me.name ?? me.email} marked a member as ex-member in the project record`,
      link: `/projects/${projectId}`,
    });
  },
});

/**
 * Start a NEW TEAM: every current member becomes the previous team (kept
 * with a “previous team” badge, missions/notes/README history untouched),
 * and later joins land on the fresh epoch.
 */
export const startNewTeam = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const me = await requireNonStudent(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.deleted) throw new Error("Project not found");
    if (project.status === "dismantled") throw new Error("This project is dismantled");
    const mine = await myMembership(ctx, projectId, me._id);
    if (me.role !== "admin" && mine?.role !== "leader") {
      throw new Error("Only the team leader or an admin can start a new team");
    }
    const now = Date.now();
    const teamNo = (project.teamNo ?? 1) + 1;
    await ctx.db.patch(projectId, { teamNo, updatedAt: now });
    const rows = await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const m of rows) {
      if (!m.leftAt) await ctx.db.patch(m._id, { leftAt: now });
    }
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "project",
      text: `${me.name ?? me.email} started a new team for ${project.name} — the previous team is now history`,
      link: `/projects/${projectId}`,
    });
  },
});

/** Set a member's center specialization (informational tag). */
export const setMemberCenter = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    center: v.optional(centerValidatorForMembers),
  },
  handler: async (ctx, { projectId, userId, center }) => {
    const me = await requireNonStudent(ctx);
    const mine = await myMembership(ctx, projectId, me._id);
    if (me.role !== "admin" && mine?.role !== "leader") {
      throw new Error("Only the team leader or an admin can change centers");
    }
    const target = await myMembership(ctx, projectId, userId);
    if (!target) throw new Error("That person is not on this team");
    await ctx.db.patch(target._id, { center });
  },
});

// ---------- missions (tasks) ----------

/** Create a mission in one center. Admin or leader. */
export const createTask = mutation({
  args: {
    projectId: v.id("projects"),
    center: centerValidator,
    title: v.string(),
    details: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, { projectId, center, title, details, priority, assigneeId, dueAt }) => {
    const me = await requireNonStudent(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.deleted) throw new Error("Project not found");
    const mine = await myMembership(ctx, projectId, me._id);
    if (me.role !== "admin" && mine?.role !== "leader") {
      throw new Error("Only the team leader or an admin can assign missions");
    }
    const clean = title.trim();
    if (clean.length < 2) throw new Error("Mission title is too short");
    if (assigneeId) {
      const assigneeRow = await myMembership(ctx, projectId, assigneeId);
      if (!assigneeRow) throw new Error("Assignee must be on this project's team");
    }
    const now = Date.now();
    const taskId = await ctx.db.insert("projectTasks", {
      projectId,
      center,
      title: clean,
      details: details?.trim() || undefined,
      status: "todo",
      priority: priority ?? "normal",
      assigneeId,
      createdBy: me._id,
      createdAt: now,
      updatedAt: now,
      dueAt,
    });

    if (assigneeId) {
      const ref = await personRefOf(ctx, assigneeId);
      await telegramDM(
        ctx,
        ref,
        `🎯 New mission in “${project.name}” (${center}): ${clean}`,
        { name: me.name ?? me.email ?? undefined },
        "projects",
      );
    }
    return taskId;
  },
});

/**
 * Update a mission. Managers (admin/leader) can edit everything; the
 * assignee (or creator) can move its status. Telegram + notifications fire
 * on assignment changes and completion.
 */
export const updateTask = mutation({
  args: {
    taskId: v.id("projectTasks"),
    title: v.optional(v.string()),
    details: v.optional(v.string()),
    status: v.optional(taskStatusValidator),
    priority: v.optional(priorityValidator),
    assigneeId: v.optional(v.id("users")),
    dueAt: v.optional(v.number()),
    center: v.optional(centerValidator),
  },
  handler: async (ctx, { taskId, title, details, status, priority, assigneeId, dueAt, center }) => {
    const me = await requireNonStudent(ctx);
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Mission not found");
    const mine = await myMembership(ctx, task.projectId, me._id);
    const isManager = me.role === "admin" || mine?.role === "leader";
    const isOwnerish = task.assigneeId === me._id || task.createdBy === me._id;
    if (!isManager && !isOwnerish) {
      throw new Error("Only the team leader, an admin, or the assignee can update this mission");
    }
    if (!isManager && (title !== undefined || assigneeId !== undefined || center !== undefined)) {
      throw new Error("Only the team leader or an admin can reassign or rename missions");
    }
    if (assigneeId) {
      const assigneeRow = await myMembership(ctx, task.projectId, assigneeId);
      if (!assigneeRow) throw new Error("Assignee must be on this project's team");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (title !== undefined) patch.title = title.trim();
    if (details !== undefined) patch.details = details.trim() || undefined;
    if (priority !== undefined) patch.priority = priority;
    if (center !== undefined) patch.center = center;
    if (dueAt !== undefined) patch.dueAt = dueAt;
    if (assigneeId !== undefined) patch.assigneeId = assigneeId;
    if (status !== undefined) {
      patch.status = status;
      patch.completedAt = status === "done" ? Date.now() : undefined;
    }
    await ctx.db.patch(taskId, patch);

    const project = await ctx.db.get(task.projectId);
    const projectName = project?.name ?? "a project";

    // Assigned to someone new → DM them.
    if (assigneeId !== undefined && assigneeId !== task.assigneeId) {
      const ref = await personRefOf(ctx, assigneeId);
      await telegramDM(ctx, ref, `🎯 Mission assigned in “${projectName}” (${task.center}): ${patch.title as string ?? task.title}`, {
        name: me.name ?? me.email ?? undefined,
      }, "projects");
    }
    // Mission completed → tell the club group + admin console.
    if (status === "done" && task.status !== "done") {
      const finalTitle = (patch.title as string | undefined) ?? task.title;
      await telegramGroup(ctx, `✅ “${projectName}” — ${task.center} mission completed: ${finalTitle}`, undefined, "projects");
      await ctx.db.insert("notifications", {
        forRole: "admin",
        type: "project",
        text: `${projectName}: ${task.center} mission “${finalTitle}” completed`,
        link: `/projects/${task.projectId}`,
      });
    }
  },
});

/** Delete a mission (admin/leader/creator). */
export const deleteTask = mutation({
  args: { taskId: v.id("projectTasks") },
  handler: async (ctx, { taskId }) => {
    const me = await requireNonStudent(ctx);
    const task = await ctx.db.get(taskId);
    if (!task) return;
    const mine = await myMembership(ctx, task.projectId, me._id);
    if (me.role !== "admin" && mine?.role !== "leader" && task.createdBy !== me._id) {
      throw new Error("Only the team leader, an admin, or the creator can delete this mission");
    }
    await ctx.db.delete(taskId);
  },
});

// ---------- notes / references ----------

/** Pin a note (or link) into one center. Any team member can contribute. */
export const addNote = mutation({
  args: {
    projectId: v.id("projects"),
    center: centerValidator,
    title: v.string(),
    body: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, center, title, body, url }) => {
    const me = await requireNonStudent(ctx);
    const project = await ctx.db.get(projectId);
    if (!project || project.deleted) throw new Error("Project not found");
    const mine = await myMembership(ctx, projectId, me._id);
    if (me.role !== "admin" && !mine) {
      throw new Error("Join the project team to contribute");
    }
    const clean = title.trim();
    if (clean.length < 2) throw new Error("Title is too short");
    if (url !== undefined && url.trim() !== "" && !/^https?:\/\//.test(url.trim())) {
      throw new Error("Links must start with http:// or https://");
    }
    return ctx.db.insert("projectNotes", {
      projectId,
      center,
      title: clean,
      body: body?.trim() || undefined,
      url: url?.trim() || undefined,
      createdBy: me._id,
      createdAt: Date.now(),
    });
  },
});

/** Remove a note: its author, the leader, or an admin. */
export const deleteNote = mutation({
  args: { noteId: v.id("projectNotes") },
  handler: async (ctx, { noteId }) => {
    const me = await requireNonStudent(ctx);
    const note = await ctx.db.get(noteId);
    if (!note) return;
    const mine = await myMembership(ctx, note.projectId, me._id);
    if (me.role !== "admin" && mine?.role !== "leader" && note.createdBy !== me._id) {
      throw new Error("Only the author, the leader, or an admin can remove this note");
    }
    await ctx.db.delete(noteId);
  },
});
