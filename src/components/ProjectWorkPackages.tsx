import { useMemo, useState, type ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { LoadingGif } from "@/components/LoadingGif";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WP_ACTIVITY_LABEL,
  WP_BOARD_MODES,
  WP_BOARD_MODE_LABEL,
  WP_CUSTOM_FIELD_FORMAT_LABEL,
  WP_CUSTOM_FIELD_FORMATS,
  WP_DEFAULT_PRIORITY,
  WP_DEFAULT_TYPE,
  WP_GROUP_BY,
  WP_GROUP_LABEL,
  WP_PRIORITIES,
  WP_PROGRESS_MODES,
  WP_PROGRESS_MODE_HINT,
  WP_PROGRESS_MODE_LABEL,
  WP_SCHEDULING_LABEL,
  WP_SCHEDULING_MODES,
  WP_SPRINT_STATUS_LABEL,
  WP_TIME_ACTIVITIES,
  WP_PRIORITY_META,
  WP_RELATION_META,
  WP_RELATION_TYPES,
  WP_STATUSES,
  WP_STATUS_META,
  WP_TYPES,
  WP_TYPE_META,
  WP_VERSION_STATUS_LABEL,
  WP_VIEWS,
  WP_VIEW_META,
  dateToMs,
  msToDate,
  shortDate,
  wpBurndown,
  wpDefaultWorkflow,
  wpDiffBaseline,
  wpDurationDays,
  wpFormatCfValue,
  wpIsClosed,
  wpParseCfInput,
  type WpBaselineItem,
  type WorkPackageActivity,
  type WorkPackageBoardMode,
  type WorkPackageCustomFieldFormat,
  type WorkPackageGroupBy,
  type WorkPackagePriority,
  type WorkPackageProgressMode,
  type WorkPackageRelationType,
  type WorkPackageSchedulingMode,
  type WorkPackageSprintStatus,
  type WorkPackageStatus,
  type WorkPackageTransition,
  type WorkPackageType,
  type WorkPackageVersionStatus,
  type WorkPackageView,
} from "@/lib/work-packages";
import {
  ArrowUpDown,
  Ban,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Filter,
  Flag,
  GitBranch,
  Layers,
  Link2,
  MessageSquare,
  Play,
  Plus,
  Search,
  Settings2,
  Sigma,
  Tag,
  Trash2,
  TrendingDown,
  X,
} from "lucide-react";

/**
 * Work packages — the OpenProject-style board inside a project.
 *
 * Views: TABLE (with hierarchy, grouping and bulk edit), BOARD (Kanban whose
 * columns are statuses; dragging a card changes the status) and TIMELINE
 * (start → finish bars). The detail panel is the split screen: an Overview
 * form, the Activity journal (comments AND change sets), Relations, Watchers
 * and logged Time.
 *
 * The vocabulary (types, statuses, priorities, relations, views) is data from
 * @/lib/work-packages so it can be reconfigured without touching this file.
 */

type MemberOption = {
  userId: string;
  user: { name?: string; email?: string; image?: string };
};

type ListResult = FunctionReturnType<typeof api.workPackages.list>;
type WpItem = ListResult["items"][number];
type ListSprint = ListResult["sprints"][number];
type DetailResult = NonNullable<FunctionReturnType<typeof api.workPackages.detail>>;

/** Columns the table can sort by (OpenProject sorts on any column header). */
type SortKey =
  | "position"
  | "subject"
  | "status"
  | "priority"
  | "assignee"
  | "start"
  | "finish"
  | "progress"
  | "storyPoints";

/** Optional table columns the user can switch on (OpenProject's columns). */
const EXTRA_COLS = [
  { key: "sprint", label: "Sprint" },
  { key: "version", label: "Version" },
  { key: "points", label: "Story points" },
  { key: "spent", label: "Spent (h)" },
  { key: "duration", label: "Duration (d)" },
  { key: "category", label: "Category" },
] as const;

const SORT_LABEL: Record<SortKey, string> = {
  position: "Manual order",
  subject: "Subject",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  start: "Start date",
  finish: "Finish date",
  progress: "% Complete",
  storyPoints: "Story points",
};

/** A stable, short human reference for a work package (OpenProject shows IDs). */
function refOf(id: string): string {
  return id.slice(-4).toUpperCase();
}

function initials(name?: string): string {
  return (name ?? "?").slice(0, 1).toUpperCase();
}

function memberName(m: MemberOption): string {
  return m.user.name ?? m.user.email ?? "Member";
}

