/**
 * Shared metadata and PURE RULES for the Work Packages module — the club's
 * OpenProject-style tracking layer that sits inside every project.
 *
 * OpenProject deliberately keeps types, statuses, priorities and the workflow
 * *configurable per instance* (a status only becomes selectable once it is
 * part of the workflow for a work-package type + role). So rather than hard
 * coding the vocabulary into components, the documented out-of-the-box set
 * lives here as data and every screen reads from it. The rules that OpenProject
 * documents (progress modes, scheduling, working days, burndown, baseline
 * comparison) are implemented here as pure functions so both the Convex server
 * and the UI agree — and so they can be unit-tested.
 *
 * Field naming follows OpenProject so the two read the same way:
 *   subject · type · status · priority · assignee · accountable
 *   start date · finish date · % Complete · Work · Remaining work
 *   story points · version (release goal) · category · parent · sprint
 */

export const WP_TYPES = [
  "task",
  "milestone",
  "phase",
  "epic",
  "user_story",
  "feature",
  "bug",
] as const;
export type WorkPackageType = (typeof WP_TYPES)[number];

export const WP_TYPE_META: Record<
  WorkPackageType,
  { label: string; icon: string; color: string; badge: string; hex: string; milestone?: boolean }
> = {
  task: {
    label: "Task",
    icon: "☑",
    color: "text-sky-400",
    badge: "border-sky-500/30 bg-sky-500/15 text-sky-400",
    hex: "#38bdf8",
  },
  milestone: {
    label: "Milestone",
    icon: "🚩",
    color: "text-amber-400",
    badge: "border-amber-500/30 bg-amber-500/15 text-amber-400",
    hex: "#fbbf24",
    milestone: true,
  },
  phase: {
    label: "Phase",
    icon: "◆",
    color: "text-indigo-400",
    badge: "border-indigo-500/30 bg-indigo-500/15 text-indigo-400",
    hex: "#818cf8",
  },
  epic: {
    label: "Epic",
    icon: "🏔",
    color: "text-fuchsia-400",
    badge: "border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-400",
    hex: "#e879f9",
  },
  user_story: {
    label: "User story",
    icon: "📖",
    color: "text-teal-400",
    badge: "border-teal-500/30 bg-teal-500/15 text-teal-400",
    hex: "#2dd4bf",
  },
  feature: {
    label: "Feature",
    icon: "✨",
    color: "text-violet-400",
    badge: "border-violet-500/30 bg-violet-500/15 text-violet-400",
    hex: "#a78bfa",
  },
  bug: {
    label: "Bug",
    icon: "🐞",
    color: "text-red-400",
    badge: "border-red-500/30 bg-red-500/15 text-red-400",
    hex: "#f87171",
  },
};

/**
 * The shipping status set. `closed` marks the statuses that OpenProject treats
 * as closed — a status can be flagged "closing" in administration, which is
 * how `Rejected` normally ends up counting as closed.
 */
export const WP_STATUSES = [
  "new",
  "in_specification",
  "specified",
  "in_progress",
  "developed",
  "in_testing",
  "tested",
  "test_failed",
  "on_hold",
  "closed",
  "rejected",
] as const;
export type WorkPackageStatus = (typeof WP_STATUSES)[number];

export const WP_STATUS_META: Record<
  WorkPackageStatus,
  { label: string; dot: string; badge: string; closed?: boolean; progress: number }
