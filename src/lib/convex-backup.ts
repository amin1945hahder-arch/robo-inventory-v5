import JSZip from "jszip";

/**
 * Convex-import-format backup builder.
 *
 * Produces a zip that `npx convex import backup.zip --replace` accepts
 * directly: ONE JSON FILE PER TABLE, where each file contains a top-level
 * JSON array of that table's documents. Convex resolves internal id
 * references on import — that is what makes this format round-trippable,
 * unlike the human archive (csv + data.json + schema.sql).
 *
 * Deliberately excluded here too: deviceTokens (login secrets) and
 * deviceTokens (login secrets) are out. Rows come pre-redacted from appBackup's
 * dumpAllTables.
 */
export const CONVEX_BACKUP_TABLES = [
  "users",
  "closets",
  "categories",
  "groups",
  "parts",
  "projects",
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
  "telegramTopics",
  "labelsHistory",
  "printQueue",
  "pushSubscriptions",
  "seenRequests",
] as const;

export type ConvexBackupTables = Record<string, Record<string, unknown>[]>;

export function convexBackupFileName(generatedAt: number): string {
  const d = new Date(generatedAt);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `rc-convex-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours(),
  )}-${pad(d.getMinutes())}.zip`;
}

/**
 * Build the import-ready zip as base64 (matches the Telegram send pipeline's
 * `dataBase64` input). Empty tables are omitted; `_creationTime` is stripped
 * (Convex re-creates it) and `_id` is KEPT so cross-document references
 * resolve 1:1.
 */
export async function buildConvexBackupZip(
  tables: ConvexBackupTables,
  generatedAt: number,
): Promise<string> {
  const zip = new JSZip();
  const meta = {
    app: "RC — Robotics Club Inventory",
    kind: "convex-import",
    generatedAt,
    note: "Import with: npx convex import <this-file>.zip --replace  (one <table>.json per table; Convex regenerates ids and keeps internal references consistent)",
    tables: Object.keys(tables).sort(),
  };
  zip.file("_convex_backup_meta.json", JSON.stringify(meta, null, 2));
  for (const name of Object.keys(tables).sort()) {
    const rows = tables[name] ?? [];
    if (rows.length === 0) continue;
    const docs = rows.map(({ _creationTime, ...doc }) => {
      void _creationTime;
      return doc;
    });
    zip.file(`${name}.json`, JSON.stringify(docs));
  }
  return zip.generateAsync({ type: "base64", compression: "DEFLATE" });
}

/** "users: 12, parts: 340" caption helper. */
export function convexBackupCounts(tables: ConvexBackupTables): string {
  return Object.entries(tables)
    .filter(([, rows]) => rows.length > 0)
    .map(([name, rows]) => `${name}: ${rows.length}`)
    .join(", ");
}
