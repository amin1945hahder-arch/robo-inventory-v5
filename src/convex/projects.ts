import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireNonStudent, requireUser } from "./lib";
import { touchPatch, recordTombstone } from "./sync";

export const listProjects = query({
  args: { status: v.optional(v.union(v.literal("active"), v.literal("completed"), v.literal("dismantled"))) },
  handler: async (ctx, { status }) => {
    await requireUser(ctx);
    let rows = await ctx.db.query("projects").filter((q) => q.neq(q.field("deleted"), true)).collect();
    if (status) rows = rows.filter((p) => p.status === status);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// Projects list with the number of inventory parts currently checked out to
// each one — the only thing a project holds now.
export const listProjectsWithCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db
      .query("projects")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const counts = new Map<string, number>();
    for (const p of parts) {
      if (!p.currentProjectId) continue;
      counts.set(p.currentProjectId, (counts.get(p.currentProjectId) ?? 0) + 1);
    }
    return rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((project) => ({ project, partCount: counts.get(project._id) ?? 0 }));
  },
});

export const getProject = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    await requireNonStudent(ctx);
    const project = await ctx.db.get(id);
    if (!project) return null;
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.eq(q.field("currentProjectId"), id))
      .filter((q) => q.neq(q.field("deleted"), true))
      .collect();
    const out = [];
    for (const p of parts.sort((a, b) => a.tag.localeCompare(b.tag))) {
      const group = await ctx.db.get(p.groupId);
      out.push({ part: p, group });
    }
    return { project, parts: out };
  },
});

export const upsertProject = mutation({
  args: {
    id: v.optional(v.id("projects")),
    name: v.string(),
    description: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("completed"), v.literal("dismantled"))),
    ownerId: v.optional(v.id("users")),
    // Cover image (compressed data URL from the client or an external URL).
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, { id, name, description, status, ownerId, imageUrl }) => {
    await requireAdmin(ctx);
    const data = {
      name: name.trim(),
      description: description?.trim(),
      status: status ?? "active",
      ownerId,
      // "" clears the image; undefined leaves it untouched.
      ...(imageUrl !== undefined ? { imageUrl: imageUrl.trim() || undefined } : {}),
    };
    if (id) {
      await touchPatch(ctx, id, data);
      return id;
    }
    const projectId = await ctx.db.insert("projects", { ...data, updatedAt: Date.now() });
    return projectId;
  },
});

export const dismantleProject = mutation({
  args: { id: v.id("projects"), functional: v.boolean() },
  handler: async (ctx, { id, functional }) => {
    await requireAdmin(ctx);
    const project = await ctx.db.get(id);
    if (!project) throw new ConvexError("Project not found");
    if (project.status === "dismantled") throw new ConvexError("Project is already dismantled");
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.eq(q.field("currentProjectId"), id))
      .collect();
    for (const p of parts) {
      await touchPatch(ctx, p._id, {
        status: functional ? "available" : "broken",
        currentProjectId: undefined,
      });
    }
    await touchPatch(ctx, id, { status: "dismantled" });
  },
});

export const completeProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const project = await ctx.db.get(id);
    if (!project) throw new ConvexError("Project not found");
    await touchPatch(ctx, id, { status: "completed" });
  },
});

// Re-open a completed (or dismantled-with-parts-still-assigned) project for
// development — it becomes active again and parts can be assigned to it.
export const reactivateProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const project = await ctx.db.get(id);
    if (!project) throw new ConvexError("Project not found");
    if (project.status === "active") throw new ConvexError("Project is already active");
    await touchPatch(ctx, id, { status: "active" });
  },
});

export const deleteProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const parts = await ctx.db
      .query("parts")
      .filter((q) => q.eq(q.field("currentProjectId"), id))
      .collect();
    if (parts.length > 0) {
      throw new ConvexError("Project still has parts. Dismantle it first to release them.");
    }
    await ctx.db.delete(id);
    await recordTombstone(ctx, "projects", id);
  },
});