> = {
  new: { label: "New", dot: "bg-muted-foreground/50", badge: "border-border bg-muted text-muted-foreground", progress: 0 },
  in_specification: { label: "In specification", dot: "bg-slate-400", badge: "border-slate-500/30 bg-slate-500/15 text-slate-300", progress: 10 },
  specified: { label: "Specified", dot: "bg-cyan-400", badge: "border-cyan-500/30 bg-cyan-500/15 text-cyan-400", progress: 20 },
  in_progress: { label: "In progress", dot: "bg-sky-400", badge: "border-sky-500/30 bg-sky-500/15 text-sky-400", progress: 40 },
  developed: { label: "Developed", dot: "bg-indigo-400", badge: "border-indigo-500/30 bg-indigo-500/15 text-indigo-400", progress: 60 },
  in_testing: { label: "In testing", dot: "bg-amber-400", badge: "border-amber-500/30 bg-amber-500/15 text-amber-400", progress: 75 },
  tested: { label: "Tested", dot: "bg-teal-400", badge: "border-teal-500/30 bg-teal-500/15 text-teal-400", progress: 90 },
  test_failed: { label: "Test failed", dot: "bg-rose-500", badge: "border-rose-500/30 bg-rose-500/15 text-rose-400", progress: 50 },
  on_hold: { label: "On hold", dot: "bg-zinc-400", badge: "border-zinc-500/30 bg-zinc-500/15 text-zinc-300", progress: 30 },
  closed: { label: "Closed", dot: "bg-emerald-400", badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400", closed: true, progress: 100 },
  rejected: { label: "Rejected", dot: "bg-red-500/60", badge: "border-red-500/25 bg-red-500/10 text-red-400", closed: true, progress: 100 },
};

export const WP_PRIORITIES = ["low", "normal", "high", "immediate", "urgent"] as const;
export type WorkPackagePriority = (typeof WP_PRIORITIES)[number];

export const WP_PRIORITY_META: Record<
  WorkPackagePriority,
  { label: string; badge: string; rank: number }
> = {
  low: { label: "Low", badge: "border-border bg-muted text-muted-foreground", rank: 0 },
  normal: { label: "Normal", badge: "border-border bg-muted text-foreground", rank: 1 },
  high: { label: "High", badge: "border-orange-500/30 bg-orange-500/15 text-orange-400", rank: 2 },
  immediate: { label: "Immediate", badge: "border-amber-500/30 bg-amber-500/15 text-amber-400", rank: 3 },
  urgent: { label: "Urgent", badge: "border-red-500/30 bg-red-500/15 text-red-400", rank: 4 },
};

/**
 * Relations. OpenProject stores a relation once and shows each side by its own
 * label, so every type carries both directions (`inverse`). Terminology
 * follows current OpenProject (15.1+): predecessor/successor for scheduling.
 */
export const WP_RELATION_TYPES = [
  "relates",
  "duplicates",
  "blocks",
  "precedes",
  "requires",
  "includes",
] as const;
export type WorkPackageRelationType = (typeof WP_RELATION_TYPES)[number];

export const WP_RELATION_META: Record<
  WorkPackageRelationType,
  { label: string; inverse: string; hint: string; scheduled?: boolean; blocksClosing?: boolean }
> = {
  relates: { label: "Related to", inverse: "Related to", hint: "Loose connection — no scheduling effect." },
  duplicates: { label: "Duplicates", inverse: "Duplicated by", hint: "The same work, recorded twice." },
  blocks: {
    label: "Blocks",
    inverse: "Blocked by",
    hint: "A blocked work package cannot be closed until its blocker is closed.",
    blocksClosing: true,
  },
  precedes: {
    label: "Precedes",
    inverse: "Follows",
    hint: "Predecessor → successor: in automatic scheduling the successor starts after this one finishes (plus lag).",
    scheduled: true,
  },
  requires: { label: "Requires", inverse: "Required by", hint: "Needs the other's output as input." },
  includes: { label: "Includes", inverse: "Part of", hint: "Container — the other is a part of this." },
};

/**
 * Progress reporting modes (OpenProject: an instance-wide setting).
 *  - "work_based":  % Complete = (Work − Remaining work) / Work; when two of
 *    the three values are known the third is derived.
 *  - "status_based": each status carries a fixed % Complete; changing status
 *    sets progress and Remaining work is derived from Work.
 */
export const WP_PROGRESS_MODES = ["work_based", "status_based"] as const;
export type WorkPackageProgressMode = (typeof WP_PROGRESS_MODES)[number];

export const WP_PROGRESS_MODE_LABEL: Record<WorkPackageProgressMode, string> = {
  work_based: "Work-based",
  status_based: "Status-based",
};

export const WP_PROGRESS_MODE_HINT: Record<WorkPackageProgressMode, string> = {
  work_based:
    "% Complete is entered manually or calculated from Work and Remaining work: (Work − Remaining) / Work.",
  status_based:
    "Each status carries a fixed % Complete; changing the status sets progress and derives Remaining work from Work.",
};

/** Scheduling modes (OpenProject 15.4+). New work packages default to manual. */
export const WP_SCHEDULING_MODES = ["manual", "automatic"] as const;
export type WorkPackageSchedulingMode = (typeof WP_SCHEDULING_MODES)[number];

export const WP_SCHEDULING_LABEL: Record<WorkPackageSchedulingMode, string> = {
  manual: "Manual",
  automatic: "Automatic",
};

export const WP_SCHEDULING_HINT: Record<WorkPackageSchedulingMode, string> = {
  manual: "Dates are chosen freely; predecessors and children do not move them.",
  automatic:
    "With predecessors the start follows the latest predecessor (+ lag); with children the dates span them.",
};

export const WP_VIEWS = ["table", "board", "gantt", "backlog", "settings"] as const;
export type WorkPackageView = (typeof WP_VIEWS)[number];

export const WP_VIEW_META: Record<WorkPackageView, { label: string; icon: string }> = {
  table: { label: "Table", icon: "▦" },
  board: { label: "Board", icon: "▤" },
  gantt: { label: "Gantt", icon: "▬" },
  backlog: { label: "Backlogs", icon: "⇅" },
  settings: { label: "Settings", icon: "⚙" },
};

/** What the table can group by (OpenProject: "Group by"). */
export const WP_GROUP_BY = [
  "none",
  "status",
  "type",
  "priority",
  "assignee",
  "version",
  "sprint",
  "category",
] as const;
export type WorkPackageGroupBy = (typeof WP_GROUP_BY)[number];

export const WP_GROUP_LABEL: Record<WorkPackageGroupBy, string> = {
  none: "Flat list",
  status: "Status",
  type: "Type",
  priority: "Priority",
  assignee: "Assignee",
  version: "Version",
  sprint: "Sprint",
  category: "Category",
};

/** Board column modes (OpenProject: Basic and Action boards). */
export const WP_BOARD_MODES = ["status", "assignee", "version", "parent"] as const;
export type WorkPackageBoardMode = (typeof WP_BOARD_MODES)[number];

export const WP_BOARD_MODE_LABEL: Record<WorkPackageBoardMode, string> = {
  status: "Kanban (status)",
  assignee: "Assignee",
  version: "Version",
  parent: "Parent — child",
};

/**
 * Default workflow: the statuses reachable from each status. OpenProject
 * configures a from × to matrix per type + role; this is the documented
 * out-of-the-box flow every type starts from, and the per-project settings
 * can tighten or loosen it per type. A type with no configured triples is
 * permissive (any status change allowed) so an untouched install never
 * blocks a legitimate move.
 */
export const WP_DEFAULT_TRANSITIONS: Record<WorkPackageStatus, WorkPackageStatus[]> = {
  new: ["in_specification", "in_progress", "on_hold", "rejected"],
  in_specification: ["specified", "in_progress", "on_hold", "rejected"],
  specified: ["in_progress", "on_hold", "rejected"],
  in_progress: ["developed", "on_hold", "test_failed", "rejected"],
  developed: ["in_testing", "in_progress", "on_hold", "rejected"],
  in_testing: ["tested", "test_failed", "in_progress", "on_hold"],
  tested: ["closed", "in_progress"],
  test_failed: ["in_progress", "on_hold", "rejected"],
  on_hold: ["new", "in_progress", "rejected"],
  closed: ["in_progress"],
  rejected: ["new", "in_progress"],
};

/** One row of a workflow configuration: `from` may reach `to` for `type`. */
export type WorkPackageTransition = { type: WorkPackageType; from: WorkPackageStatus; to: WorkPackageStatus };

/** The default workflow expanded to triples, for every type. */
export function wpDefaultWorkflow(): WorkPackageTransition[] {
  const out: WorkPackageTransition[] = [];
  for (const type of WP_TYPES) {
    for (const from of WP_STATUSES) {
      for (const to of WP_DEFAULT_TRANSITIONS[from]) out.push({ type, from, to });
    }
  }
  return out;
}

/**
 * The statuses a work package of `type` may move to from `from`.
 * `workflow` is the per-project triple list; `null`/empty means unconfigured
 * → permissive. The current status is always included (a no-op save).
 */
export function wpAllowedStatuses(
  workflow: WorkPackageTransition[] | null | undefined,
  type: WorkPackageType | string,
  from: WorkPackageStatus | string,
): WorkPackageStatus[] {
  const current = WP_STATUSES.includes(from as WorkPackageStatus)
    ? (from as WorkPackageStatus)
    : "new";
  if (!workflow || workflow.length === 0) return [...WP_STATUSES];
  const rows = workflow.filter((t) => t.type === type && t.from === current).map((t) => t.to);
  if (rows.length === 0) return [current]; // configured type, nothing reachable
  return [...new Set([current, ...rows])];
}

/** Time-tracking categories (OpenProject: configurable time-entry Activity). */
export const WP_TIME_ACTIVITIES = [
  "development",
  "design",
  "testing",
  "documentation",
  "coordination",
  "other",
] as const;
export type WorkPackageActivity = (typeof WP_TIME_ACTIVITIES)[number];

export const WP_ACTIVITY_LABEL: Record<WorkPackageActivity, string> = {
  development: "Development",
  design: "Design",
  testing: "Testing",
  documentation: "Documentation",
  coordination: "Coordination",
  other: "Other",
};

/** OpenProject version status vocabulary (release goals / Roadmap). */
export const WP_VERSION_STATUSES = ["open", "locked", "closed"] as const;
export type WorkPackageVersionStatus = (typeof WP_VERSION_STATUSES)[number];

export const WP_VERSION_STATUS_LABEL: Record<WorkPackageVersionStatus, string> = {
  open: "Open",
  locked: "Locked",
  closed: "Closed",
};

/** Sprint lifecycle (Backlogs module: sprints are first-class objects). */
export const WP_SPRINT_STATUSES = ["open", "active", "closed"] as const;
export type WorkPackageSprintStatus = (typeof WP_SPRINT_STATUSES)[number];

export const WP_SPRINT_STATUS_LABEL: Record<WorkPackageSprintStatus, string> = {
  open: "Open",
  active: "Active",
  closed: "Closed",
};

/** A status flagged `closed` means the work package is finished. */
export function wpIsClosed(status: WorkPackageStatus | string): boolean {
  return WP_STATUS_META[status as WorkPackageStatus]?.closed === true;
}

/** OpenProject's "% Complete", rendered as a number. */
export function wpProgress(status: WorkPackageStatus | string): number {
  return WP_STATUS_META[status as WorkPackageStatus]?.progress ?? 0;
}

/** The default status a new work package takes (OpenProject: "New"). */
export const WP_DEFAULT_STATUS: WorkPackageStatus = "new";
/** The default type (OpenProject: the type at the top of the admin list). */
export const WP_DEFAULT_TYPE: WorkPackageType = "task";
export const WP_DEFAULT_PRIORITY: WorkPackagePriority = "normal";

// ---------------------------------------------------------------------------
// Dates and working days
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Whole days between the ISO date input value and now; null when unparseable. */
export function dateToMs(value: string): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const t = new Date(y, m - 1, d).getTime();
  return Number.isNaN(t) ? undefined : t;
}

