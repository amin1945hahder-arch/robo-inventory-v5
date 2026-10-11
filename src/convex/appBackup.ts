import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib";
import {
  backupFileName,
  buildBackupZip,
  redactSecrets,
  type BackupMeta,
  type BackupTables,
} from "../lib/app-backup";
import {
  buildConvexBackupZip,
  convexBackupCounts,
  convexBackupFileName,
} from "../lib/convex-backup";

/**
 * Full-app data backup.
 *
 * The admin picks an APP-group topic + a day of the month; a cron sweep fires
 * the backup on that day and the APP BOT posts the .zip into the chosen
 * topic. A manual "Backup now" button runs the exact same pipeline.
 *
 * The archive contains:
 *   csv/<table>.csv — one spreadsheet CSV per table (like the Export studio)
 *   data.json       — structured dump (SQL-importable, columns match schema.sql)
 *   schema.sql      — CREATE TABLE statements (SQLite flavor)
 *
 * Deliberately EXCLUDED: device tokens (login secrets) and chat relay rows
 * (the database never stores conversation logs). Bot tokens in settings are
 * redacted. Oversized string values (inline base64 images) are stripped so
 * the archive stays deliverable through Telegram.
 */

// Tables included in the backup. Everything app-level; auth-internal tables
// and deviceTokens (login secrets) are out.
const BACKUP_TABLES = [
  "users",
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
  "rentalPackages",
  "rentals",
  "notifications",
  "settings",
  "profileRequests",
  "clubLists",
  "rankRequests",
  "printerRequests",
  "printers",
  "printerMaintenance",
  "filaments",
  "printJobs",
  "telegramTopics",
  "rentCardJobs",
] as const;

// user.image and any other inline base64 blobs are stripped from the dump.
const STRIP_FIELD_LIMIT = 20_000; // chars

function stripRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string" && v.length > STRIP_FIELD_LIMIT) {
      out[k] = `[stripped: ${v.length} chars]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Dump every backup table (the action can't touch ctx.db directly). */
export const dumpAllTables = internalQuery({
  args: {},
  handler: async (ctx): Promise<BackupTables> => {
    const tables: BackupTables = {};
    for (const name of BACKUP_TABLES) {
      const rows = (await (ctx.db.query(name) as any).collect()) as Record<
        string,
        unknown
      >[];
      tables[name] = rows.map(stripRow);
    }
    redactSecrets(tables);
    return tables;
  },
});

// ---- Backup schedule settings ---------------------------------------------

export type BackupSchedule = {
  enabled: boolean;
  /** Day of the month the auto-backup fires (1–28, UTC). 0 = off. */
  dayOfMonth: number;
  /** APP-group topic the zip is posted into (message_thread_id). */
  threadId?: number;
  lastRunAt?: number;
  lastResult?: string;
};

const BACKUP_KEY = "data_backup_schedule";

export const getBackupSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return getBackupSchedule(ctx);
  },
});

async function getBackupSchedule(ctx: QueryCtx): Promise<BackupSchedule> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", BACKUP_KEY))
    .unique();
  const parsed = row?.value ? (JSON.parse(row.value) as BackupSchedule) : null;
  return {
    enabled: parsed?.enabled ?? false,
    dayOfMonth: parsed?.dayOfMonth ?? 1,
    threadId: parsed?.threadId,
    lastRunAt: parsed?.lastRunAt,
    lastResult: parsed?.lastResult,
  };
}

export const getBackupScheduleInternal = internalQuery({
  args: {},
  handler: async (ctx) => getBackupSchedule(ctx),
});

export const setBackupSettings = mutation({
  args: {
    enabled: v.boolean(),
    dayOfMonth: v.number(),
    threadId: v.optional(v.number()),
  },
  handler: async (ctx, { enabled, dayOfMonth, threadId }) => {
    await requireAdmin(ctx);
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 0 || dayOfMonth > 28) {
      throw new ConvexError("Day must be 1–28 (0 disables the schedule)");
    }
    const next: BackupSchedule = {
      enabled,
      dayOfMonth,
      threadId: threadId && threadId > 0 ? threadId : undefined,
    };
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", BACKUP_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: JSON.stringify(next) });
    else await ctx.db.insert("settings", { key: BACKUP_KEY, value: JSON.stringify(next) });
    return { ok: true };
  },
});

// ---- The backup pipeline ----------------------------------------------------

async function buildAndSend(
  ctx: any,
  trigger: "manual" | "scheduled",
): Promise<{ sent: boolean; reason?: string; fileName: string; bytes: number }> {
  const tables = await ctx.runQuery(internal.appBackup.dumpAllTables, {});
  const generatedAt = Date.now();
  const meta: BackupMeta = {
    app: "RC — Robotics Club Inventory",
    generatedAt,
    version: 1,
  };
  const dataBase64 = await buildBackupZip(tables, meta);
  const fileName = backupFileName(generatedAt);
  const schedule = await ctx.runQuery(internal.appBackup.getBackupScheduleInternal, {});

  // Second archive: the SAME data in the exact format `npx convex import
  // <file>.zip --replace` understands — one <table>.json per table. Restore
  // = download both zips, `convex import` the convex one, done.
  let convexFileName: string | undefined;
  let convexSent = false;
  try {
    const convexBase64 = await buildConvexBackupZip(tables, generatedAt);
    convexFileName = convexBackupFileName(generatedAt);
    const convexRes = (await ctx.runAction(internal.telegram.sendBackupFile, {
      fileName: convexFileName,
      dataBase64: convexBase64,
      caption: `♻️ Convex import backup — restore with:\nnpx convex import ${convexFileName} --replace\n\n${convexBackupCounts(tables)}`,
      bot: "app",
      threadId: schedule?.threadId,
    })) as { sent: boolean; reason?: string };
    convexSent = convexRes.sent;
  } catch {
    // The human-readable archive above already succeeded — never fail the
    // whole backup because the second file didn't go through.
  }

  const res = (await ctx.runAction(internal.telegram.sendBackupFile, {
    fileName,
    dataBase64,    caption:
      `🗂️ ${trigger === "manual" ? "Manual" : "Scheduled"} full backup${convexSent ? " + convex-import copy" : ""} — ${(
        Object.entries(tables) as [string, Record<string, unknown>[]][]
      )
        .filter(([, rows]) => rows.length > 0)
        .map(([name, rows]) => `${name}: ${rows.length}`)
        .join(",")}`,
    bot: "app",
    threadId: schedule?.threadId,
  })) as { sent: boolean; reason?: string };

  const bytes = Math.round((dataBase64.length * 3) / 4);
  return { ...res, fileName, bytes };
}

