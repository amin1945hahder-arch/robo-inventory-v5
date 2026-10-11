/**
 * Shared metadata for the Work Packages module — the club's OpenProject-style
 * tracking layer that sits inside every project.
 *
 * OpenProject deliberately keeps types, statuses, priorities and the workflow
 * *configurable per instance* (a status only becomes selectable once it is
 * part of the workflow for a work-package type + role). So rather than hard
 * coding the vocabulary into components, the documented out-of-the-box set
 * lives here as data and every screen reads from it.
 *
 * Field naming follows OpenProject so the two read the same way:
 *   subject · type · status · priority · assignee · accountable
 *   start date · finish date · Work · Remaining work · % Complete
 *   story points · version (release goal) · category · parent
 */

export const WP_TYPES = [
  "task",
  "bug",
  "feature",
  "epic",
  "user_story",
  "milestone",
] as const;
export type WorkPackageType = (typeof WP_TYPES)[number];

export const WP_TYPE_META: Record<
  WorkPackageType,
  { label: string; icon: string; color: string; badge: string }
> = {
  task: {
    label: "Task",
    icon: "☑",
    color: "text-sky-400",
    badge: "border-sky-500/30 bg-sky-500/15 text-sky-400",
  },
  bug: {
    label: "Bug",
    icon: "🐞",
    color: "text-red-400",
    badge: "border-red-500/30 bg-red-500/15 text-red-400",
  },
  feature: {
    label: "Feature",
    icon: "✨",
    color: "text-violet-400",
    badge: "border-violet-500/30 bg-violet-500/15 text-violet-400",
  },
  epic: {
    label: "Epic",
    icon: "🏔",
    color: "text-fuchsia-400",
    badge: "border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-400",
  },
  user_story: {
    label: "User story",
    icon: "📖",
    color: "text-teal-400",
    badge: "border-teal-500/30 bg-teal-500/15 text-teal-400",
  },
  milestone: {
    label: "Milestone",
    icon: "🚩",
    color: "text-amber-400",
    badge: "border-amber-500/30 bg-amber-500/15 text-amber-400",
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
 * label, so every type carries both directions (`inverse`).
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
  { label: string; inverse: string; hint: string; scheduled?: boolean }
> = {
  relates: { label: "Relates to", inverse: "Relates to", hint: "Loose connection — no scheduling effect." },
  duplicates: { label: "Duplicates", inverse: "Duplicated by", hint: "The same work, recorded twice." },
  blocks: { label: "Blocks", inverse: "Blocked by", hint: "Cannot be finished until the other is done." },
  precedes: { label: "Precedes", inverse: "Follows", hint: "Predecessor — drives scheduling.", scheduled: true },
  requires: { label: "Requires", inverse: "Required by", hint: "Needs the other's output as input." },
  includes: { label: "Includes", inverse: "Part of", hint: "Container — the other is a part of this." },
};

export const WP_VIEWS = ["table", "board", "timeline"] as const;
export type WorkPackageView = (typeof WP_VIEWS)[number];

export const WP_VIEW_META: Record<WorkPackageView, { label: string; icon: string }> = {
  table: { label: "Table", icon: "▦" },
  board: { label: "Board", icon: "▤" },
  timeline: { label: "Timeline", icon: "▬" },
};

/** What the table can group by (OpenProject: "Group by"). */
export const WP_GROUP_BY = [
  "none",
  "status",
  "type",
  "priority",
  "assignee",
  "version",
] as const;
export type WorkPackageGroupBy = (typeof WP_GROUP_BY)[number];

export const WP_GROUP_LABEL: Record<WorkPackageGroupBy, string> = {
  none: "Flat list",
  status: "Status",
  type: "Type",
  priority: "Priority",
  assignee: "Assignee",
  version: "Version",
};

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