/** `ms` back to the yyyy-mm-dd a date input expects. */
export function msToDate(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Short "12 Mar" style label used across the table, board and timeline. */
export function shortDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Midnight (local) of the day containing `ms`. */
export function wpStartOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Saturday or Sunday — non-working under "working days only". */
export function wpIsWeekend(ms: number): boolean {
  const d = new Date(ms).getDay();
  return d === 0 || d === 6;
}

/** The next day strictly after `ms` that counts as a working day. */
export function wpNextWorkingDay(ms: number): number {
  let t = wpStartOfDay(ms) + DAY_MS;
  while (wpIsWeekend(t)) t += DAY_MS;
  return t;
}

/**
 * The finish date for a span that STARTS on `startMs` and lasts `durationDays`
 * working days (inclusive of the start day, as OpenProject counts duration).
 */
export function wpAddWorkingDays(startMs: number, durationDays: number): number {
  let t = wpStartOfDay(startMs);
  let remaining = Math.max(1, Math.round(durationDays)) - 1;
  while (remaining > 0) {
    t += DAY_MS;
    if (!wpIsWeekend(t)) remaining -= 1;
  }
  return t;
}

/** Working days between start and finish, inclusive (a one-day task is 1). */
export function wpDurationDays(startMs?: number, finishMs?: number): number | undefined {
  if (startMs === undefined || finishMs === undefined) return undefined;
  let a = wpStartOfDay(Math.min(startMs, finishMs));
  const b = wpStartOfDay(Math.max(startMs, finishMs));
  let days = 0;
  while (a <= b) {
    if (!wpIsWeekend(a)) days += 1;
    a += DAY_MS;
  }
  return Math.max(1, days);
}

// ---------------------------------------------------------------------------
// Scheduling (OpenProject 15.4+: manual vs automatic)
// ---------------------------------------------------------------------------

export type WpPredecessorRef = { finishAt?: number; lagDays?: number };

/**
 * Dates for an AUTOMATICALLY scheduled work package with predecessors:
 * it starts on the first working day after the latest predecessor finish
 * (plus lag in working days) and keeps its working-day duration.
 */
export function wpScheduleAfterPredecessors(
  current: { startAt?: number; finishAt?: number },
  predecessors: WpPredecessorRef[],
): { startAt?: number; finishAt?: number } {
  const dated = predecessors.filter((p) => p.finishAt !== undefined);
  if (dated.length === 0) return {};
  const latest = Math.max(...dated.map((p) => p.finishAt as number));
  const maxLag = Math.max(0, ...dated.map((p) => p.lagDays ?? 0));
  // Default gap: one working day after the predecessor; each lag day adds
  // another working day on top (OpenProject's lag in working days).
  let start = wpNextWorkingDay(latest);
  for (let i = 0; i < maxLag; i += 1) start = wpNextWorkingDay(start);
  const duration = wpDurationDays(current.startAt, current.finishAt) ?? 1;
  return { startAt: start, finishAt: wpAddWorkingDays(start, duration) };
}

/** Dates for an AUTOMATICALLY scheduled parent: span of its children. */
export function wpDeriveParentDates(
  children: { startAt?: number; finishAt?: number }[],
): { startAt?: number; finishAt?: number } {
  const starts = children.map((c) => c.startAt).filter((v): v is number => v !== undefined);
  const finishes = children.map((c) => c.finishAt).filter((v): v is number => v !== undefined);
  if (starts.length === 0 && finishes.length === 0) return {};
  const startAt = starts.length > 0 ? Math.min(...starts) : undefined;
  const finishAt = finishes.length > 0 ? Math.max(...finishes) : undefined;
  return { startAt, finishAt };
}

// ---------------------------------------------------------------------------
// Progress derivation (OpenProject progress-tracking modes)
// ---------------------------------------------------------------------------

export type WpProgressValues = {
  doneRatio?: number;
  estimatedHours?: number;
  remainingHours?: number;
};

/**
 * Apply an edit under the instance's progress mode and return the progress
 * fields that should be written (each present key overrides the stored value).
 *
 * Work-based: when Work and Remaining work are both known, % Complete is
 * derived from them; entering % Complete with a Work estimate derives
 * Remaining work. Remaining work can never exceed Work.
 * Status-based: % Complete always mirrors the status; Remaining work is
 * derived from Work and is not independently editable.
 */
export function wpApplyProgress(
  mode: WorkPackageProgressMode,
  statusPct: number,
  stored: WpProgressValues,
  edit: WpProgressValues,
): WpProgressValues {
  const out: WpProgressValues = {};
  if (mode === "status_based") {
    out.doneRatio = statusPct;
    const est = edit.estimatedHours ?? stored.estimatedHours;
    if (est !== undefined) {
      if (edit.estimatedHours !== undefined) out.estimatedHours = edit.estimatedHours;
      out.remainingHours = Math.max(0, Math.round(est * (1 - statusPct / 100) * 100) / 100);
    } else if (edit.remainingHours !== undefined) {
      // Work is optional in status-based mode; without it there is nothing
      // to derive from, so an explicit remaining value is honoured.
      out.remainingHours = edit.remainingHours;
    }
    return out;
  }
  // Work-based.
  if (edit.estimatedHours !== undefined) out.estimatedHours = Math.max(0, edit.estimatedHours);
  if (edit.remainingHours !== undefined) out.remainingHours = Math.max(0, edit.remainingHours);
  if (edit.doneRatio !== undefined) {
    out.doneRatio = Math.max(0, Math.min(100, Math.round(edit.doneRatio)));
  }
  const est = out.estimatedHours ?? stored.estimatedHours;
  const rem = out.remainingHours ?? stored.remainingHours;
  if (est !== undefined && est > 0 && rem !== undefined && out.doneRatio === undefined) {
    // Two of three known → derive % Complete.
    out.doneRatio = Math.max(0, Math.min(100, Math.round(((est - rem) / est) * 100)));
  } else if (est !== undefined && est > 0 && out.doneRatio !== undefined && out.remainingHours === undefined) {
    // % Complete + Work → derive Remaining work.
    out.remainingHours = Math.max(0, Math.round(est * (1 - out.doneRatio / 100) * 100) / 100);
  } else if (out.doneRatio !== undefined && out.doneRatio >= 100) {
    // 100% complete requires zero Remaining work.
    if (stored.remainingHours !== undefined || est !== undefined) out.remainingHours = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Backlogs: burndown (OpenProject: sprint burndown over story points)
// ---------------------------------------------------------------------------

export type WpBurndownPoint = { date: string; remaining: number; ideal: number };

/**
 * Sprint burndown by story points: for every day from the sprint start to its
 * finish, the points still open at the end of that day (a story counts as
 * done on the day it was closed), plus the linear ideal line.
 */
export function wpBurndown(
  items: { storyPoints?: number; closedAt?: number }[],
  sprint: { startAt?: number; finishAt?: number },
): { total: number; days: WpBurndownPoint[] } {
  const total = items.reduce((s, i) => s + (i.storyPoints ?? 0), 0);
  const from = sprint.startAt;
  const to = sprint.finishAt;
  if (from === undefined || to === undefined || to < from) return { total, days: [] };
  const start = wpStartOfDay(from);
  const end = wpStartOfDay(to);
  const spanDays = Math.max(1, Math.round((end - start) / DAY_MS));
  const days: WpBurndownPoint[] = [];
  for (let d = 0; d <= spanDays; d += 1) {
    const t = start + d * DAY_MS;
    const endOfday = t + DAY_MS - 1;
    const remaining = items.reduce(
      (s, i) => s + ((i.closedAt === undefined || i.closedAt > endOfday) ? (i.storyPoints ?? 0) : 0),
      0,
    );
    days.push({
      date: msToDate(t),
      remaining,
      ideal: Math.round(total * (1 - d / spanDays) * 100) / 100,
    });
  }
  return { total, days };
}

// ---------------------------------------------------------------------------
// Baseline comparison (OpenProject: table comparison against a past state)
// ---------------------------------------------------------------------------

/** The fields OpenProject tracks for baseline comparison. */
export type WpBaselineItem = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  assigneeId?: string;
  doneRatio: number;
  storyPoints?: number;
  startAt?: number;
  finishAt?: number;
  updatedAt: number;
};

export type WpBaselineDiff = {
  added: string[];
  removed: WpBaselineItem[];
  /** id → field → the value BEFORE the comparison point. */
  modified: Map<string, Record<string, string>>;
};

const BASELINE_FIELDS = ["subject", "status", "priority", "assigneeId", "doneRatio", "storyPoints", "startAt", "finishAt"] as const;

/** Human-readable rendering of a tracked field for the old-value display. */
export function wpBaselineValueLabel(field: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field === "startAt" || field === "finishAt") {
    return typeof value === "number" ? shortDate(value) : String(value);
  }
  if (field === "status") return WP_STATUS_META[value as WorkPackageStatus]?.label ?? String(value);
  if (field === "priority") return WP_PRIORITY_META[value as WorkPackagePriority]?.label ?? String(value);
  return String(value);
}

/**
 * Diff the current work packages against a snapshot: which were added since,
 * which disappeared (deleted) and which changed, with the OLD value of every
 * tracked field that moved — exactly how OpenProject's baseline comparison
 * annotates the table.
 */
export function wpDiffBaseline(
  current: WpBaselineItem[],
  snapshot: WpBaselineItem[] | null | undefined,
): WpBaselineDiff | null {
  if (!snapshot) return null;
  const snapById = new Map(snapshot.map((s) => [s.id, s]));
  const curById = new Map(current.map((c) => [c.id, c]));
  const added: string[] = [];
  const modified = new Map<string, Record<string, string>>();
  for (const c of current) {
    const s = snapById.get(c.id);
    if (!s) {
      added.push(c.id);
      continue;
    }
    const changes: Record<string, string> = {};
    for (const f of BASELINE_FIELDS) {
      const a = (s as unknown as Record<string, unknown>)[f];
      const b = (c as unknown as Record<string, unknown>)[f];
      if (a !== b) changes[f] = wpBaselineValueLabel(f, a);
    }
    if (Object.keys(changes).length > 0) modified.set(c.id, changes);
  }
  const removed = snapshot.filter((s) => !curById.has(s.id));
  return { added, removed, modified };
}

// ---------------------------------------------------------------------------
// Custom fields (OpenProject: configurable per project, applied per type)
// ---------------------------------------------------------------------------

export const WP_CUSTOM_FIELD_FORMATS = [
  "text",
  "long_text",
  "int",
  "float",
  "bool",
  "date",
  "list",
] as const;
export type WorkPackageCustomFieldFormat = (typeof WP_CUSTOM_FIELD_FORMATS)[number];

export const WP_CUSTOM_FIELD_FORMAT_LABEL: Record<WorkPackageCustomFieldFormat, string> = {
  text: "Text",
  long_text: "Long text",
  int: "Integer",
  float: "Float",
  bool: "Boolean",
  date: "Date",
  list: "List",
};

export type WorkPackageCustomFieldDef = {
  _id: string;
  name: string;
  fieldFormat: WorkPackageCustomFieldFormat;
  possibleValues?: string[];
  types: string[];
};

export type WpCustomFieldValue = string | number | boolean;

/**
 * Parse a raw input string into the storage value for a custom-field format.
 * Returns `{ ok: false, error }` with a human message instead of throwing.
 */
export function wpParseCfInput(
  format: WorkPackageCustomFieldFormat,
  raw: string,
  possibleValues?: string[],
): { ok: true; value?: WpCustomFieldValue } | { ok: false; error: string } {
  const s = raw.trim();
  if (s === "") return { ok: true, value: undefined };
  switch (format) {
    case "text":
    case "long_text":
      return { ok: true, value: s };
    case "int": {
      const n = Number(s);
      if (!Number.isInteger(n)) return { ok: false, error: "Must be a whole number" };
      return { ok: true, value: n };
    }
    case "float": {
      const n = Number(s);
      if (!Number.isFinite(n)) return { ok: false, error: "Must be a number" };
      return { ok: true, value: n };
    }
    case "bool": {
      const low = s.toLowerCase();
      if (["true", "yes", "1", "on"].includes(low)) return { ok: true, value: true };
      if (["false", "no", "0", "off"].includes(low)) return { ok: true, value: false };
      return { ok: false, error: "Must be yes or no" };
    }
    case "date": {
      const ms = dateToMs(s);
      if (ms === undefined) return { ok: false, error: "Must be a date (yyyy-mm-dd)" };
      return { ok: true, value: s };
    }
    case "list": {
      if (!possibleValues || possibleValues.length === 0) {
        return { ok: false, error: "This list has no options yet" };
      }
      if (!possibleValues.includes(s)) return { ok: false, error: "Pick one of the list options" };
      return { ok: true, value: s };
    }
    default:
      return { ok: true, value: s };
  }
}

/** Render a stored custom-field value for a cell or the detail panel. */
export function wpFormatCfValue(def: WorkPackageCustomFieldDef, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (def.fieldFormat === "bool") return value === true ? "Yes" : "No";
  if (def.fieldFormat === "date" && typeof value === "string") {
    const ms = dateToMs(value);
    return ms === undefined ? value : shortDate(ms);
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// @mentions (OpenProject notifies mentioned users)
// ---------------------------------------------------------------------------

/** The @usernames mentioned in a comment body (lowercased, deduped). */
export function wpMentions(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(^|[^\w@])@([a-zA-Z0-9_]{2,})/g)) {
    out.add(m[2].toLowerCase());
  }
  return [...out];
}
