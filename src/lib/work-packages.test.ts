import { describe, expect, it } from "vitest";
import {
  WP_DEFAULT_TRANSITIONS,
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
  wpAddWorkingDays,
  wpAllowedStatuses,
  wpApplyProgress,
  wpBurndown,
  wpDefaultWorkflow,
  wpDeriveParentDates,
  wpDiffBaseline,
  wpDurationDays,
  wpIsClosed,
  wpIsWeekend,
  wpMentions,
  wpNextWorkingDay,
  wpParseCfInput,
  wpProgress,
  wpScheduleAfterPredecessors,
  type WpBaselineItem,
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

describe("workflow defaults", () => {
  it("expands the default flow to a triple per type and status", () => {
    const wf = wpDefaultWorkflow();
    // one triple per type × per configured from-status target
    const perType = WP_STATUSES.reduce(
      (s, st) => s + WP_DEFAULT_TRANSITIONS[st].length,
      0,
    );
    expect(wf.length).toBe(WP_TYPES.length * perType);
    expect(wf.every((t) => WP_TYPES.includes(t.type))).toBe(true);
  });

  it("is permissive when no workflow is configured", () => {
    expect(wpAllowedStatuses(null, "task", "new")).toEqual([...WP_STATUSES]);
    expect(wpAllowedStatuses([], "bug", "in_progress")).toEqual([...WP_STATUSES]);
  });

  it("restricts targets to the configured transitions, keeping the current one", () => {
    const wf = [{ type: "bug" as const, from: "new" as const, to: "in_progress" as const }];
    expect(wpAllowedStatuses(wf, "bug", "new")).toEqual(["new", "in_progress"]);
    // Another TYPE's row does not leak into this one, and a from-status with
    // no rows keeps only itself (configured, but nothing reachable).
    expect(wpAllowedStatuses(wf, "task", "new")).toEqual(["new"]);
    expect(wpAllowedStatuses(wf, "bug", "closed")).toEqual(["closed"]);
  });

  it("never allows an unknown status as the base", () => {
    expect(wpAllowedStatuses(null, "task", "bogus")).toEqual([...WP_STATUSES]);
  });
});

describe("working-day math", () => {
  it("recognises weekends from the actual weekday", () => {
    for (const day of [1, 2, 3, 4, 5, 6, 0]) {
      const t = new Date(2026, 4, 4 + day).getTime(); // covers a full week
      expect(wpIsWeekend(t)).toBe(day === 0 || day === 6);
    }
  });

  it("rolls a Friday forward to Monday", () => {
    // 2026-05-01 is a Friday
    const friday = new Date(2026, 4, 1).getTime();
    expect(new Date(friday).getDay()).toBe(5);
    const next = wpNextWorkingDay(friday);
    expect(new Date(next).getDay()).toBe(1);
    expect(next - friday).toBe(3 * 86_400_000);
    // From Saturday it also lands on Monday.
    const saturday = new Date(2026, 4, 2).getTime();
    expect(wpNextWorkingDay(saturday) - saturday).toBe(2 * 86_400_000);
  });

  it("counts duration inclusively and skips weekends", () => {
    const friday = new Date(2026, 4, 1).getTime();
    expect(wpAddWorkingDays(friday, 1)).toBe(friday);
    expect(wpAddWorkingDays(friday, 2)).toBe(friday + 3 * 86_400_000); // Monday
    expect(wpDurationDays(friday, friday)).toBe(1);
    const monday = friday + 3 * 86_400_000;
    expect(wpDurationDays(friday, monday)).toBe(2);
    expect(wpDurationDays(friday, undefined)).toBeUndefined();
  });
});

describe("automatic scheduling", () => {
  it("starts a successor one working day after the latest predecessor", () => {
    const friday = new Date(2026, 4, 1).getTime();
    const out = wpScheduleAfterPredecessors({}, [{ finishAt: friday }]);
    expect(new Date(out.startAt!).getDay()).toBe(1); // Monday
    expect(out.finishAt).toBe(out.startAt); // one-day default duration
  });

  it("adds lag days on top of the default gap and keeps the duration", () => {
    const friday = new Date(2026, 4, 1).getTime();
    const monday = friday + 3 * 86_400_000;
    // current span: Mon..Fri = 5 working days
    const out = wpScheduleAfterPredecessors(
      { startAt: monday, finishAt: friday + 7 * 86_400_000 },
      [{ finishAt: friday, lagDays: 2 }],
    );
    expect(new Date(out.startAt!).getDay()).toBe(2); // Tuesday
    expect(wpDurationDays(out.startAt, out.finishAt)).toBe(5);
  });

  it("does nothing without dated predecessors", () => {
    expect(wpScheduleAfterPredecessors({ startAt: 1 }, [{}])).toEqual({});
    expect(wpScheduleAfterPredecessors({}, [])).toEqual({});
  });

  it("spans a parent across its children", () => {
    const a = new Date(2026, 4, 4).getTime();
    const b = new Date(2026, 4, 8).getTime();
    expect(wpDeriveParentDates([{ startAt: b, finishAt: b }, { startAt: a }])).toEqual({
      startAt: a,
      finishAt: b,
    });
    expect(wpDeriveParentDates([])).toEqual({});
  });
});

describe("progress modes", () => {
  it("work-based: derives % Complete from Work and Remaining work", () => {
    expect(
      wpApplyProgress("work_based", 0, { estimatedHours: 8, remainingHours: 8, doneRatio: 0 }, { remainingHours: 4 }),
    ).toEqual({ remainingHours:  4, doneRatio: 50 });
  });

  it("work-based: derives Remaining work from Work and % Complete", () => {
    expect(
      wpApplyProgress("work_based", 0, { doneRatio: 0 }, { estimatedHours: 10, doneRatio: 50 }),
    ).toEqual({ estimatedHours: 10, doneRatio: 50, remainingHours: 5 });
  });

  it("work-based: 100% complete forces Remaining work to zero", () => {
    expect(
      wpApplyProgress("work_based", 100, { estimatedHours: 8, remainingHours: 3, doneRatio: 30 }, { doneRatio: 100 }),
    ).toEqual({ doneRatio: 100, remainingHours: 0 });
  });

  it("status-based: the status dictates % Complete and Remaining work", () => {
    expect(
      wpApplyProgress("status_based", 40, { estimatedHours: 10, remainingHours: 10, doneRatio: 0 }, {}),
    ).toEqual({ doneRatio: 40, remainingHours: 6 });
    // Without a Work estimate only the percentage moves.
    expect(wpApplyProgress("status_based", 90, { doneRatio: 0 }, {})).toEqual({ doneRatio: 90 });
  });
});

describe("sprint burndown", () => {
  it("counts points still open at the end of each day", () => {
    const mon = new Date(2026, 4, 4).getTime();
    const fri = new Date(2026, 4, 8).getTime();
    const wed = new Date(2026, 4, 6, 23, 0).getTime();
    const { total, days } = wpBurndown(
      [
        { storyPoints: 5, closedAt: wed },
        { storyPoints: 3 },
        { storyPoints: 2, closedAt: mon }, // closed on day one
      ],
      { startAt: mon, finishAt: fri },
    );
    expect(total).toBe(10);
    expect(days).toHaveLength(5); // Mon..Fri inclusive
    expect(days[0].remaining).toBe(8); // the one closed same-day already left
    expect(days[1].remaining).toBe(8);
    expect(days[2].remaining).toBe(3); // Wednesday's story closed
    expect(days[4].remaining).toBe(3);
    expect(days[4].ideal).toBe(0);
    expect(days[0].ideal).toBe(10);
  });

  it("needs both sprint dates", () => {
    expect(wpBurndown([], {}).days).toEqual([]);
  });
});

describe("baseline comparison", () => {
  const snap = (over: Partial<WpBaselineItem>): WpBaselineItem => ({
    id: "wp1",
    subject: "Wire the driver",
    status: "new",
    priority: "normal",
    doneRatio: 0,
    updatedAt: 1,
    ...over,
  });

  it("marks added, removed and modified with the OLD values", () => {
    const diff = wpDiffBaseline(
      [snap({ status: "in_progress", doneRatio: 40 }), snap({ id: "wp2", subject: "New one" })],
      [snap({}), snap({ id: "wp3", subject: "Gone" })],
    )!;
    expect(diff.added).toEqual(["wp2"]);
    expect(diff.removed.map((r) => r.id)).toEqual(["wp3"]);
    expect(diff.modified.get("wp1")).toEqual({
      status: "In progress",
      doneRatio: "0",
    });
    expect(diff.modified.has("wp2")).toBe(false);
  });

  it("returns null without a snapshot instead of marking everything added", () => {
    expect(wpDiffBaseline([snap({})], null)).toBeNull();
    expect(wpDiffBaseline([snap({})], undefined)).toBeNull();
  });
});

describe("custom fields", () => {
  it("parses numbers strictly", () => {
    expect(wpParseCfInput("int", "12")).toEqual({ ok: true, value: 12 });
    expect(wpParseCfInput("int", "1.5").ok).toBe(false);
    expect(wpParseCfInput("float", "1.5")).toEqual({ ok: true, value: 1.5 });
    expect(wpParseCfInput("float", "abc").ok).toBe(false);
  });

  it("treats empty input as clearing the value", () => {
    expect(wpParseCfInput("text", "   ")).toEqual({ ok: true, value: undefined });
    expect(wpParseCfInput("list", "")).toEqual({ ok: true, value: undefined });
  });

  it("validates booleans, dates and list options", () => {
    expect(wpParseCfInput("bool", "yes")).toEqual({ ok: true, value: true });
    expect(wpParseCfInput("bool", "no")).toEqual({ ok: true, value: false });
    expect(wpParseCfInput("bool", "maybe").ok).toBe(false);
    expect(wpParseCfInput("date", "2026-05-01")).toEqual({ ok: true, value: "2026-05-01" });
    expect(wpParseCfInput("date", "tomorrow").ok).toBe(false);
    expect(wpParseCfInput("list", "A", ["A", "B"])).toEqual({ ok: true, value: "A" });
    expect(wpParseCfInput("list", "C", ["A", "B"]).ok).toBe(false);
  });
});

describe("mentions", () => {
  it("collects unique @usernames but not the one inside an email", () => {
    expect(wpMentions("@alice and @bob, cc @alice — mail foo@bar.com please")).toEqual([
      "alice",
      "bob",
    ]);
    expect(wpMentions("no mentions here")).toEqual([]);
  });
});