/** Type chip — the icon + label every view renders. */
function TypeBadge({ type }: { type: string }) {
  const meta = WP_TYPE_META[type as WorkPackageType] ?? WP_TYPE_META.task;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${meta.badge}`}
    >
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

/** Status chip. `closed` statuses read as finished whatever the wording. */
function StatusBadge({ status }: { status: string }) {
  const meta = WP_STATUS_META[status as WorkPackageStatus] ?? WP_STATUS_META.new;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const meta = WP_PRIORITY_META[priority as WorkPackagePriority] ?? WP_PRIORITY_META.normal;
  return (
    <span className={`inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${meta.badge}`}>
      {meta.label}
    </span>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

/** Small "start → finish" chip used in the table and the board cards. */
function DatesChip({ startAt, finishAt }: { startAt?: number; finishAt?: number }) {
  if (!startAt && !finishAt) return <span className="text-[11px] text-muted-foreground">—</span>;
  const overdue = finishAt !== undefined && finishAt < Date.now();
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
      <CalendarDays className="size-3" />
      {startAt ? shortDate(startAt) : "…"} → {finishAt ? shortDate(finishAt) : "…"}
    </span>
  );
}

// ===========================================================================
// New / edit dialog
// ===========================================================================

type Draft = {
  type: WorkPackageType;
  subject: string;
  description: string;
  status: WorkPackageStatus;
  priority: WorkPackagePriority;
  assigneeId: string;
  accountableId: string;
  startAt: string;
  finishAt: string;
  estimatedHours: string;
  storyPoints: string;
  versionId: string;
  sprintId: string;
  parentId: string;
  category: string;
  scheduling: WorkPackageSchedulingMode;
  /** Raw custom-field input, keyed by field id (parsed on submit). */
  customFields: Record<string, string>;
};

const emptyDraft = (scheduling: WorkPackageSchedulingMode = "manual"): Draft => ({
  type: WP_DEFAULT_TYPE,
  subject: "",
  description: "",
  status: "new",
  priority: WP_DEFAULT_PRIORITY,
  assigneeId: "",
  accountableId: "",
  startAt: "",
  finishAt: "",
  estimatedHours: "",
  storyPoints: "",
  versionId: "",
  sprintId: "",
  parentId: "",
  category: "",
  scheduling,
  customFields: {},
});

/** One custom-field input, rendered from the field's format. */
function CustomFieldInput({
  def,
  value,
  onChange,
}: {
  def: { _id: string; name: string; fieldFormat: string; possibleValues?: string[] };
  value: string;
  onChange: (v: string) => void;
}) {
  const format = def.fieldFormat as WorkPackageCustomFieldFormat;
  if (format === "bool") {
    return (
      <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
        <SelectTrigger>
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Not set</SelectItem>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  if (format === "list") {
    return (
      <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
        <SelectTrigger>
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Not set</SelectItem>
          {(def.possibleValues ?? []).map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (format === "date") {
    return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (format === "int" || format === "float") {
    return (
      <Input
        type="number"
        step={format === "float" ? 0.1 : 1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (format === "long_text") {
    return <Textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** Parse a draft's raw custom-field text into the record the mutation wants. */
function buildCustomFields(
  draft: Draft,
  defs: { _id: string; name: string; fieldFormat: string; possibleValues?: string[]; types: string[] }[],
): { ok: true; value?: Record<string, string | number | boolean> } | { ok: false; error: string } {
  const out: Record<string, string | number | boolean> = {};
  for (const def of defs) {
    if (def.types.length > 0 && !def.types.includes(draft.type)) continue;
    const raw = draft.customFields[def._id] ?? "";
    if (raw.trim() === "") continue;
    const parsed = wpParseCfInput(
      def.fieldFormat as WorkPackageCustomFieldFormat,
      raw,
      def.possibleValues,
    );
    if (!parsed.ok) return { ok: false, error: `${def.name}: ${parsed.error}` };
    if (parsed.value !== undefined) out[def._id] = parsed.value;
  }
  return { ok: true, value: Object.keys(out).length > 0 ? out : undefined };
}

function NewWorkPackageDialog({
  open,
  onOpenChange,
  projectId,
  members,
  versions,
  sprints,
  customFields,
  items,
  defaultScheduling,
  parentOf,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  members: MemberOption[];
  versions: ListResult["versions"];
  sprints: ListResult["sprints"];
  customFields: ListResult["customFields"];
  items: WpItem[];
  defaultScheduling: WorkPackageSchedulingMode;
  parentOf?: WpItem;
}) {
  const create = useMutation(api.workPackages.create);
  // The dialog only mounts once the module has the project settings, so the
  // scheduling default is already known here — no effect needed.
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultScheduling));
  const [busy, setBusy] = useState(false);

  const reset = () => setDraft(emptyDraft(defaultScheduling));
  const cfForType = customFields.filter(
    (def) => def.types.length === 0 || def.types.includes(draft.type),
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    setBusy(true);
    try {
      const cf = buildCustomFields(draft, customFields);
      if (!cf.ok) throw new Error(cf.error);
      await create({
        projectId: projectId as never,
        type: draft.type,
        subject: draft.subject,
        description: draft.description.trim() || undefined,
        status: draft.status,
        priority: draft.priority,
        assigneeId: draft.assigneeId ? (draft.assigneeId as never) : undefined,
        accountableId: draft.accountableId ? (draft.accountableId as never) : undefined,
        startAt: dateToMs(draft.startAt),
        finishAt: dateToMs(draft.finishAt),
        estimatedHours: draft.estimatedHours ? Number(draft.estimatedHours) : undefined,
        storyPoints: draft.storyPoints ? Number(draft.storyPoints) : undefined,
        versionId: draft.versionId ? (draft.versionId as never) : undefined,
        sprintId: draft.sprintId ? (draft.sprintId as never) : undefined,
        parentId: draft.parentId ? (draft.parentId as never) : undefined,
        category: draft.category.trim() || undefined,
        scheduling: draft.scheduling,
        customFields: cf.value,
      });
      toast.success("Work package created");
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4" /> New work package
            {parentOf && (
              <span className="text-xs font-normal text-muted-foreground">
                under “{parentOf.subject}”
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={draft.type} onValueChange={(v) => set("type", v as WorkPackageType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WP_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {WP_TYPE_META[t].icon} {WP_TYPE_META[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Subject</Label>
              <Input
                value={draft.subject}
                onChange={(e) => set("subject", e.target.value)}
                placeholder="Wire the motor driver to the ESP32"
                autoFocus
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              placeholder="What has to be true when this is done?"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={draft.status} onValueChange={(v) => set("status", v as WorkPackageStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WP_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {WP_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Priority</Label>
              <Select
                value={draft.priority}
                onValueChange={(v) => set("priority", v as WorkPackagePriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WP_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {WP_PRIORITY_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Version</Label>
              <Select
                value={draft.versionId || "none"}
                onValueChange={(v) => set("versionId", v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No version" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No version</SelectItem>
                  {versions.map((v) => (
                    <SelectItem key={v._id} value={v._id}>
                      🚩 {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Assignee</Label>
              <Select
                value={draft.assigneeId || "none"}
                onValueChange={(v) => set("assigneeId", v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {memberName(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Accountable</Label>
              <Select
                value={draft.accountableId || "none"}
                onValueChange={(v) => set("accountableId", v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nobody" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nobody</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {memberName(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="grid gap-2">
              <Label>Start date</Label>
              <Input type="date" value={draft.startAt} onChange={(e) => set("startAt", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Finish date</Label>
              <Input type="date" value={draft.finishAt} onChange={(e) => set("finishAt", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Estimate (h)</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={draft.estimatedHours}
                onChange={(e) => set("estimatedHours", e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Story points</Label>
              <Input
                type="number"
                min={0}
                value={draft.storyPoints}
                onChange={(e) => set("storyPoints", e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Parent</Label>
              <Select
                value={draft.parentId || (parentOf ? parentOf._id : "none")}
                onValueChange={(v) => set("parentId", v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Top level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Top level</SelectItem>
                  {items
                    .filter((i) => i.type !== "milestone")
                    .map((i) => (
                      <SelectItem key={i._id} value={i._id}>
                        #{refOf(i._id)} {i.subject}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Input
                value={draft.category}
                onChange={(e) => set("category", e.target.value)}
                placeholder="Chassis, firmware…"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Sprint</Label>
              <Select
                value={draft.sprintId || "none"}
                onValueChange={(v) => set("sprintId", v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Backlog" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Backlog (no sprint)</SelectItem>
                  {sprints.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Scheduling</Label>
              <Select
                value={draft.scheduling}
                onValueChange={(v) => set("scheduling", v as WorkPackageSchedulingMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WP_SCHEDULING_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {WP_SCHEDULING_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {cfForType.length > 0 && (
            <div className="grid gap-3 rounded-lg border p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Custom fields
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {cfForType.map((def) => (
                  <div key={def._id} className="grid gap-2">
                    <Label>{def.name}</Label>
                    <CustomFieldInput
                      def={def}
                      value={draft.customFields[def._id] ?? ""}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          customFields: { ...d.customFields, [def._id]: v },
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || draft.subject.trim().length < 2}>
            {busy ? "Creating…" : "Create work package"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Versions (release goals / Roadmap)
// ===========================================================================

function VersionsDialog({
  open,
  onOpenChange,
  projectId,
  versions,
  canManage,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  versions: ListResult["versions"];
  canManage: boolean;
}) {
  const upsert = useMutation(api.workPackages.upsertVersion);
  const removeVersion = useMutation(api.workPackages.deleteVersion);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="size-4" /> Versions — release goals
          </DialogTitle>
        </DialogHeader>

        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No versions yet. A version groups work packages into a release goal; it shows on the
            timeline and can be filtered.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {versions.map((v) => (
              <li key={v._id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">🚩 {v.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {WP_VERSION_STATUS_LABEL[v.status as WorkPackageVersionStatus]}
                    {v.effectiveAt ? ` · target ${shortDate(v.effectiveAt)}` : ""}
                  </p>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    onClick={async () => {
                      try {
                        await removeVersion({ id: v._id as never });
                        toast.success("Version removed");
                      } catch (e) {
                        toast.error(asMessage(e));
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <>
            <div className="grid gap-2">
              <Label>New version</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Regional finals — build freeze" />
            </div>
            <div className="grid gap-2">
              <Label>Target date</Label>
              <Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                disabled={busy || name.trim().length < 2}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await upsert({
                      projectId: projectId as never,
                      name,
                      status: "open",
                      effectiveAt: dateToMs(target),
                    });
                    toast.success("Version added");
                    setName("");
                    setTarget("");
                  } catch (e) {
                    toast.error(asMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Add version
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Detail panel — Overview / Activity / Relations / Watchers / Time
// ===========================================================================

function DetailPanel({
  id,
  onClose,
  members,
  versions,
  sprints,
}: {
  id: string | null;
  onClose: () => void;
  members: MemberOption[];
  versions: ListResult["versions"];
  sprints: ListSprint[];
}) {
  const open = id !== null;
  const data = useQuery(api.workPackages.detail, id ? { id: id as never } : "skip") as
    | DetailResult
    | null
    | undefined;

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-6 sm:max-w-2xl">
        {data === undefined ? (
          <LoadingGif size={40} label={null} />
        ) : data === null ? (
          <p className="mt-8 text-sm text-muted-foreground">Work package not found.</p>
        ) : (
          <DetailBody
            data={data}
            onClose={onClose}
            members={members}
            versions={versions}
            sprints={sprints}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  data,
  onClose,
  members,
  versions,
  sprints,
}: {
  data: DetailResult;
  onClose: () => void;
  members: MemberOption[];
  versions: ListResult["versions"];
  sprints: ListSprint[];
}) {
  const { wp, me } = data;
  const update = useMutation(api.workPackages.update);
  const duplicate = useMutation(api.workPackages.duplicate);
  const remove = useMutation(api.workPackages.remove);
  const addComment = useMutation(api.workPackages.addComment);
  const addWatcher = useMutation(api.workPackages.addWatcher);
  const removeWatcher = useMutation(api.workPackages.removeWatcher);
  const addRelation = useMutation(api.workPackages.addRelation);
  const removeRelation = useMutation(api.workPackages.removeRelation);
  const logTime = useMutation(api.workPackages.logTime);
  const deleteTime = useMutation(api.workPackages.deleteTimeEntry);

  const [desc, setDesc] = useState(wp.description ?? "");
  const [comment, setComment] = useState("");
  const [relType, setRelType] = useState<WorkPackageRelationType>("relates");
  const [relTarget, setRelTarget] = useState("");
  const [hours, setHours] = useState("");
  const [activity, setActivity] = useState<WorkPackageActivity>("development");
  const [spentOn, setSpentOn] = useState(msToDate(Date.now()));
  const [timeComment, setTimeComment] = useState("");
  const [busy, setBusy] = useState(false);

  const canEdit = me.canManage || wp.authorId === me.userId || wp.assigneeId === me.userId;
  /** Run a mutation with one consistent toast on failure. */
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const patch = (fields: Parameters<typeof update>[0]) =>
    run(() => update(fields));

  const spentTotal = data.time.reduce((s, t) => s + t.hours, 0);

  return (
    <>
      <SheetHeader className="gap-3 p-0">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={wp.type} />
          <span className="font-mono text-xs text-muted-foreground">#{refOf(wp._id)}</span>
          <StatusBadge status={wp.status} />
          <PriorityBadge priority={wp.priority} />
          {data.me.watching ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => run(() => removeWatcher({ id: wp._id as never }), "No longer watching")}
            >
              <Eye className="size-3.5" /> Watching
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => run(() => addWatcher({ id: wp._id as never }), "Watching this now")}
            >
              <EyeOff className="size-3.5" /> Watch
            </Button>
          )}
        </div>
        <SheetTitle className="pr-8 text-left text-lg">{wp.subject}</SheetTitle>
        {data.blockers.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs">
            <Ban className="mt-0.5 size-3.5 shrink-0 text-red-400" />
            <span>
              Blocked by{" "}
              {data.blockers.map((b) => b.subject).join(", ")} — this work package cannot be closed
              until {(data.blockers.length === 1 ? "it is" : "they are")} closed.
            </span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => run(() => duplicate({ id: wp._id as never, includeChildren: true }), "Copied, with its sub-items")}
          >
            <Copy className="size-3.5" /> Duplicate
          </Button>
        </div>
      </SheetHeader>

      <Tabs defaultValue="overview" className="mt-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">
            Activity
            {data.journal.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">{data.journal.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="relations">
            Relations
            {data.relations.length > 0 && (
              <span className="ml-1 text-[10px] text-muted-foreground">{data.relations.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="watchers">Watchers</TabsTrigger>
          <TabsTrigger value="time">Time</TabsTrigger>
        </TabsList>

        {/* ===== Overview ===== */}
        <TabsContent value="overview" className="mt-4 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <FieldLabel>Status</FieldLabel>
              <Select
                value={wp.status}
                disabled={!canEdit}
                onValueChange={(v) => patch({ id: wp._id as never, status: v as WorkPackageStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Only the statuses the project's workflow allows are offered. */}
                  {data.allowedStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {WP_STATUS_META[s as WorkPackageStatus].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {data.allowedStatuses.length < WP_STATUSES.length && (
                <p className="text-[10px] text-muted-foreground">
                  The project workflow limits the moves from this status.
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Priority</FieldLabel>
              <Select
                value={wp.priority}
                disabled={!canEdit}
                onValueChange={(v) => patch({ id: wp._id as never, priority: v as WorkPackagePriority })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WP_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {WP_PRIORITY_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Type</FieldLabel>
              <Select
                value={wp.type}
                disabled={!me.canManage}
                onValueChange={(v) => patch({ id: wp._id as never, type: v as WorkPackageType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WP_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {WP_TYPE_META[t].icon} {WP_TYPE_META[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Version</FieldLabel>
              <Select
                value={wp.versionId ?? "none"}
                disabled={!me.canManage}
                onValueChange={(v) =>
                  patch({
                    id: wp._id as never,
                    ...(v === "none"
                      ? { unset: ["versionId"] }
                      : { versionId: v as never }),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No version" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No version</SelectItem>
                  {versions.map((v) => (
                    <SelectItem key={v._id} value={v._id}>
                      🚩 {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <FieldLabel>Sprint</FieldLabel>
              <Select
                value={wp.sprintId ?? "none"}
                disabled={!canEdit}
                onValueChange={(v) =>
                  patch({
                    id: wp._id as never,
                    ...(v === "none" ? { unset: ["sprintId"] } : { sprintId: v as never }),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Backlog" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Backlog (no sprint)</SelectItem>
                  {sprints.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <FieldLabel>Scheduling</FieldLabel>
              <Select
                value={(wp.scheduling ?? data.settings.scheduling) as string}
                disabled={!canEdit}
                onValueChange={(v) =>
                  patch({ id: wp._id as never, scheduling: v as WorkPackageSchedulingMode })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WP_SCHEDULING_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {WP_SCHEDULING_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {wp.durationDays !== undefined && (
                <p className="text-[10px] text-muted-foreground">
                  {wp.durationDays} working day{wp.durationDays === 1 ? "" : "s"}
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Assignee</FieldLabel>
              <Select
                value={wp.assigneeId ?? "none"}
                disabled={!me.canManage}
                onValueChange={(v) =>
                  patch({
                    id: wp._id as never,
                    ...(v === "none" ? { unset: ["assigneeId"] } : { assigneeId: v as never }),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {memberName(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Accountable</FieldLabel>
              <Select
                value={wp.accountableId ?? "none"}
                disabled={!me.canManage}
                onValueChange={(v) =>
                  patch({
                    id: wp._id as never,
                    ...(v === "none"
                      ? { unset: ["accountableId"] }
                      : { accountableId: v as never }),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nobody" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nobody</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {memberName(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <FieldLabel>Start date</FieldLabel>
              <Input
                type="date"
                disabled={!canEdit}
                value={msToDate(wp.startAt)}
                onChange={(e) => {
                  const ms = dateToMs(e.target.value);
                  patch({
                    id: wp._id as never,
                    ...(ms === undefined ? { unset: ["startAt"] } : { startAt: ms }),
                  });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Finish date</FieldLabel>
              <Input
                type="date"
                disabled={!canEdit}
                value={msToDate(wp.finishAt)}
                onChange={(e) => {
                  const ms = dateToMs(e.target.value);
                  patch({
                    id: wp._id as never,
                    ...(ms === undefined ? { unset: ["finishAt"] } : { finishAt: ms }),
                  });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Estimate (hours)</FieldLabel>
              <Input
                type="number"
                min={0}
                step={0.5}
                disabled={!canEdit}
                value={wp.estimatedHours ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  patch({
                    id: wp._id as never,
                    ...(n === undefined
                      ? { unset: ["estimatedHours", "remainingHours"] }
                      : { estimatedHours: n }),
                  });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Story points</FieldLabel>
              <Input
                type="number"
                min={0}
                disabled={!canEdit}
                value={wp.storyPoints ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  patch({
                    id: wp._id as never,
                    ...(n === undefined ? { unset: ["storyPoints"] } : { storyPoints: n }),
                  });
                }}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <FieldLabel>Remaining work (h)</FieldLabel>
              <Input
                type="number"
                min={0}
                step={0.5}
                disabled={!canEdit || data.settings.progressMode === "status_based"}
                value={wp.remainingHours ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value);
                  patch({
                    id: wp._id as never,
                    ...(n === undefined ? { unset: ["remainingHours"] } : { remainingHours: n }),
                  });
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                {data.settings.progressMode === "status_based"
                  ? "Derived from the status and the estimate."
                  : "Work − Remaining drives the % Complete."}
              </p>
            </div>
          </div>

          <div className="grid gap-1.5">
            <FieldLabel>
              % Complete · {WP_PROGRESS_MODE_LABEL[data.settings.progressMode as WorkPackageProgressMode]}
            </FieldLabel>
            <div className="flex items-center gap-3">
              <Progress value={wp.doneRatio} className="h-2 flex-1" />
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {wp.doneRatio}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              disabled={!canEdit || data.settings.progressMode === "status_based"}
              value={wp.doneRatio}
              onChange={(e) => patch({ id: wp._id as never, doneRatio: Number(e.target.value) })}
              className="w-full accent-primary"
            />
            <p className="text-[10px] text-muted-foreground">
              {WP_PROGRESS_MODE_HINT[data.settings.progressMode as WorkPackageProgressMode]}
            </p>
          </div>

          {data.customFields.length > 0 && (
            <div className="grid gap-3">
              <FieldLabel>Custom fields</FieldLabel>
              <div className="grid gap-3 sm:grid-cols-2">
                {data.customFields.map((def) => (
                  <div key={def._id} className="grid gap-1.5">
                    <span className="text-[11px] text-muted-foreground">
                      {def.name}{" "}
                      <span className="text-[10px]">
                        ({WP_CUSTOM_FIELD_FORMAT_LABEL[def.fieldFormat as WorkPackageCustomFieldFormat]})
                      </span>
                    </span>
                    {canEdit ? (
                      <CustomFieldInput
                        def={def}
                        value={
                          def.value === undefined || def.value === null ? "" : String(def.value)
                        }
                        onChange={(v) => {
                          const parsed = wpParseCfInput(
                            def.fieldFormat as WorkPackageCustomFieldFormat,
                            v,
                            def.possibleValues,
                          );
                          if (!parsed.ok) {
                            toast.error(`${def.name}: ${parsed.error}`);
                            return;
                          }
                          patch({
                            id: wp._id as never,
                            customFields: { [def._id]: parsed.value ?? "" },
                          } as never);
                        }}
                      />
                    ) : (
                      <span className="text-sm">
                        {wpFormatCfValue(
                          {
                            _id: def._id,
                            name: def.name,
                            fieldFormat: def.fieldFormat as WorkPackageCustomFieldFormat,
                            types: def.types,
                          },
                          def.value,
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <FieldLabel>Description</FieldLabel>
            <Textarea
              rows={4}
              disabled={!canEdit}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            {desc !== (wp.description ?? "") && (
              <Button
                size="sm"
                className="self-start"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      update({
                        id: wp._id as never,
                        ...(desc.trim() === ""
                          ? { unset: ["description"] }
                          : { description: desc }),
                      }),
                    "Description saved",
                  )
                }
              >
                Save description
              </Button>
            )}
          </div>

          <div className="grid gap-1.5">
            <FieldLabel>Children</FieldLabel>
            {data.children.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sub-items.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {data.children.map((c) => (
                  <li key={c._id} className="flex items-center gap-2 px-3 py-2">
                    <TypeBadge type={c.type} />
                    <span className="min-w-0 flex-1 truncate text-sm">{c.subject}</span>
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
              <p className="text-[11px] text-muted-foreground">
                Author {wp.authorName ?? "—"} · created {shortDate(wp.createdAt)}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive"
                  disabled={busy}
                  onClick={async () => {
                    await run(() => remove({ id: wp._id as never }), "Work package deleted");
                    onClose();
                  }}
                >
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ===== Activity ===== */}
        <TabsContent value="activity" className="mt-4 grid gap-4">
          <div className="grid gap-2">
            <Textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Write a comment…  Mention progress, blockers, decisions."
            />
            <Button
              size="sm"
              className="self-start"
              disabled={busy || comment.trim().length === 0}
              onClick={async () => {
                await run(() => addComment({ id: wp._id as never, body: comment }), "Comment posted");
                setComment("");
              }}
            >
              <MessageSquare className="size-3.5" /> Comment
            </Button>
          </div>

          {data.journal.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>
          ) : (
            <ul className="grid gap-3">
              {data.journal.map((j) => (
                <li key={j._id} className="flex gap-3">
                  <Avatar className="size-7 shrink-0">
                    <AvatarImage src={j.authorImage} />
                    <AvatarFallback className="text-[11px]">{initials(j.authorName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 rounded-lg border bg-muted/20 px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{j.authorName ?? "Member"}</span>{" "}
                      · {new Date(j.createdAt).toLocaleString("en-GB")}
                    </p>
                    {j.kind === "comment" ? (
                      <p className="mt-1 whitespace-pre-line text-sm">{j.body}</p>
                    ) : (
                      <ul className="mt-1 grid gap-0.5">
                        {(j.changes ?? []).map((c, i) => (
                          <li key={i} className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{c.field}</span>{" "}
                            {c.from ? <span className="line-through">{c.from}</span> : null}
                            {c.from && c.to ? " → " : null}
                            {c.to ? <span className="text-foreground">{c.to}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ===== Relations ===== */}
        <TabsContent value="relations" className="mt-4 grid gap-4">
          {data.relations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No relations. Predecessors drive scheduling on the timeline.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.relations.map((r) => {
                const meta =
                  WP_RELATION_META[r.type as WorkPackageRelationType] ?? WP_RELATION_META.relates;
                return (
                  <li key={r._id} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-28 shrink-0 text-xs text-muted-foreground">
                      {r.inverse ? meta.inverse : meta.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{r.other?.subject}</span>
                    {r.other && <StatusBadge status={r.other.status} />}
                    {me.canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={busy}
                        onClick={() => run(() => removeRelation({ relationId: r._id as never }))}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {me.canManage && (
            <div className="grid gap-2 rounded-lg border p-3">
              <FieldLabel>Add relation</FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={relType}
                  onValueChange={(v) => setRelType(v as WorkPackageRelationType)}
                >
                  <SelectTrigger className="sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WP_RELATION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {WP_RELATION_META[t].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={relTarget} onValueChange={setRelTarget}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Pick a work package…" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.candidates.map((c) => (
                      <SelectItem key={c._id} value={c._id}>
                        #{refOf(c._id)} {c.subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={busy || !relTarget}
                  onClick={async () => {
                    await run(
                      () =>
                        addRelation({
                          fromId: wp._id as never,
                          toId: relTarget as never,
                          type: relType,
                        }),
                      "Relation added",
                    );
                    setRelTarget("");
                  }}
                >
                  <Link2 className="size-3.5" /> Add
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {WP_RELATION_META[relType].hint}
              </p>
            </div>
          )}
        </TabsContent>

        {/* ===== Watchers ===== */}
        <TabsContent value="watchers" className="mt-4 grid gap-3">
          {data.watchers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No watchers.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.watchers.map((w) => (
                <li key={w._id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar className="size-7">
                    <AvatarImage src={w.image} />
                    <AvatarFallback className="text-[11px]">{initials(w.name)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {w.name ?? "Member"}
                    {w.userId === me.userId && (
                      <span className="text-xs text-muted-foreground"> (you)</span>
                    )}
                  </span>
                  {me.canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={busy}
                      onClick={() => run(() => removeWatcher({ id: wp._id as never, userId: w.userId as never }))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => run(() => addWatcher({ id: wp._id as never }), "Watching this now")}
            >
              <Eye className="size-3.5" /> Watch this
            </Button>
            {me.canManage && (
              <Select
                value=""
                onValueChange={(v) =>
                  run(() => addWatcher({ id: wp._id as never, userId: v as never }), "Watcher added")
                }
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Add a team member…" />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((m) => !data.watchers.some((w) => w.userId === m.userId))
                    .map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {memberName(m)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </TabsContent>

        {/* ===== Time ===== */}
        <TabsContent value="time" className="mt-4 grid gap-4">
          <div className="flex flex-wrap items-center gap-4 rounded-lg border px-4 py-3">
            <div>
              <p className="text-lg font-bold leading-none">{spentTotal.toFixed(2)}h</p>
              <p className="text-[11px] text-muted-foreground">spent</p>
            </div>
            <div>
              <p className="text-lg font-bold leading-none">{wp.estimatedHours ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground">estimated</p>
            </div>
            <div>
              <p className="text-lg font-bold leading-none">{wp.remainingHours ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground">remaining</p>
            </div>
            <div>
              <p className="text-lg font-bold leading-none">{wp.storyPoints ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground">story points</p>
            </div>
          </div>

          {data.time.length === 0 ? (
            <p className="text-sm text-muted-foreground">No time logged yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {data.time.map((t) => (
                <li key={t._id} className="flex items-center gap-3 px-3 py-2">
                  <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium tabular-nums">{t.hours}h</span>{" "}
                    <span className="text-muted-foreground">
                      · {WP_ACTIVITY_LABEL[t.activity as WorkPackageActivity]} ·{" "}
                      {shortDate(t.spentOn)} · {t.userName ?? "Member"}
                    </span>
                    {t.comment && (
                      <span className="block text-xs text-muted-foreground">{t.comment}</span>
                    )}
                  </span>
                  {(t.userId === me.userId || me.canManage) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={busy}
                      onClick={() => run(() => deleteTime({ entryId: t._id as never }))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4">
            <div className="grid gap-1.5">
              <FieldLabel>Hours</FieldLabel>
              <Input
                type="number"
                min={0}
                step={0.25}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="2.5"
              />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Activity</FieldLabel>
              <Select value={activity} onValueChange={(v) => setActivity(v as WorkPackageActivity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WP_TIME_ACTIVITIES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {WP_ACTIVITY_LABEL[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Date</FieldLabel>
              <Input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Comment</FieldLabel>
              <Input
                value={timeComment}
                onChange={(e) => setTimeComment(e.target.value)}
                placeholder="What did you do?"
              />
            </div>
            <Button
              className="sm:col-span-4"
              disabled={busy || !hours}
              onClick={async () => {
                await run(
                  () =>
                    logTime({
                      id: wp._id as never,
                      hours: Number(hours),
                      activity,
                      spentOn: dateToMs(spentOn) ?? Date.now(),
                      comment: timeComment.trim() || undefined,
                    }),
                  "Time logged",
                );
                setHours("");
                setTimeComment("");
              }}
            >
              <Clock className="size-3.5" /> Log time
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

// ===========================================================================
// The main module
// ===========================================================================

export function ProjectWorkPackages({
  projectId,
  members,
}: {
  projectId: string;
  members: MemberOption[];
}) {
  const data = useQuery(api.workPackages.list, { projectId: projectId as never });
  const moveCard = useMutation(api.workPackages.moveCard);
  const bulkUpdate = useMutation(api.workPackages.bulkUpdate);
  const rescheduleAll = useMutation(api.workPackages.rescheduleAll);
  const createBaseline = useMutation(api.workPackages.createBaseline);

  const [view, setView] = useState<WorkPackageView>("table");
  const [groupBy, setGroupBy] = useState<WorkPackageGroupBy>("none");
  const [sortBy, setSortBy] = useState<SortKey>("position");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [boardMode, setBoardMode] = useState<WorkPackageBoardMode>("status");
  const [showSums, setShowSums] = useState(true);
  const [baselineId, setBaselineId] = useState("");
  const [sprintFilter, setSprintFilter] = useState("all");
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkPackageStatus[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [onlyMine, setOnlyMine] = useState(false);
  const [openOnly, setOpenOnly] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  // A stable identity keeps the filter/sum/baseline memos from re-running on
  // every render while the subscription is unchanged.
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const meUserId = data?.me.userId;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = items.filter((r) => {
      if (openOnly && wpIsClosed(r.status)) return false;
      if (sprintFilter === "none" && r.sprintId) return false;
      if (sprintFilter !== "all" && sprintFilter !== "none" && r.sprintId !== sprintFilter) {
        return false;
      }
      if (statusFilter.length > 0 && !statusFilter.includes(r.status as WorkPackageStatus)) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (priorityFilter !== "all" && r.priority !== priorityFilter) return false;
      if (assigneeFilter === "none" && r.assigneeId) return false;
      if (assigneeFilter !== "all" && assigneeFilter !== "none" && r.assigneeId !== assigneeFilter) {
        return false;
      }
      if (onlyMine && r.assigneeId !== meUserId) return false;
      if (q) {
        const hay = `${r.subject} ${r.description ?? ""} ${r.category ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Sorting works on the FILTERED set, like clicking a column header.
    const dir = sortDir === "asc" ? 1 : -1;
    const valueOf = (r: WpItem): number | string => {
      switch (sortBy) {
        case "subject":
          return r.subject.toLowerCase();
        case "status":
          return WP_STATUS_META[r.status as WorkPackageStatus].progress;
        case "priority":
          return WP_PRIORITY_META[r.priority as WorkPackagePriority].rank;
        case "assignee":
          return (r.assigneeName ?? "~~~").toLowerCase();
        case "start":
          return r.startAt ?? Number.MAX_SAFE_INTEGER;
        case "finish":
          return r.finishAt ?? Number.MAX_SAFE_INTEGER;
        case "progress":
          return r.doneRatio;
        case "storyPoints":
          return r.storyPoints ?? -1;
        default:
          return r.position;
      }
    };
    return out.slice().sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return cmp * dir;
    });
  }, [
    items,
    search,
    statusFilter,
    typeFilter,
    priorityFilter,
    assigneeFilter,
    sprintFilter,
    sortBy,
    sortDir,
    onlyMine,
    openOnly,
    meUserId,
  ]);

  /** Table footer roll-up over exactly what the filters left standing. */
  const sums = useMemo(
    () => ({
      count: filtered.length,
      storyPoints: filtered.reduce((s, r) => s + (r.storyPoints ?? 0), 0),
      estimatedHours: filtered.reduce((s, r) => s + (r.estimatedHours ?? 0), 0),
      remainingHours: filtered.reduce((s, r) => s + (r.remainingHours ?? 0), 0),
      spentHours: filtered.reduce((s, r) => s + r.spentHours, 0),
      progress: filtered.length
        ? Math.round(filtered.reduce((s, r) => s + r.doneRatio, 0) / filtered.length)
        : 0,
    }),
    [filtered],
  );

  const savedBaseline = data?.baselines.find((b) => b._id === baselineId);
  /** What changed since the chosen baseline — added / removed / old values. */
  const baselineDiff = useMemo(() => {
    if (!savedBaseline) return null;
    const current: WpBaselineItem[] = items.map((r) => ({
      id: r._id as string,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
      assigneeId: (r.assigneeId as string | undefined) ?? undefined,
      doneRatio: r.doneRatio,
      storyPoints: r.storyPoints,
      startAt: r.startAt,
      finishAt: r.finishAt,
      updatedAt: r.updatedAt,
    }));
    return wpDiffBaseline(current, savedBaseline.snapshot as WpBaselineItem[]);
  }, [items, savedBaseline]);

  /** Hierarchical ordering for the table's "Flat list / Hierarchy" mode. */
  const ordered = useMemo(() => {
    const visible = new Set(filtered.map((r) => r._id as string));
    const byParent = new Map<string, WpItem[]>();
    const roots: WpItem[] = [];
    for (const r of filtered) {
      const p = r.parentId as string | undefined;
      // A parent filtered out of view is treated as a root, so the child is
      // never hidden just because its parent didn't match the filter.
      if (p && visible.has(p)) {
        const list = byParent.get(p) ?? [];
        list.push(r);
        byParent.set(p, list);
      } else {
        roots.push(r);
      }
    }
    const out: { item: WpItem; depth: number }[] = [];
    const walk = (list: WpItem[], depth: number) => {
      for (const r of list.slice().sort((a, b) => a.position - b.position)) {
        out.push({ item: r, depth });
        const kids = byParent.get(r._id as string);
        if (kids && !collapsed.has(r._id as string)) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [filtered, collapsed]);

  /** Grouped sections when a group-by attribute is chosen. */
  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const keyOf = (r: WpItem): string => {
      switch (groupBy) {
        case "status":
          return WP_STATUS_META[r.status as WorkPackageStatus].label;
        case "type":
          return WP_TYPE_META[r.type as WorkPackageType].label;
        case "priority":
          return WP_PRIORITY_META[r.priority as WorkPackagePriority].label;
        case "assignee":
          return r.assigneeName ?? "Unassigned";
        case "version":
          return r.versionName ?? "No version";
        default:
          return "";
      }
    };
    const map = new Map<string, WpItem[]>();
    for (const r of filtered) {
      const k = keyOf(r);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupBy]);

  const toggleStatus = (s: WorkPackageStatus) =>
    setStatusFilter((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const clearFilters = () => {
    setSearch("");
    setStatusFilter([]);
    setTypeFilter("all");
    setPriorityFilter("all");
    setAssigneeFilter("all");
    setOnlyMine(false);
    setOpenOnly(true);
  };

  const filtersActive =
    search.trim() !== "" ||
    statusFilter.length > 0 ||
    typeFilter !== "all" ||
    priorityFilter !== "all" ||
    assigneeFilter !== "all" ||
    sprintFilter !== "all" ||
    onlyMine ||
    !openOnly;

  /** The current view as JSON — what a saved view stores. */
  const currentViewConfig = () =>
    JSON.stringify({
      view,
      groupBy,
      sortBy,
      sortDir,
      boardMode,
      search,
      statusFilter,
      typeFilter,
      priorityFilter,
      assigneeFilter,
      sprintFilter,
      onlyMine,
      openOnly,
      hiddenCols: [...hiddenCols],
    });

  /** Apply a saved view. Unknown keys are ignored, so old views keep working. */
  const applyViewConfig = (cfg: Record<string, unknown>) => {
    const asView = cfg.view as WorkPackageView | undefined;
    if (asView && (WP_VIEWS as readonly string[]).includes(asView)) setView(asView);
    if (cfg.groupBy) setGroupBy(cfg.groupBy as WorkPackageGroupBy);
    if (cfg.sortBy) setSortBy(cfg.sortBy as SortKey);
    if (cfg.sortDir === "asc" || cfg.sortDir === "desc") setSortDir(cfg.sortDir);
    if (cfg.boardMode) setBoardMode(cfg.boardMode as WorkPackageBoardMode);
    if (typeof cfg.search === "string") setSearch(cfg.search);
    if (Array.isArray(cfg.statusFilter)) setStatusFilter(cfg.statusFilter as WorkPackageStatus[]);
    if (typeof cfg.typeFilter === "string") setTypeFilter(cfg.typeFilter);
    if (typeof cfg.priorityFilter === "string") setPriorityFilter(cfg.priorityFilter);
    if (typeof cfg.assigneeFilter === "string") setAssigneeFilter(cfg.assigneeFilter);
    if (typeof cfg.sprintFilter === "string") setSprintFilter(cfg.sprintFilter);
    if (typeof cfg.onlyMine === "boolean") setOnlyMine(cfg.onlyMine);
    if (typeof cfg.openOnly === "boolean") setOpenOnly(cfg.openOnly);
    if (Array.isArray(cfg.hiddenCols)) setHiddenCols(new Set(cfg.hiddenCols as string[]));
  };

  const openDetail = (id: string) => setDetailId(id);

  /** Optional columns the user switched on, in declaration order. */
  const visibleExtra = EXTRA_COLS.filter((c) => !hiddenCols.has(c.key));

  /** One optional column's cell, so the header and the row stay in step. */
  const extraCell = (item: WpItem, key: string): string => {
    switch (key) {
      case "sprint":
        return item.sprintName ?? "Backlog";
      case "version":
        return item.versionName ?? "—";
      case "points":
        return item.storyPoints !== undefined ? String(item.storyPoints) : "—";
      case "spent":
        return item.spentHours > 0 ? item.spentHours.toFixed(2) : "—";
      case "duration":
        return item.durationDays !== undefined ? `${item.durationDays}d` : "—";
      case "category":
        return item.category ?? "—";
      default:
        return "—";
    }
  };

  /**
   * Board columns. A status board lists the statuses that hold work (plus the
   * three every project uses); the other modes bucket by assignee, version or
   * parent, which is how OpenProject's basic/action boards behave. Every column
   * carries the patch a drop should apply.
   */
  const boardColumns = useMemo(() => {
    type Column = {
      key: string;
      label: string;
      dotClass: string;
      items: WpItem[];
      drop: Record<string, unknown>;
    };
    if (boardMode === "status") {
      const used = new Set(filtered.map((r) => r.status));
      return WP_STATUSES.filter(
        (s) => used.has(s) || ["new", "in_progress", "closed"].includes(s),
      ).map<Column>((s) => ({
        key: `status:${s}`,
        label: WP_STATUS_META[s].label,
        dotClass: WP_STATUS_META[s].dot,
        items: filtered.filter((r) => r.status === s),
        drop: { status: s },
      }));
    }
    const bucket = (
      keyOf: (r: WpItem) => string,
      labelOf: (key: string, list: WpItem[]) => string,
      dropOf: (key: string) => Record<string, unknown>,
      dotClass: string,
    ): Column[] => {
      const map = new Map<string, WpItem[]>();
      for (const r of filtered) {
        const k = keyOf(r);
        map.set(k, [...(map.get(k) ?? []), r]);
      }
      return [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, list]) => ({
          key: k,
          label: labelOf(k, list),
          dotClass,
          items: list,
          drop: dropOf(k),
        }));
    };
    if (boardMode === "assignee") {
      return bucket(
        (r) => (r.assigneeId as string | undefined) ?? "none",
        (k, list) => (k === "none" ? "Unassigned" : list[0].assigneeName ?? "Member"),
        (k) => (k === "none" ? { clearAssignee: true } : { assigneeId: k }),
        "bg-muted-foreground/50",
      );
    }
    if (boardMode === "version") {
      return bucket(
        (r) => (r.versionId as string | undefined) ?? "none",
        (k, list) => (k === "none" ? "No version" : list[0].versionName ?? "Version"),
        (k) => (k === "none" ? { clearVersion: true } : { versionId: k }),
        "bg-amber-400",
      );
    }
    return bucket(
      (r) => (r.parentId as string | undefined) ?? "none",
      (k, list) => (k === "none" ? "Top level" : list[0].parentSubject ?? "Parent"),
      (k) => (k === "none" ? { clearParent: true } : { parentId: k }),
      "bg-indigo-400",
    );
  }, [filtered, boardMode]);

  /** Timeline extent — only the packages that actually have dates. */
  const dated = useMemo(() => filtered.filter((r) => r.startAt || r.finishAt), [filtered]);
  const span = useMemo(() => {
    if (dated.length === 0) return null;
    // `dated` only holds rows that have at least one of the two dates, so the
    // cast is safe — and it keeps the clock out of render.
    const from = Math.min(...dated.map((r) => (r.startAt ?? r.finishAt) as number));
    const to = Math.max(...dated.map((r) => (r.finishAt ?? r.startAt) as number));
    // Pad to a full day so a single-day bar still has width.
    return { from, to: Math.max(to, from + 864e5) };
  }, [dated]);

  if (data === undefined) {
    return (
      <div className="py-10">
        <LoadingGif size={40} label={null} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ===== Toolbar ===== */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="glass flex items-center gap-1 rounded-lg border p-0.5">
            {WP_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  view === v ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="mr-1" aria-hidden>
                  {WP_VIEW_META[v].icon}
                </span>
                {WP_VIEW_META[v].label}
              </button>
            ))}
          </div>

          {view === "table" && (
            <>
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as WorkPackageGroupBy)}>
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WP_GROUP_BY.map((g) => (
                    <SelectItem key={g} value={g}>
                      Group by: {WP_GROUP_LABEL[g]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      Sort: {SORT_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                title="Flip the sort direction"
              >
                <ArrowUpDown className="size-3.5" />
                {sortDir === "asc" ? "Asc" : "Desc"}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    Columns
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {EXTRA_COLS.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.key}
                      checked={!hiddenCols.has(c.key)}
                      onCheckedChange={() =>
                        setHiddenCols((cur) => {
                          const next = new Set(cur);
                          if (next.has(c.key)) next.delete(c.key);
                          else next.add(c.key);
                          return next;
                        })
                      }
                      onSelect={(e) => e.preventDefault()}
                    >
                      {c.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          {view === "board" && (
            <Select value={boardMode} onValueChange={(v) => setBoardMode(v as WorkPackageBoardMode)}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WP_BOARD_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    Board: {WP_BOARD_MODE_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject, description…"
              className="h-8 pl-8 text-xs"
            />
          </div>

          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="size-3.5" /> New
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSaveViewOpen(true)}>
            <Settings2 className="size-3.5" /> Save view
          </Button>
          <Button size="sm" variant="outline" onClick={() => setVersionsOpen(true)}>
            <Flag className="size-3.5" /> Versions
          </Button>
        </div>

        {/* Saved views + baselines (OpenProject: named views, table comparison) */}
        {(data.queries.length > 0 || data.baselines.length > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {data.queries.length > 0 && (
              <Select
                value=""
                onValueChange={(id) => {
                  const query = data.queries.find((q) => q._id === id);
                  if (!query) return;
                  try {
                    applyViewConfig(JSON.parse(query.config));
                    toast.success(`Loaded “${query.name}”`);
                  } catch {
                    toast.error("That saved view could not be read");
                  }
                }}
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue placeholder="Saved views…" />
                </SelectTrigger>
                <SelectContent>
                  {data.queries.map((q) => (
                    <SelectItem key={q._id} value={q._id}>
                      {q.shared ? "👥" : "🔒"} {q.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={baselineId || "none"} onValueChange={(v) => setBaselineId(v === "none" ? "" : v)}>
              <SelectTrigger className="h-8 w-52 text-xs">
                <SelectValue placeholder="Compare against…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No comparison</SelectItem>
                {data.baselines.map((b) => (
                  <SelectItem key={b._id} value={b._id}>
                    {b.name} · {b.count} items
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Filter className="size-3.5" /> Filters
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                Status
                {statusFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {statusFilter.length}
                  </Badge>
                )}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              {WP_STATUSES.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={statusFilter.includes(s)}
                  onCheckedChange={() => toggleStatus(s)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {WP_STATUS_META[s].label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {WP_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {WP_TYPE_META[t].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              {WP_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {WP_PRIORITY_META[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Anyone</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {memberName(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {data.sprints.length > 0 && (
            <Select value={sprintFilter} onValueChange={setSprintFilter}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any sprint</SelectItem>
                <SelectItem value="none">Backlog only</SelectItem>
                {data.sprints.map((s) => (
                  <SelectItem key={s._id} value={s._id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant={onlyMine ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setOnlyMine((v) => !v)}
          >
            Assigned to me
          </Button>
          <Button
            variant={openOnly ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setOpenOnly((v) => !v)}
          >
            Open only
          </Button>
          {view === "table" && (
            <Button
              variant={showSums ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowSums((v) => !v)}
              title="Show the sum row at the bottom of the table"
            >
              <Sigma className="size-3.5" /> Sums
            </Button>
          )}
          {data.me.canManage && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={async () => {
                  try {
                    const res = await rescheduleAll({ projectId: projectId as never });
                    toast.success(
                      res.moved > 0
                        ? `${res.moved} automatic date${res.moved === 1 ? "" : "s"} recalculated`
                        : "Everything is already in place",
                    );
                  } catch (e) {
                    toast.error(asMessage(e));
                  }
                }}
              >
                <CalendarRange className="size-3.5" /> Reschedule
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={async () => {
                  const name = window.prompt(
                    "Name this baseline",
                    `Baseline ${new Date().toLocaleDateString("en-GB")}`,
                  );
                  if (!name) return;
                  try {
                    await createBaseline({ projectId: projectId as never, name });
                    toast.success("Baseline saved — compare against it from the toolbar");
                  } catch (e) {
                    toast.error(asMessage(e));
                  }
                }}
              >
                <Layers className="size-3.5" /> Snapshot
              </Button>
            </>
          )}
          {filtersActive && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
              <X className="size-3.5" /> Clear
            </Button>
          )}

          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {data.stats.total} shown
            {data.stats.overdue > 0 && (
              <span className="ml-2 text-red-400">{data.stats.overdue} overdue</span>
            )}
          </span>
        </div>
      </div>

      {/* ===== Bulk bar ===== */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
          <span className="text-xs font-medium">{selected.size} selected</span>
          <Select
            value=""
            onValueChange={async (v) => {
              try {
                await bulkUpdate({
                  ids: [...selected] as never,
                  status: v as WorkPackageStatus,
                });
                toast.success("Status updated");
                setSelected(new Set());
              } catch (e) {
                toast.error(asMessage(e));
              }
            }}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Set status…" />
            </SelectTrigger>
            <SelectContent>
              {WP_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {WP_STATUS_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value=""
            onValueChange={async (v) => {
              try {
                await bulkUpdate({
                  ids: [...selected] as never,
                  ...(v === "none"
                    ? { clearAssignee: true }
                    : { assigneeId: v as never }),
                });
                toast.success("Assignee updated");
                setSelected(new Set());
              } catch (e) {
                toast.error(asMessage(e));
              }
            }}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Set assignee…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassign</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {memberName(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value=""
            onValueChange={async (v) => {
              try {
                await bulkUpdate({ ids: [...selected] as never, priority: v as WorkPackagePriority });
                toast.success("Priority updated");
                setSelected(new Set());
              } catch (e) {
                toast.error(asMessage(e));
              }
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="Set priority…" />
            </SelectTrigger>
            <SelectContent>
              {WP_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {WP_PRIORITY_META[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      {/* ===== Table ===== */}
      {view === "table" && (
        <div className="glass-3d overflow-hidden rounded-lg border">
          <div className="hidden items-center gap-3 border-b bg-muted/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:flex">
            <span className="w-5" />
            <span className="w-28">Type</span>
            <span className="w-12">ID</span>
            <span className="flex-1">Subject</span>
            <span className="w-32">Status</span>
            <span className="w-20">Priority</span>
            <span className="w-36">Assignee</span>
            <span className="w-36">Dates</span>
            <span className="w-24">Progress</span>
            {visibleExtra.map((c) => (
              <span key={c.key} className="hidden w-24 shrink-0 lg:block">
                {c.label}
              </span>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">
              {items.length === 0
                ? "No work packages yet — create the first one."
                : "Nothing matches these filters."}
            </p>
          ) : groups ? (
            groups.map(([name, rows]) => (
              <div key={name}>
                <div className="border-y bg-muted/20 px-3 py-1.5 text-xs font-semibold">
                  {name}{" "}
                  <span className="font-normal text-muted-foreground">({rows.length})</span>
                </div>
                <ul className="divide-y">
                  {rows.map((r) => (
                    <TableRow
                      key={r._id}
                      item={r}
                      depth={0}
                      selected={selected.has(r._id as string)}
                      onToggleSelect={() =>
                        setSelected((cur) => {
                          const next = new Set(cur);
                          if (next.has(r._id as string)) next.delete(r._id as string);
                          else next.add(r._id as string);
                          return next;
                        })
                      }
                      onOpen={() => openDetail(r._id as string)}
                      extraCols={visibleExtra.map((c) => c.key)}
                      onExtraCell={extraCell}
                      diff={baselineDiff?.modified.get(r._id as string)}
                      isAdded={baselineDiff?.added.includes(r._id as string)}
                    />
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <ul className="divide-y">
              {ordered.map(({ item, depth }) => (
                <TableRow
                  key={item._id}
                  item={item}
                  depth={depth}
                  collapsible={item.childCount > 0}
                  collapsed={collapsed.has(item._id as string)}
                  onToggleCollapse={() =>
                    setCollapsed((cur) => {
                      const next = new Set(cur);
                      if (next.has(item._id as string)) next.delete(item._id as string);
                      else next.add(item._id as string);
                      return next;
                    })
                  }
                  selected={selected.has(item._id as string)}
                  onToggleSelect={() =>
                    setSelected((cur) => {
                      const next = new Set(cur);
                      if (next.has(item._id as string)) next.delete(item._id as string);
                      else next.add(item._id as string);
                      return next;
                    })
                  }
                  onOpen={() => openDetail(item._id as string)}
                  extraCols={visibleExtra.map((c) => c.key)}
                  onExtraCell={extraCell}
                  diff={baselineDiff?.modified.get(item._id as string)}
                  isAdded={baselineDiff?.added.includes(item._id as string)}
                />
              ))}
            </ul>
          )}

          {/* Sum row — the totals of exactly what the filters left standing. */}
          {showSums && filtered.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/30 px-3 py-2 text-[11px]">
              <span className="font-semibold">{sums.count} shown</span>
              <span className="text-muted-foreground">{sums.progress}% average complete</span>
              <span className="text-muted-foreground">{sums.storyPoints} story points</span>
              <span className="text-muted-foreground">
                {sums.estimatedHours}h estimated · {sums.spentHours.toFixed(2)}h spent ·{" "}
                {sums.remainingHours}h remaining
              </span>
              {baselineDiff && (
                <span className="ml-auto text-amber-400">
                  vs baseline: +{baselineDiff.added.length} added · {baselineDiff.removed.length}{" "}
                  removed · {baselineDiff.modified.size} changed
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== Board ===== */}
      {view === "board" && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {boardColumns.map((col) => {
            const cards = col.items;
            return (
              <div
                key={col.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async () => {
                  if (!dragId) return;
                  const id = dragId;
                  setDragId(null);
                  try {
                    await moveCard({ id: id as never, ...col.drop } as never);
                    toast.success(`Moved to ${col.label}`);
                  } catch (e) {
                    toast.error(asMessage(e));
                  }
                }}
                className="flex w-64 shrink-0 flex-col rounded-lg border bg-muted/10"
              >
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <span className={`size-2 rounded-full ${col.dotClass}`} />
                  <span className="text-xs font-semibold">{col.label}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">{cards.length}</span>
                </div>
                <ul className="flex flex-col gap-2 p-2">
                  {cards.map((r) => {
                    const assignee = members.find((m) => m.userId === r.assigneeId);
                    return (
                      <li
                        key={r._id}
                        draggable
                        onDragStart={() => setDragId(r._id as string)}
                        onDragEnd={() => setDragId(null)}
                        onClick={() => openDetail(r._id as string)}
                        className="cursor-pointer rounded-lg border bg-background p-2.5 shadow-sm transition-colors hover:border-primary/40"
                      >
                        <div className="flex items-center gap-1.5">
                          <TypeBadge type={r.type} />
                          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                            #{refOf(r._id)}
                          </span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-sm font-medium">{r.subject}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <PriorityBadge priority={r.priority} />
                          {r.storyPoints !== undefined && (
                            <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {r.storyPoints} SP
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Avatar className="size-5">
                            <AvatarImage src={assignee?.user.image} />
                            <AvatarFallback className="text-[9px]">
                              {initials(r.assigneeName)}
                            </AvatarFallback>
                          </Avatar>
                          <DatesChip startAt={r.startAt} finishAt={r.finishAt} />
                        </div>
                        {r.childCount > 0 && (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            <Layers className="mr-0.5 inline size-3" />
                            {r.childCount} sub-item{r.childCount === 1 ? "" : "s"}
                          </p>
                        )}
                      </li>
                    );
                  })}
                  {cards.length === 0 && (
                    <li className="rounded-lg border border-dashed px-2 py-6 text-center text-[11px] text-muted-foreground">
                      Drop a card here
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== Gantt / timeline ===== */}
      {view === "gantt" && (
        <div className="glass-3d rounded-lg border p-3">
          {!span ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing has a start or finish date yet. Set dates on a work package and it appears here.
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{shortDate(span.from)}</span>
                <span>
                  {dated.filter((r) => !wpIsClosed(r.status)).length} open on the timeline
                </span>
                <span>{shortDate(span.to)}</span>
              </div>
              <ul className="grid gap-1.5">
                {dated.map((r) => {
                  const start = r.startAt ?? r.finishAt ?? span.from;
                  const end = r.finishAt ?? start;
                  const left = ((start - span.from) / (span.to - span.from)) * 100;
                  const width = Math.max(1.5, ((end - start) / (span.to - span.from)) * 100);
                  const overdue = r.finishAt !== undefined && r.finishAt < Date.now() && !wpIsClosed(r.status);
                  return (
                    <li
                      key={r._id}
                      className="flex items-center gap-3"
                      onClick={() => openDetail(r._id as string)}
                    >
                      <span className="w-52 shrink-0 truncate text-xs">
                        <span className="mr-1 text-muted-foreground">#{refOf(r._id)}</span>
                        {r.subject}
                      </span>
                      <div className="relative h-5 flex-1 rounded bg-muted/40">
                        <span
                          className={`absolute top-0 h-5 rounded ${
                            overdue ? "bg-red-500/70" : wpIsClosed(r.status) ? "bg-emerald-500/60" : "bg-primary/60"
                          }`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${shortDate(start)} → ${shortDate(end)}`}
                        />
                      </div>
                      <span className="hidden w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground sm:block">
                        {wpDurationDays(r.startAt, r.finishAt) ?? 1}d
                      </span>
                      <StatusBadge status={r.status} />
                      {r.blockedBy > 0 && (
                        <Ban className="size-3.5 shrink-0 text-red-400" aria-label="blocked" />
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Bars span start → finish. An automatic package re-plans from its predecessors
                (plus lag) and from its children — open its detail panel to see the chain.
              </p>
            </>
          )}
        </div>
      )}

      {/* ===== Backlogs (sprints + burndown) ===== */}
      {view === "backlog" && (
        <BacklogPanel
          projectId={projectId}
          sprints={data.sprints}
          items={filtered}
          canManage={data.me.canManage}
          onOpen={openDetail}
        />
      )}

      {/* ===== Settings (progress mode, workflow, custom fields) ===== */}
      {view === "settings" && (
        <SettingsPanel
          projectId={projectId}
          data={data}
          onOpenVersions={() => setVersionsOpen(true)}
        />
      )}

      <NewWorkPackageDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        projectId={projectId}
        members={members}
        versions={data.versions}
        sprints={data.sprints}
        customFields={data.customFields}
        items={items}
        defaultScheduling={data.settings.scheduling}
      />
      <VersionsDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        projectId={projectId}
        versions={data.versions}
        canManage={data.me.canManage}
      />
      <SaveViewDialog
        open={saveViewOpen}
        onOpenChange={setSaveViewOpen}
        projectId={projectId}
        name={viewName}
        onNameChange={setViewName}
        config={currentViewConfig}
      />
      <DetailPanel
        id={detailId}
        onClose={() => setDetailId(null)}
        members={members}
        versions={data.versions}
        sprints={data.sprints}
      />
    </div>
  );
}

/** One table row — shared by the flat and grouped renderings. */
function TableRow({
  item,
  depth,
  collapsible,
  collapsed,
  onToggleCollapse,
  selected,
  onToggleSelect,
  onOpen,
  extraCols,
  onExtraCell,
  diff,
  isAdded,
}: {
  item: WpItem;
  depth: number;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  extraCols: string[];
  onExtraCell: (item: WpItem, key: string) => string;
  diff?: Record<string, string>;
  isAdded?: boolean;
}) {
  const overdue =
    item.finishAt !== undefined && item.finishAt < Date.now() && !wpIsClosed(item.status);
  const diffCount = diff ? Object.keys(diff).length : 0;
  const diffHint = diff
    ? Object.entries(diff)
        .map(([k, v]) => `${k} was ${v}`)
        .join(" · ")
    : undefined;
  return (
    <li className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/30">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        onClick={(e) => e.stopPropagation()}
        className="size-3.5 shrink-0 accent-primary"
        aria-label="Select work package"
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="hidden w-28 shrink-0 md:block">
          <TypeBadge type={item.type} />
        </span>
        <span className="hidden w-12 shrink-0 font-mono text-[11px] text-muted-foreground md:block">
          #{refOf(item._id)}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {depth > 0 && (
            <span className="shrink-0 text-muted-foreground" style={{ paddingLeft: (depth - 1) * 12 }}>
              ↳
            </span>
          )}
          {collapsible ? (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.();
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </span>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <span className={`truncate text-sm ${wpIsClosed(item.status) ? "text-muted-foreground line-through" : ""}`}>
            {item.subject}
          </span>
          {item.childCount > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground">({item.childCount})</span>
          )}
          {item.commentCount > 0 && (
            <span className="hidden shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground sm:flex">
              <MessageSquare className="size-3" /> {item.commentCount}
            </span>
          )}
          {item.relationCount > 0 && (
            <span className="hidden shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground sm:flex">
              <GitBranch className="size-3" /> {item.relationCount}
            </span>
          )}
          {item.blockedBy > 0 && (
            <span className="shrink-0" title="Blocked — close the blocker first">
              <Ban className="size-3 text-red-400" />
            </span>
          )}
          {item.predecessorCount > 0 && (
            <span
              className="hidden shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground sm:flex"
              title={`${item.predecessorCount} predecessor(s)`}
            >
              <CalendarRange className="size-3" /> {item.predecessorCount}
            </span>
          )}
          {isAdded && (
            <span className="shrink-0 rounded border border-sky-500/40 bg-sky-500/10 px-1 text-[10px] text-sky-400">
              new
            </span>
          )}
          {diffCount > 0 && (
            <span
              className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] text-amber-400"
              title={diffHint}
            >
              {diffCount} changed
            </span>
          )}
          {item.category && (
            <span className="hidden shrink-0 items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] text-muted-foreground lg:flex">
              <Tag className="size-3" /> {item.category}
            </span>
          )}
        </span>
        <span className="hidden w-32 shrink-0 md:block">
          <StatusBadge status={item.status} />
        </span>
        <span className="hidden w-20 shrink-0 md:block">
          <PriorityBadge priority={item.priority} />
        </span>
        <span className="hidden w-36 shrink-0 items-center gap-1.5 md:flex">
          <Avatar className="size-5">
            <AvatarImage src={item.assigneeImage} />
            <AvatarFallback className="text-[9px]">{initials(item.assigneeName)}</AvatarFallback>
          </Avatar>
          <span className="truncate text-xs text-muted-foreground">
            {item.assigneeName ?? "Unassigned"}
          </span>
        </span>
        <span className={`hidden w-36 shrink-0 md:block ${overdue ? "text-red-400" : ""}`}>
          <DatesChip startAt={item.startAt} finishAt={item.finishAt} />
        </span>
        <span className="hidden w-24 shrink-0 items-center gap-1.5 md:flex">
          <Progress value={item.doneRatio} className="h-1.5 flex-1" />
          <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
            {item.doneRatio}%
          </span>
        </span>
        {extraCols.map((key) => (
          <span
            key={key}
            className="hidden w-24 shrink-0 truncate text-[11px] text-muted-foreground lg:block"
          >
            {onExtraCell(item, key)}
          </span>
        ))}
      </button>
    </li>
  );
}

// ===========================================================================
// Saved views
// ===========================================================================

function SaveViewDialog({
  open,
  onOpenChange,
  projectId,
  name,
  onNameChange,
  config,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  name: string;
  onNameChange: (v: string) => void;
  config: () => string;
}) {
  const saveQuery = useMutation(api.workPackages.saveQuery);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="My open bugs this sprint"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
              className="size-4 accent-primary"
            />
            Share this view with the team
          </label>
          <p className="text-[11px] text-muted-foreground">
            A saved view stores the filters, grouping, sorting and board mode you are looking
            at, so anyone can jump back to it.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || name.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                await saveQuery({
                  projectId: projectId as never,
                  name,
                  shared,
                  config: config(),
                });
                toast.success("View saved");
                onOpenChange(false);
                onNameChange("");
              } catch (e) {
                toast.error(asMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Backlogs — sprints, the backlog itself and the burndown
// ===========================================================================

/** Sprint burndown by story points, drawn from the pure rule in the lib. */
function Burndown({ items, sprint }: { items: WpItem[]; sprint: ListSprint }) {
  const { total, days } = wpBurndown(
    items.map((i) => ({ storyPoints: i.storyPoints, closedAt: i.closedAt })),
    { startAt: sprint.startAt, finishAt: sprint.finishAt },
  );
  if (days.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Set both sprint dates to chart the burndown.
      </p>
    );
  }
  const max = Math.max(total, 1);
  const w = 220;
  const h = 56;
  const x = (i: number) => (i / Math.max(1, days.length - 1)) * w;
  const y = (v: number) => h - (v / max) * h;
  const actual = days.map((d, i) => `${x(i)},${y(d.remaining)}`).join(" ");
  const ideal = days.map((d, i) => `${x(i)},${y(d.ideal)}`).join(" ");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-56 shrink-0 overflow-visible">
        <polyline
          points={ideal}
          fill="none"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          className="stroke-muted-foreground/40"
        />
        <polyline points={actual} fill="none" strokeWidth="2" className="stroke-primary" />
      </svg>
      <div className="text-[11px] text-muted-foreground">
        <p className="text-sm font-semibold text-foreground">
          <TrendingDown className="mr-1 inline size-3.5" />
          {total} story points
        </p>
        <p>
          {days[days.length - 1].remaining} left · {shortDate(sprint.startAt)} →{" "}
          {shortDate(sprint.finishAt)}
        </p>
      </div>
    </div>
  );
}

function BacklogPanel({
  projectId,
  sprints,
  items,
  canManage,
  onOpen,
}: {
  projectId: string;
  sprints: ListSprint[];
  items: WpItem[];
  canManage: boolean;
  onOpen: (id: string) => void;
}) {
  const upsertSprint = useMutation(api.workPackages.upsertSprint);
  const setSprintStatus = useMutation(api.workPackages.setSprintStatus);
  const removeSprint = useMutation(api.workPackages.deleteSprint);
  const update = useMutation(api.workPackages.update);

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startAt, setStartAt] = useState("");
  const [finishAt, setFinishAt] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const backlog = items.filter((r) => !r.sprintId);

  const assign = async (id: string, sprintId?: string) => {
    try {
      await update({
        id: id as never,
        ...(sprintId ? { sprintId: sprintId as never } : { unset: ["sprintId"] }),
      });
    } catch (e) {
      toast.error(asMessage(e));
    }
  };

  /** Run a mutation with one toast on failure; true when it went through. */
  const run = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error(asMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** A draggable card, reused for the backlog and every sprint. */
  const Card = ({ item }: { item: WpItem }) => (
    <li
      draggable
      onDragStart={() => setDragId(item._id as string)}
      onDragEnd={() => setDragId(null)}
      onClick={() => onOpen(item._id as string)}
      className="cursor-pointer rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-1.5">
        <TypeBadge type={item.type} />
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          #{refOf(item._id)}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm">{item.subject}</p>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        {item.storyPoints !== undefined && <span>{item.storyPoints} SP</span>}
        {item.doneRatio > 0 && <span>{item.doneRatio}%</span>}
        {item.blockedBy > 0 && <Ban className="size-3 text-red-400" />}
      </div>
    </li>
  );

  return (
    <div className="grid gap-4">
      {/* Backlog column */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          if (!dragId) return;
          const id = dragId;
          setDragId(null);
          void assign(id);
        }}
        className="glass-3d rounded-lg border"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Layers className="size-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold">Backlog</span>
          <span className="text-[11px] text-muted-foreground">
            {backlog.length} item{backlog.length === 1 ? "" : "s"} · not planned into a sprint
          </span>
        </div>
        {backlog.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            The backlog is empty — drop a card here to pull it out of its sprint.
          </p>
        ) : (
          <ul className="grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-3">
            {backlog.map((item) => (
              <Card key={item._id} item={item} />
            ))}
          </ul>
        )}
      </div>

      {/* Sprints */}
      {sprints.map((sprint) => {
        const planned = items.filter((r) => r.sprintId === sprint._id);
        return (
          <div
            key={sprint._id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!dragId) return;
              const id = dragId;
              setDragId(null);
              void assign(id, sprint._id);
            }}
            className="glass-3d rounded-lg border"
          >
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                  sprint.status === "active"
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                    : sprint.status === "closed"
                      ? "border-border bg-muted text-muted-foreground"
                      : "border-sky-500/30 bg-sky-500/15 text-sky-400"
                }`}
              >
                {WP_SPRINT_STATUS_LABEL[sprint.status as WorkPackageSprintStatus]}
              </span>
              <span className="text-sm font-semibold">{sprint.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {shortDate(sprint.startAt)} → {shortDate(sprint.finishAt)} · {planned.length} item
                {planned.length === 1 ? "" : "s"}
              </span>
              {canManage && (
                <div className="ml-auto flex items-center gap-1">
                  {sprint.status === "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      disabled={busy}
                      onClick={() => run(() => setSprintStatus({ id: sprint._id as never, status: "active" }), "Sprint started")}
                    >
                      <Play className="size-3" /> Start
                    </Button>
                  )}
                  {sprint.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await run(() =>
                          setSprintStatus({ id: sprint._id as never, status: "closed" }),
                        );
                        if (ok) {
                          toast.success(
                            "Sprint closed — unfinished work went back to the backlog",
                          );
                        }
                      }}
                    >
                      Close
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive"
                    disabled={busy}
                    onClick={() => run(() => removeSprint({ id: sprint._id as never }), "Sprint removed")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
            {sprint.goal && (
              <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">🎯 {sprint.goal}</p>
            )}
            <div className="border-b px-3 py-2">
              <Burndown items={planned} sprint={sprint} />
            </div>
            {planned.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nothing planned into this sprint yet — drag cards here from the backlog.
              </p>
            ) : (
              <ul className="grid gap-2 p-2 sm:grid-cols-2 lg:grid-cols-3">
                {planned.map((item) => (
                  <Card key={item._id} item={item} />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {canManage && (
        <div className="glass-3d grid gap-3 rounded-lg border p-3 sm:grid-cols-5">
          <div className="grid gap-1.5 sm:col-span-2">
            <FieldLabel>New sprint</FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 3 — drive tuning" />
          </div>
          <div className="grid gap-1.5 sm:col-span-3">
            <FieldLabel>Goal</FieldLabel>
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What ships at the end of it?" />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel>Start</FieldLabel>
            <Input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel>Finish</FieldLabel>
            <Input type="date" value={finishAt} onChange={(e) => setFinishAt(e.target.value)} />
          </div>
          <Button
            className="sm:col-span-3"
            disabled={busy || name.trim().length < 2}
            onClick={async () => {
              await run(
                () =>
                  upsertSprint({
                    projectId: projectId as never,
                    name,
                    goal: goal.trim() || undefined,
                    startAt: dateToMs(startAt),
                    finishAt: dateToMs(finishAt),
                  }),
                "Sprint created",
              );
              setName("");
              setGoal("");
              setStartAt("");
              setFinishAt("");
            }}
          >
            <Plus className="size-3.5" /> Create sprint
          </Button>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Settings — how the tracking plane behaves in this project
// ===========================================================================

/**
 * The project's work-package configuration, laid out the way OpenProject's
 * administration does it: the progress-tracking mode, the scheduling defaults
 * and the per-type status workflow that gates every move.
 */
function SettingsPanel({
  projectId,
  data,
  onOpenVersions,
}: {
  projectId: string;
  data: ListResult;
  onOpenVersions: () => void;
}) {
  const saveSettings = useMutation(api.workPackages.saveSettings);
  const upsertCustomField = useMutation(api.workPackages.upsertCustomField);
  const removeCustomField = useMutation(api.workPackages.deleteCustomField);
  const removeBaseline = useMutation(api.workPackages.deleteBaseline);
  const canManage = data.me.canManage;

  const [progressMode, setProgressMode] = useState<WorkPackageProgressMode>(
    data.settings.progressMode as WorkPackageProgressMode,
  );
  const [scheduling, setScheduling] = useState<WorkPackageSchedulingMode>(
    data.settings.scheduling as WorkPackageSchedulingMode,
  );
  const [workingDaysOnly, setWorkingDaysOnly] = useState(data.settings.workingDaysOnly);
  const [workflowType, setWorkflowType] = useState<WorkPackageType>("task");
  const [workflow, setWorkflow] = useState<WorkPackageTransition[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [cfName, setCfName] = useState("");
  const [cfFormat, setCfFormat] = useState<WorkPackageCustomFieldFormat>("text");
  const [cfOptions, setCfOptions] = useState("");
  const [cfTypes, setCfTypes] = useState<string[]>([]);

  const rows =(workflow ??
    (data.settings.workflow.length > 0
      ? (data.settings.workflow as WorkPackageTransition[])
      : (wpDefaultWorkflow() as WorkPackageTransition[])));

  const isOn = (from: string, to: string) =>
    rows.some((r) => r.type === workflowType && r.from === from && r.to === to);

  const toggle = (from: string, to: string) => {
    const next = rows.map((r) => ({ ...r }));
    const idx = next.findIndex((r) => r.type === workflowType && r.from === from && r.to === to);
    if (idx >= 0) next.splice(idx, 1);
    else next.push({ type: workflowType, from: from as WorkPackageStatus, to: to as WorkPackageStatus });
    setWorkflow(next);
  };

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ===== Progress and scheduling ===== */}
      <section className="glass-3d grid gap-4 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Tracking</h3>
        <div className="grid gap-1.5">
          <FieldLabel>Progress calculation</FieldLabel>
          <Select
            value={progressMode}
            disabled={!canManage}
            onValueChange={(v) => setProgressMode(v as WorkPackageProgressMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WP_PROGRESS_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {WP_PROGRESS_MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{WP_PROGRESS_MODE_HINT[progressMode]}</p>
        </div>

        <div className="grid gap-1.5">
          <FieldLabel>Scheduling for new work packages</FieldLabel>
          <Select
            value={scheduling}
            disabled={!canManage}
            onValueChange={(v) => setScheduling(v as WorkPackageSchedulingMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WP_SCHEDULING_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {WP_SCHEDULING_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={workingDaysOnly}
            disabled={!canManage}
            onChange={(e) => setWorkingDaysOnly(e.target.checked)}
            className="size-4 accent-primary"
          />
          Count working days only (skip weekends)
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!canManage || busy}
            onClick={() =>
              run(
                () =>
                  saveSettings({
                    projectId: projectId as never,
                    progressMode,
                    scheduling,
                    workingDaysOnly,
                    workflow: rows,
                  }),
                "Settings saved",
              )
            }
          >
            Save settings
          </Button>
          <Button variant="outline" onClick={onOpenVersions}>
            <Flag className="size-3.5" /> Versions
          </Button>
        </div>
      </section>

      {/* ===== Workflow ===== */}
      <section className="glass-3d grid gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Workflow</h3>
          <span className="text-[11px] text-muted-foreground">
            which statuses a type may move to
          </span>
          <Select
            value={workflowType}
            onValueChange={(v) => setWorkflowType(v as WorkPackageType)}
          >
            <SelectTrigger className="ml-auto h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WP_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {WP_TYPE_META[t].icon} {WP_TYPE_META[t].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          {WP_STATUSES.map((from) => (
            <div key={from} className="flex flex-wrap items-center gap-1">
              <span className="w-32 shrink-0 text-[11px] text-muted-foreground">
                {WP_STATUS_META[from].label}
              </span>
              {WP_STATUSES.filter((to) => to !== from).map((to) => {
                const on = isOn(from, to);
                return (
                  <button
                    key={to}
                    type="button"
                    disabled={!canManage}
                    onClick={() => toggle(from, to)}
                    title={`${WP_STATUS_META[from].label} → ${WP_STATUS_META[to].label}`}
                    className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                      on
                        ? "border-primary/50 bg-primary/15 text-foreground"
                        : "border-border text-muted-foreground/60 hover:border-primary/30"
                    }`}
                  >
                    {WP_STATUS_META[to].label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canManage || busy}
            onClick={() => run(async () => setWorkflow(null), "Back to the documented default")}
          >
            Documented default
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {rows.length} rule{rows.length === 1 ? "" : "s"} configured
          </span>
        </div>
      </section>

      {/* ===== Custom fields ===== */}
      <section className="glass-3d grid gap-3 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Custom fields</h3>
          <span className="text-[11px] text-muted-foreground">
            extra attributes on a work package
          </span>
        </div>
        {data.customFields.length === 0 ? (
          <p className="text-xs text-muted-foreground">No custom fields yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.customFields.map((def) => (
              <li key={def._id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{def.name}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {WP_CUSTOM_FIELD_FORMAT_LABEL[def.fieldFormat as WorkPackageCustomFieldFormat]}
                </Badge>
                {def.types.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {def.types.map((t) => WP_TYPE_META[t as WorkPackageType]?.label ?? t).join(", ")}
                  </span>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    disabled={busy}
                    onClick={() => run(() => removeCustomField({ id: def._id as never }), "Field removed")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <FieldLabel>Name</FieldLabel>
            <Input value={cfName} onChange={(e) => setCfName(e.target.value)} placeholder="Test rig" />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel>Format</FieldLabel>
            <Select
              value={cfFormat}
              onValueChange={(v) => setCfFormat(v as WorkPackageCustomFieldFormat)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WP_CUSTOM_FIELD_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {WP_CUSTOM_FIELD_FORMAT_LABEL[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {cfFormat === "list" && (
            <div className="grid gap-1.5 sm:col-span-2">
              <FieldLabel>Options (comma separated)</FieldLabel>
              <Input
                value={cfOptions}
                onChange={(e) => setCfOptions(e.target.value)}
                placeholder="Bench, Field, Workshop"
              />
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <FieldLabel>Applies to (none = every type)</FieldLabel>
            <div className="flex flex-wrap gap-1">
              {WP_TYPES.map((t) => {
                const on = cfTypes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      setCfTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
                    }
                    className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                      on ? "border-primary/50 bg-primary/15 text-foreground" : "border-border text-muted-foreground/60"
                    }`}
                  >
                    {WP_TYPE_META[t].label}
                  </button>
                );
              })}
            </div>
          </div>
          <Button
            className="sm:col-span-2"
            disabled={busy || cfName.trim().length < 2}
            onClick={async () => {
              await run(
                () =>
                  upsertCustomField({
                    projectId: projectId as never,
                    name: cfName,
                    fieldFormat: cfFormat,
                    possibleValues:
                      cfFormat === "list"
                        ? cfOptions.split(",").map((s) => s.trim()).filter(Boolean)
                        : undefined,
                    types: cfTypes,
                  }),
                "Custom field added",
              );
              setCfName("");
              setCfOptions("");
              setCfTypes([]);
            }}
          >
            <Plus className="size-3.5" /> Add field
          </Button>
          </div>
        )}
      </section>

      {/* ===== Baselines ===== */}
      <section className="glass-3d grid gap-3 rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Baselines</h3>
          <span className="text-[11px] text-muted-foreground">
            snapshots you can compare the table against
          </span>
        </div>
        {data.baselines.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No baselines yet — use “Snapshot” in the toolbar to record today's plan.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.baselines.map((b) => (
              <li key={b._id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {b.count} items · {shortDate(b.createdAt)}
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    disabled={busy}
                    onClick={() => run(() => removeBaseline({ id: b._id as never }), "Baseline deleted")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
