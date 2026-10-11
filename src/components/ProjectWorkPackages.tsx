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
  WP_DEFAULT_PRIORITY,
  WP_DEFAULT_TYPE,
  WP_GROUP_BY,
  WP_GROUP_LABEL,
  WP_PRIORITIES,
  WP_PRIORITY_META,
  WP_RELATION_META,
  WP_RELATION_TYPES,
  WP_STATUSES,
  WP_STATUS_META,
  WP_TIME_ACTIVITIES,
  WP_TYPES,
  WP_TYPE_META,
  WP_VERSION_STATUS_LABEL,
  WP_VERSION_STATUSES,
  WP_VIEWS,
  WP_VIEW_META,
  dateToMs,
  msToDate,
  shortDate,
  wpIsClosed,
  type WorkPackageActivity,
  type WorkPackageGroupBy,
  type WorkPackagePriority,
  type WorkPackageRelationType,
  type WorkPackageStatus,
  type WorkPackageType,
  type WorkPackageVersionStatus,
  type WorkPackageView,
} from "@/lib/work-packages";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Filter,
  Flag,
  GitBranch,
  Layers,
  Link2,
  MessageSquare,
  Plus,
  Search,
  Tag,
  Trash2,
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
type DetailResult = NonNullable<FunctionReturnType<typeof api.workPackages.detail>>;

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
  parentId: string;
  category: string;
};

const emptyDraft = (): Draft => ({
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
  parentId: "",
  category: "",
});

function NewWorkPackageDialog({
  open,
  onOpenChange,
  projectId,
  members,
  versions,
  items,
  parentOf,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  members: MemberOption[];
  versions: ListResult["versions"];
  items: WpItem[];
  parentOf?: WpItem;
}) {
  const create = useMutation(api.workPackages.create);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    setBusy(true);
    try {
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
        parentId: draft.parentId ? (draft.parentId as never) : undefined,
        category: draft.category.trim() || undefined,
      });
      toast.success("Work package created");
      onOpenChange(false);
      setDraft(emptyDraft());
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
        if (!v) setDraft(emptyDraft());
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
}: {
  id: string | null;
  onClose: () => void;
  members: MemberOption[];
  versions: ListResult["versions"];
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
          <DetailBody data={data} onClose={onClose} members={members} versions={versions} />
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
}: {
  data: DetailResult;
  onClose: () => void;
  members: MemberOption[];
  versions: ListResult["versions"];
}) {
  const { wp, me } = data;
  const update = useMutation(api.workPackages.update);
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

  const assignee = members.find((m) => m.userId === wp.assigneeId);
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
                  {WP_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {WP_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

          <div className="grid gap-1.5">
            <FieldLabel>% Complete</FieldLabel>
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
              disabled={!canEdit}
              value={wp.doneRatio}
              onChange={(e) => patch({ id: wp._id as never, doneRatio: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>

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
  const move = useMutation(api.workPackages.move);
  const bulkUpdate = useMutation(api.workPackages.bulkUpdate);

  const [view, setView] = useState<WorkPackageView>("table");
  const [groupBy, setGroupBy] = useState<WorkPackageGroupBy>("none");
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

  const items = data?.items ?? [];
  const meUserId = data?.me.userId;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((r) => {
      if (openOnly && wpIsClosed(r.status)) return false;
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
  }, [
    items,
    search,
    statusFilter,
    typeFilter,
    priorityFilter,
    assigneeFilter,
    onlyMine,
    openOnly,
    meUserId,
  ]);

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
    onlyMine ||
    !openOnly;

  const openDetail = (id: string) => setDetailId(id);

  /** Board columns: the open statuses, plus any that already hold work. */
  const boardStatuses = useMemo(() => {
    const used = new Set(filtered.map((r) => r.status));
    return WP_STATUSES.filter(
      (s) => used.has(s) || ["new", "in_progress", "closed"].includes(s),
    );
  }, [filtered]);

  /** Timeline extent — only the packages that actually have dates. */
  const dated = useMemo(() => filtered.filter((r) => r.startAt || r.finishAt), [filtered]);
  const span = useMemo(() => {
    if (dated.length === 0) return null;
    const from = Math.min(...dated.map((r) => r.startAt ?? r.finishAt ?? Date.now()));
    const to = Math.max(...dated.map((r) => r.finishAt ?? r.startAt ?? Date.now()));
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
          <Button size="sm" variant="outline" onClick={() => setVersionsOpen(true)}>
            <Flag className="size-3.5" /> Versions
          </Button>
        </div>

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
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ===== Board ===== */}
      {view === "board" && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {boardStatuses.map((s) => {
            const cards = filtered.filter((r) => r.status === s);
            return (
              <div
                key={s}
                onDragOver={(e) => e.preventDefault()}
                onDrop={async () => {
                  if (!dragId) return;
                  const id = dragId;
                  setDragId(null);
                  try {
                    await move({ id: id as never, status: s });
                    toast.success(`Moved to ${WP_STATUS_META[s].label}`);
                  } catch (e) {
                    toast.error(asMessage(e));
                  }
                }}
                className="flex w-64 shrink-0 flex-col rounded-lg border bg-muted/10"
              >
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <span className={`size-2 rounded-full ${WP_STATUS_META[s].dot}`} />
                  <span className="text-xs font-semibold">{WP_STATUS_META[s].label}</span>
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

      {/* ===== Timeline ===== */}
      {view === "timeline" && (
        <div className="glass-3d rounded-lg border p-3">
          {!span ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing has a start or finish date yet. Set dates on a work package and it appears here.
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{shortDate(span.from)}</span>
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
                      <StatusBadge status={r.status} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      <NewWorkPackageDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        projectId={projectId}
        members={members}
        versions={data.versions}
        items={items}
      />
      <VersionsDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        projectId={projectId}
        versions={data.versions}
        canManage={data.me.canManage}
      />
      <DetailPanel
        id={detailId}
        onClose={() => setDetailId(null)}
        members={members}
        versions={data.versions}
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
}: {
  item: WpItem;
  depth: number;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const overdue =
    item.finishAt !== undefined && item.finishAt < Date.now() && !wpIsClosed(item.status);
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
      </button>
    </li>
  );
}
