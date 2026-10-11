import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Storage + purge internals for the dangerous-zone database reset. Kept in a
 * non-Node module because Convex only allows actions in "use node" files; the
 * code storage and the purge must be mutations (and transactional).
 */

const CODE_KEY = "db_reset_code";

export const storeCode = internalMutation({
  args: { code: v.string(), expiresAt: v.number(), adminId: v.id("users") },
  handler: async (ctx, { code, expiresAt, adminId }) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", CODE_KEY))
      .unique();
    const value = JSON.stringify({ code, expiresAt, adminId });
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("settings", { key: CODE_KEY, value });
  },
});

export const getPending = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", CODE_KEY))
      .unique();
    if (!row?.value) return null;
    try {
      return JSON.parse(row.value) as { code: string; expiresAt: number; adminId: string };
    } catch {
      return null;
    }
  },
});

// The purge itself — one mutation, one transaction: all-or-nothing.
// Wipes EVERY app table (a true factory reset): inventory, projects, rentals,
// printing, chat relay, topics, and all settings (bot tokens, schedules…).
// No seed/demo data is ever re-created afterwards — the app starts empty.
export const purgeAll = internalMutation({
  args: { adminId: v.id("users") },
  handler: async (ctx, { adminId }) => {
    const counts: Record<string, number> = {};

    const wipe = async (table: string) => {
      const rows = await (ctx.db.query(table as any) as any).collect();
      for (const row of rows) await ctx.db.delete(row._id);
      counts[table] = rows.length;
    };

    // Every app table except users and the @convex-dev/auth internals.
    // Auth rows for deleted users are removed in the user loop below.
    for (const table of [
      "closets",
      "categories",
      "groups",
      "parts",
      "projects",
      "projectMembers",
      "projectTasks",
      "projectNotes",
      "workPackages",
      "wpJournal",
      "wpRelations",
      "wpWatchers",
      "projectVersions",
      "wpTimeEntries",
      "wpSprints",
      "wpBaselines",
      "wpCustomFields",
      "wpQueries",
      "wpSettings",
      "rentalPackages",
      "rentals",
      "notifications",
      "settings",
      "telegramTopics",
      "profileRequests",
      "clubLists",
      "rankRequests",
      "printerRequests",
      "printers",
      "printerMaintenance",
      "filaments",
      "printJobs",
      "rentCardJobs",
      "deviceTokens",
    ] as const) {
      await wipe(table);
    }

    // Users: delete everyone except the requesting admin. Their auth data
    // (accounts/sessions/tokens/codes) dies with them so old logins are dead.
    const users = await ctx.db.query("users").collect();
    const doomed = users.filter((u) => u._id !== adminId);
    for (const u of doomed) {
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", u._id))
        .collect();
      for (const acc of accounts) {
        const codes = await ctx.db
          .query("authVerificationCodes")
          .withIndex("accountId", (q) => q.eq("accountId", acc._id))
          .collect();
        for (const c of codes) await ctx.db.delete(c._id);
        await ctx.db.delete(acc._id);
      }
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", u._id))
        .collect();
      for (const s of sessions) {
        const refresh = await ctx.db
          .query("authRefreshTokens")
          .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
          .collect();
        for (const t of refresh) await ctx.db.delete(t._id);
        await ctx.db.delete(s._id);
      }
      await ctx.db.delete(u._id);
    }
    counts["users"] = doomed.length;

    // Clear the used code so the same code can never confirm twice.
    const codeRow = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", CODE_KEY))
      .unique();
    if (codeRow) await ctx.db.delete(codeRow._id);

    return counts;
  },
});