/** Admin "Backup now": builds the zip and posts it to the configured topic. */
export const backupNow = action({
  args: {},
  handler: async (ctx) => {
    const me = await ctx.runQuery(internal.users.currentInternalUser, {});
    const u = me as { role?: string } | null;
    if (!u || u.role !== "admin") throw new ConvexError("Admin access required");
    return buildAndSend(ctx, "manual");
  },
});

/** Cron-triggered run (no auth — scheduled by the sweep). */
export const runScheduledBackup = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await buildAndSend(ctx, "scheduled");
      await ctx.runMutation(internal.appBackup.recordResult, {
        ok: res.sent,
        detail: res.sent
          ? `${res.fileName} (${Math.round(res.bytes / 1024)} KB)`
          : (res.reason ?? "send failed"),
      });
      return res;
    } catch (e) {
      await ctx.runMutation(internal.appBackup.recordResult, {
        ok: false,
        detail: e instanceof Error ? e.message : "backup crashed",
      });
      throw e;
    }
  },
});

/**
 * Hourly sweep: on the configured day (UTC), fire the scheduled backup once.
 * The mutation marks lastRunAt BEFORE launching the action, so a crashed send
 * never loops all day.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const schedule = await getBackupSchedule(ctx);
    if (!schedule.enabled || !schedule.dayOfMonth) return { fired: false };
    const now = new Date();
    if (now.getUTCDate() !== schedule.dayOfMonth) return { fired: false };
    if (schedule.lastRunAt) {
      const last = new Date(schedule.lastRunAt);
      if (
        last.getUTCFullYear() === now.getUTCFullYear() &&
        last.getUTCMonth() === now.getUTCMonth() &&
        last.getUTCDate() === now.getUTCDate()
      ) {
        return { fired: false };
      }
    }
    const next: BackupSchedule = {
      ...schedule,
      lastRunAt: Date.now(),
      lastResult: "fired",
    };
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", BACKUP_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: JSON.stringify(next) });
    else await ctx.db.insert("settings", { key: BACKUP_KEY, value: JSON.stringify(next) });
    await ctx.scheduler.runAfter(0, internal.appBackup.runScheduledBackup, {});
    return { fired: true };
  },
});

/** Record the outcome of a scheduled run (fire-and-forget status line). */
export const recordResult = internalMutation({
  args: { ok: v.boolean(), detail: v.string() },
  handler: async (ctx, { ok, detail }) => {
    const schedule = await getBackupSchedule(ctx);
    const next: BackupSchedule = {
      ...schedule,
      lastResult: `${ok ? "ok" : "failed"}: ${detail}`.slice(0, 200),
    };
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", BACKUP_KEY))
      .unique();
    if (row) await ctx.db.patch(row._id, { value: JSON.stringify(next) });
  },
});
