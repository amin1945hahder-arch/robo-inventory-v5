import { describe, expect, it } from "vitest";
import {
  WP_PRIORITIES,
  WP_PRIORITY_META,
  WP_RELATION_META,
  WP_RELATION_TYPES,
  WP_STATUSES,
  WP_STATUS_META,
  WP_TYPES,
  WP_TYPE_META,
  dateToMs,
  msToDate,
  shortDate,
  wpIsClosed,
  wpProgress,
} from "./work-packages";

/**
 * The work-package vocabulary is data, not logic, so these tests guard the
 * rules the rest of the app reads off it: which statuses count as closed, what
 * % Complete a status implies, that both sides of every relation have a label,
 * and that the date helpers round-trip the yyyy-mm-dd an <input type="date">
 * produces.
 */

describe("status vocabulary", () => {
  it("gives every status a complete metadata entry", () => {
    for (const s of WP_STATUSES) {
      const meta = WP_STATUS_META[s];
      expect(meta, `missing meta for ${s}`).toBeTruthy();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.dot.length).toBeGreaterThan(0);
      expect(meta.badge.length).toBeGreaterThan(0);
      expect(meta.progress).toBeGreaterThanOrEqual(0);
      expect(meta.progress).toBeLessThanOrEqual(100);
    }
  });

  it("treats exactly Closed and Rejected as closing statuses", () => {
    const closed = WP_STATUSES.filter(wpIsClosed);
    // OpenProject configures which statuses close a work package; a status can
    // be flagged "closing", which is how Rejected normally counts as closed.
    expect(closed).toEqual(["closed", "rejected"]);
    expect(wpIsClosed("new")).toBe(false);
    expect(wpIsClosed("in_testing")).toBe(false);
    expect(wpIsClosed("test_failed")).toBe(false);
  });

  it("reports 100% for closing statuses and 0% for a brand-new one", () => {
    expect(wpProgress("closed")).toBe(100);
    expect(wpProgress("rejected")).toBe(100);
    expect(wpProgress("new")).toBe(0);
    // Every status resolves to a number, even an unknown one (falls back to 0).
    expect(wpProgress("something-removed-later")).toBe(0);
    for (const s of WP_STATUSES) expect(Number.isFinite(wpProgress(s))).toBe(true);
  });
});

describe("type and priority vocabulary", () => {
  it("labels every work-package type", () => {
    for (const t of WP_TYPES) {
      expect(WP_TYPE_META[t]?.label.length).toBeGreaterThan(0);
      expect(WP_TYPE_META[t]?.icon.length).toBeGreaterThan(0);
    }
    expect(WP_TYPES).toContain("milestone");
    expect(WP_TYPES).toContain("user_story");
  });

  it("orders priorities low → urgent", () => {
    const ranks = WP_PRIORITIES.map((p) => WP_PRIORITY_META[p].rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(WP_PRIORITY_META.urgent.rank).toBeGreaterThan(WP_PRIORITY_META.low.rank);
  });
});

describe("relations", () => {
  it("names both directions of every relation type", () => {
    for (const t of WP_RELATION_TYPES) {
      const meta = WP_RELATION_META[t];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.inverse.length).toBeGreaterThan(0);
      expect(meta.hint.length).toBeGreaterThan(0);
    }
    // The two that read differently from each side are the well-known ones.
    expect(WP_RELATION_META.blocks.inverse).toBe("Blocked by");
    expect(WP_RELATION_META.precedes.inverse).toBe("Follows");
    expect(WP_RELATION_META.includes.inverse).toBe("Part of");
    expect(WP_RELATION_META.duplicates.inverse).toBe("Duplicated by");
  });

  it("only marks predecessor/successor as scheduling-relevant", () => {
    const scheduled = WP_RELATION_TYPES.filter((t) => WP_RELATION_META[t].scheduled);
    expect(scheduled).toEqual(["precedes"]);
  });
});

describe("date helpers", () => {
  it("round-trips the value an <input type=\"date\"> produces", () => {
    const ms = dateToMs("2026-03-12");
    expect(ms).toBeDefined();
    expect(msToDate(ms)).toBe("2026-03-12");
  });

  it("rejects empty and malformed input instead of inventing a date", () => {
    expect(dateToMs("")).toBeUndefined();
    expect(dateToMs("not-a-date")).toBeUndefined();
    expect(dateToMs("2026-00-00")).toBeUndefined();
  });

  it("renders absent timestamps as an em dash", () => {
    expect(msToDate(undefined)).toBe("");
    expect(shortDate(undefined)).toBe("—");
    expect(shortDate(dateToMs("2026-03-12"))).toBe("12 Mar");
  });
});
