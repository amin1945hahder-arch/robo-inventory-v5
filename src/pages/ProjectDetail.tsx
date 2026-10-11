import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { ProjectReadmeTab } from "@/components/ProjectReadmeTab";
import { ProjectWorkPackages } from "@/components/ProjectWorkPackages";
import { LoadingGif } from "@/components/LoadingGif";
import { NavArrows } from "@/components/NavArrows";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { projectQr, unitQr } from "@/lib/qr";
import { compressImageFile, tabColor } from "@/lib/utils";
import {
  CENTER_META,
  PRIORITIES,
  PRIORITY_META,
  STATUS_META,
  TASK_STATUSES,
  type CenterKey,
  type Priority,
  type TaskStatus,
} from "@/lib/project-centers";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  Layers,
  PackageX,
  Pencil,
  Plus,
  RotateCcw,
  RefreshCw,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
const CENTER_KEYS = Object.keys(CENTER_META) as CenterKey[];

// Each subtab fills with its OWN color when active (Settings-bar treatment
// via .colored-tabs + tabColor in index.css/lib/utils).
const TAB_COLORS: Record<string, string> = {
  readme: "#818cf8",
  workpackages: "#60a5fa",
  overview: "#38bdf8",
  mechanical: "#fbbf24",
  electrical: "#facc15",
  inventory: "#22d3ee",
  programming: "#a78bfa",
  references: "#34d399",
  students: "#f472b6",
};
const tStyle = (tab: string) =>
  tabColor(TAB_COLORS[tab] ?? "#38bdf8");

type Workspace = {
  project: any;
  members: {
    _id: string;
    userId: string;
    role: "leader" | "member";
    center?: string;
    addedAt: number;
    /** Set when the person left (ex-member) or a new team started. */
    leftAt?: number;
    /** Team epoch this membership belongs to. */
    team?: number;
    user: { name?: string; email?: string; image?: string; appRole?: string };
  }[];
  tasks: {
    _id: string;
    center: string;
    title: string;
    details?: string;
    status: TaskStatus;
    priority: Priority;
    assigneeId?: string;
    assigneeName?: string;
    assigneeImage?: string;
    createdAt: number;
    dueAt?: number;
  }[];
  notes: {
    _id: string;
    center: string;
    title: string;
    body?: string;
    url?: string;
    createdBy: string;
    creatorName?: string;
    createdAt: number;
  }[];
  parts: { part: any; groupName: string }[];
  stats: {
    taskTotal: number;
    done: number;
    doing: number;
    review: number;
    todo: number;
    progressPct: number;
    perCenter: { center: string; total: number; done: number; pct: number }[];
  };
  me: {
    userId: string;
    isMember: boolean;
    membershipRole: "leader" | "member" | null;
    myRole: "admin" | "leader" | "member" | null;
    canManage: boolean;
  };
};

/** Small labeled donut used in the overview. */
function Ring({ pct, label, sub }: { pct: number; label: string; sub: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          className="stroke-primary transition-all"
        />
      </svg>
      <div>
        <p className="text-lg font-bold leading-none">{pct}%</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-[11px] text-muted-foreground/70">{sub}</p>
      </div>
    </div>
  );
}

/** One mission row with inline status control. */
function MissionRow({
  task,
  canManage,
  isAssignee,
  onStatus,
  onDelete,
}: {
  task: Workspace["tasks"][number];
  canManage: boolean;
  isAssignee: boolean;
  onStatus: (s: TaskStatus) => void;
  onDelete: () => void;
}) {
  const canMove = canManage || isAssignee;
  const meta = CENTER_META[task.center as CenterKey];
  const overdue = task.dueAt && task.status !== "done" && task.dueAt < Date.now();
  return (
    <li className="group flex items-start gap-3 px-4 py-3">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${STATUS_META[task.status].dot}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${task.status === "done" ? "text-muted-foreground line-through" : ""}`}>
          {task.title}
        </p>
        {task.details && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{task.details}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_META[task.priority].badge}`}>
            {PRIORITY_META[task.priority].label}
          </span>
          {meta && (
            <span className={`text-[10px] ${meta.color}`}>
              {meta.icon} {meta.label}
            </span>
          )}
          {task.assigneeName && (
            <span className="text-[10px] text-muted-foreground">· {task.assigneeName}</span>
          )}
          {task.dueAt && (
            <span className={`text-[10px] ${overdue ? "font-semibold text-red-400" : "text-muted-foreground"}`}>
              · {overdue ? "overdue " : "due "}
              {new Date(task.dueAt).toLocaleDateString("en-GB")}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canMove && task.status !== "done" && (
          <Select value={task.status} onValueChange={(v) => onStatus(v as TaskStatus)}>
            <SelectTrigger className="h-7 w-[7.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {task.status === "done" && <CheckCircle2 className="size-4 text-emerald-400" />}
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7 opacity-0 transition-opacity group-hover:opacity-100">
                <Pencil className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="size-3.5" /> Delete mission
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const projectId = id as any;

  const data = useQuery(api.projectWorkspace.workspace, id ? { id: projectId } : "skip") as
    | Workspace
    | null
    | undefined;
  const people = useQuery(api.users.listPeopleLite, {});
  // ← → to flip through the active projects.
  const projects = useQuery(api.projects.listProjects, { status: "active" });

  const dismantle = useMutation(api.projects.dismantleProject);
  const complete = useMutation(api.projects.completeProject);
  const reactivate = useMutation(api.projects.reactivateProject);
  const deleteProject = useMutation(api.projects.deleteProject);
  const upsertProject = useMutation(api.projects.upsertProject);

  // Edit-details dialog (admins): name, description and cover image.
  const [editOpen, setEditOpen] = useState(false);
  const [eName, setEName] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eImage, setEImage] = useState("");
  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    try {
      setEImage(await compressImageFile(file, 512));
    } catch {
      toast.error("Could not read that image");
    }
  };

  const addMember = useMutation(api.projectWorkspace.addMember);
  const removeMember = useMutation(api.projectWorkspace.removeMember);
  const setMemberRole = useMutation(api.projectWorkspace.setMemberRole);
  const markMemberEx = useMutation(api.projectWorkspace.markMemberEx);
  const startNewTeam = useMutation(api.projectWorkspace.startNewTeam);
  const setMemberCenter = useMutation(api.projectWorkspace.setMemberCenter);
  const createTask = useMutation(api.projectWorkspace.createTask);
  const updateTask = useMutation(api.projectWorkspace.updateTask);
  const deleteTask = useMutation(api.projectWorkspace.deleteTask);
  const addNote = useMutation(api.projectWorkspace.addNote);
  const deleteNote = useMutation(api.projectWorkspace.deleteNote);

  const [tab, setTab] = useState<string>("readme");
  // Deep link: /projects/:id?tab=… — the Requests console jumps straight to
  // the README (and its review dialog) with ?tab=readme&review=<id>.
  const [sp] = useSearchParams();
  useEffect(() => {
    const t = sp.get("tab");
    if (
      t &&
      t !== tab &&
      (t === "readme" ||
        t === "overview" ||
        t === "workpackages" ||
        (CENTER_KEYS as readonly string[]).includes(t))
    ) {
      setTab(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  const [dismantleOpen, setDismantleOpen] = useState(false);
  const [functional, setFunctional] = useState(true);

  // team dialog
  const [teamOpen, setTeamOpen] = useState(false);
  const [newTeamOpen, setNewTeamOpen] = useState(false);
  const [pickUser, setPickUser] = useState("");
  const [pickCenter, setPickCenter] = useState("");

  // mission dialog
  const [missionOpen, setMissionOpen] = useState(false);
  const [missionCenter, setMissionCenter] = useState<CenterKey>("mechanical");
  const [mTitle, setMTitle] = useState("");
  const [mDetails, setMDetails] = useState("");
  const [mPriority, setMPriority] = useState<Priority>("normal");
  const [mAssignee, setMAssignee] = useState("");
  const [mDue, setMDue] = useState("");
  const [busy, setBusy] = useState(false);

  // note dialog
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteCenter, setNoteCenter] = useState<CenterKey>("references");
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");
  const [nUrl, setNUrl] = useState("");

  const memberPicker = (people ?? []).filter(
    // Ex-members / previous teams can be re-added — they then join the
    // CURRENT team while their old membership row stays in the record.
    (p) => !data?.members.some((m) => m.userId === p._id && !m.leftAt),
  );

  const byCenter = useMemo(() => {
    const map = new Map<string, Workspace["tasks"]>();
    for (const c of CENTER_KEYS) map.set(c, []);
    for (const t of data?.tasks ?? []) {
      (map.get(t.center) ?? map.set(t.center, []).get(t.center)!).push(t);
    }
    return map;
  }, [data?.tasks]);

  const notesByCenter = useMemo(() => {
    const map = new Map<string, Workspace["notes"]>();
    for (const c of CENTER_KEYS) map.set(c, []);
    for (const n of data?.notes ?? []) {
      (map.get(n.center) ?? map.set(n.center, []).get(n.center)!).push(n);
    }
    return map;
  }, [data?.notes]);

  if (data === undefined) {
    return (
      <AppShell>
        <LoadingGif size={48} label={null} />
      </AppShell>
    );
  }
  if (data === null || data.project === null) {
    return (
      <AppShell>
        <p className="py-16 text-center text-sm text-muted-foreground">Project not found.</p>
      </AppShell>
    );
  }

  const { project, members, parts, stats, me } = data;
  const isLeader = me.myRole === "leader";
  const canManage = me.canManage;
  const canContribute = canManage || me.isMember;
  // Team epochs: the CURRENT team is every active row; everyone else stays
  // visible in the record with an “ex-member” / “previous team” badge.
  const teamNo = (project.teamNo as number | undefined) ?? 1;
  const currentMembers = members.filter((m) => !m.leftAt);
  const historyMembers = members.filter((m) => m.leftAt);

  const resetMission = () => {
    setMTitle("");
    setMDetails("");
    setMPriority("normal");
    setMAssignee("");
    setMDue("");
  };

  const submitMission = async () => {
    setBusy(true);
    try {
      await createTask({
        projectId,
        center: missionCenter,
        title: mTitle,
        details: mDetails.trim() || undefined,
        priority: mPriority,
        assigneeId: mAssignee ? (mAssignee as any) : undefined,
        dueAt: mDue ? new Date(mDue).getTime() : undefined,
      });
      toast.success("Mission added" + (mAssignee ? " — the assignee was notified" : ""));
      setMissionOpen(false);
      resetMission();
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitNote = async () => {
    setBusy(true);
    try {
      await addNote({
        projectId,
        center: noteCenter,
        title: nTitle,
        body: nBody.trim() || undefined,
        url: nUrl.trim() || undefined,
      });
      toast.success("Saved to the center");
      setNoteOpen(false);
      setNTitle("");
      setNBody("");
      setNUrl("");
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const teamMemberPicker = () => (
    <Select value={pickUser} onValueChange={setPickUser}>
      <SelectTrigger>
        <SelectValue placeholder="Pick a person…" />
      </SelectTrigger>
      <SelectContent>
        {memberPicker.map((p) => (
          <SelectItem key={p._id} value={p._id}>
            {p.name ?? p.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const assigneePicker = (value: string, onChange: (v: string) => void) => (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Unassigned</SelectItem>
        {currentMembers.map((m) => (
          <SelectItem key={m.userId} value={m.userId}>
            {m.user.name ?? m.user.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <AppShell>
      <NavArrows
        items={(projects ?? []).map((p) => p._id)}
        currentId={projectId}
        onNavigate={(nid) => navigate(`/projects/${nid}`)}
      />
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/projects")}>
            <ArrowLeft className="size-4" /> Projects
          </Button>
        </div>

        {/* Header */}
        <header className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-end">
          <div className="flex items-start gap-3">
            <QrChip payload={projectQr(project._id)} label={project.name} />
            {project.imageUrl && (
              <img
                src={project.imageUrl}
                alt={project.name}
                className="size-16 shrink-0 glass-3d rounded-md border object-cover"
              />
            )}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {project.description ?? "Club project"}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={project.status} />
                {isLeader && (
                  <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                    <UserCog className="size-3" /> You lead this team
                  </span>
                )}
              </div>
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEName(project.name);
                  setEDesc(project.description ?? "");
                  setEImage(project.imageUrl ?? "");
                  setEditOpen(true);
                }}
              >
                <Pencil className="size-4" /> Edit details
              </Button>
              {project.status === "active" ? (
                <>
                  <Button variant="outline" onClick={async () => {
                    try { await complete({ id: project._id }); toast.success("Marked completed"); }
                    catch (e) { toast.error(asMessage(e)); }
                  }}>
                    Mark completed
                  </Button>
                  <Button variant="outline" className="text-destructive" onClick={() => setDismantleOpen(true)}>
                    <PackageX className="size-4" /> Dismantle
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={async () => {
                    try { await reactivate({ id: project._id }); toast.success("Project reactivated"); }
                    catch (e) { toast.error(asMessage(e)); }
                  }}>
                    <RotateCcw className="size-4" /> Reactivate
                  </Button>
                  <Button variant="outline" className="text-destructive" onClick={async () => {
                    try { await deleteProject({ id: project._id }); toast.success("Project deleted"); navigate("/projects"); }
                    catch (e) { toast.error(asMessage(e)); }
                  }}>
                    <Trash2 className="size-4" /> Delete record
                  </Button>
                </>
              )}
            </div>
          )}
        </header>

          {/* Tabs — wrap onto rows as the screen narrows; every trigger keeps
              the width of its own text, and the active one depresses like a
              key (3D style, .tabs-3d in index.css). */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="tabs-3d colored-tabs flex h-auto max-w-full flex-wrap justify-start gap-1.5 p-1">
              <TabsTrigger value="readme" className="flex-none gap-1.5" style={tStyle("readme")}>
                <BookOpen className="size-3.5" /> README
              </TabsTrigger>
              <TabsTrigger value="workpackages" className="flex-none gap-1.5" style={tStyle("workpackages")}>
                <Layers className="size-3.5" /> Work packages
              </TabsTrigger>
              <TabsTrigger value="overview" className="flex-none" style={tStyle("overview")}>
                Overview
              </TabsTrigger>
              {CENTER_KEYS.map((c) => (
                <TabsTrigger key={c} value={c} className="flex-none gap-1.5" style={tStyle(c)}>
                  {CENTER_META[c].icon} {CENTER_META[c].label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ===== README (GitHub-style project front page) ===== */}
            <div className={tab !== "readme" ? "hidden" : "mt-6"}>
              <ProjectReadmeTab projectId={projectId} projectName={project.name} />
            </div>

            {/* ===== Work packages (OpenProject-style tracking plane) ===== */}
            <div className={tab !== "workpackages" ? "hidden" : "mt-6"}>
              <ProjectWorkPackages
                projectId={projectId}
                members={currentMembers.map((m) => ({ userId: m.userId, user: m.user }))}
              />
            </div>

          {/* ===== Overview ===== */}
          <div className={tab !== "overview" ? "hidden" : "mt-6 grid gap-6 lg:grid-cols-3"}>
            <div className="flex flex-col gap-6 lg:col-span-2">
              {/* progress */}
              <section className="glass-3d rounded-lg border p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <Ring pct={stats.progressPct} label="complete" sub={`${stats.done}/${stats.taskTotal} missions done`} />
                  <div className="flex flex-wrap gap-2">
                    {(["todo", "doing", "review", "done"] as TaskStatus[]).map((s) => (
                      <div key={s} className="glass-3d rounded-lg border px-3 py-2 text-center">
                        <p className="text-lg font-bold leading-none">{stats[s]}</p>
                        <p className="text-[11px] text-muted-foreground">{STATUS_META[s].label}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 grid gap-2">
                  {stats.perCenter.filter((pc) => pc.total > 0).map((pc) => (
                    <div key={pc.center} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-xs text-muted-foreground">
                        {CENTER_META[pc.center as CenterKey].icon} {CENTER_META[pc.center as CenterKey].label}
                      </span>
                      <Progress value={pc.pct} className="h-1.5 flex-1" />
                      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pc.pct}%</span>
                    </div>
                  ))}
                  {stats.perCenter.every((pc) => pc.total === 0) && (
                    <p className="text-xs text-muted-foreground">
                      No missions yet — open a center below and assign the first one.
                    </p>
                  )}
                </div>
              </section>

              {/* team */}
              <section className="glass-3d rounded-lg border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Users className="size-4" /> Team · {currentMembers.length}
                    {historyMembers.length > 0 && (
                      <span className="text-xs font-normal text-muted-foreground">
                        ({historyMembers.length} in history)
                      </span>
                    )}
                  </h2>
                  {canManage && project.status === "active" && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setNewTeamOpen(true)}>
                        <RefreshCw className="size-3.5" /> New team
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setTeamOpen(true)}>
                        <UserPlus className="size-3.5" /> Add people
                      </Button>
                    </div>
                  )}
                </div>
                {members.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    No one assigned yet. Add the team leader and contributors.
                  </p>
                ) : (
                  <>
                    <ul className="divide-y">
                    {currentMembers.map((m) => {
                      const leader = m.role === "leader";
                      const openTasks = data.tasks.filter(
                        (t) => t.assigneeId === m.userId && t.status !== "done",
                      ).length;
                      return (
                        <li key={m._id} className="group flex items-center gap-3 px-5 py-3">
                          <Avatar className="size-8">
                            <AvatarImage src={m.user.image} />
                            <AvatarFallback className="text-xs">
                              {(m.user.name ?? m.user.email ?? "?").slice(0, 1).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {m.user.name ?? m.user.email}
                              {m.userId === me.userId && (
                                <span className="text-xs text-muted-foreground"> (you)</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {leader ? "Team leader" : m.center ? `${m.center} center` : "Contributor"}
                              {openTasks > 0 && ` · ${openTasks} open mission${openTasks === 1 ? "" : "s"}`}
                            </p>
                          </div>
                          {leader && (
                            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                              Leader
                            </span>
                          )}
                          {canManage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-7 opacity-0 transition-opacity group-hover:opacity-100">
                                  <UserCog className="size-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {!leader && isAdmin && (
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      try {
                                        await setMemberRole({ projectId, userId: m.userId as any, role: "leader" });
                                        toast.success(`${m.user.name ?? "Member"} is now the team leader`);
                                      } catch (e) { toast.error(asMessage(e)); }
                                    }}
                                  >
                                    <UserCog className="size-3.5" /> Make team leader
                                  </DropdownMenuItem>
                                )}
                                {leader && isAdmin && (
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      try {
                                        await setMemberRole({ projectId, userId: m.userId as any, role: "member" });
                                        toast.success(`${m.user.name ?? "Member"} is no longer the team leader`);
                                      } catch (e) { toast.error(asMessage(e)); }
                                    }}
                                  >
                                    <UserCog className="size-3.5" /> Remove leader
                                  </DropdownMenuItem>
                                )}
                                {(isAdmin || !leader) && (
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      try {
                                        await markMemberEx({ projectId, userId: m.userId as any });
                                        toast.success("Marked as ex-member — kept in the project record");
                                      } catch (e) { toast.error(asMessage(e)); }
                                    }}
                                  >
                                    <UserMinus className="size-3.5" /> Mark as ex-member
                                  </DropdownMenuItem>
                                )}
                                {(isAdmin || !leader) && (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={async () => {
                                      try {
                                        await removeMember({ projectId, userId: m.userId as any });
                                        toast.success("Removed from the team");
                                      } catch (e) { toast.error(asMessage(e)); }
                                    }}
                                  >
                                    <Trash2 className="size-3.5" /> Remove from team
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </li>
                      );
                    })}
                    </ul>
                    {historyMembers.length > 0 && (
                      <div className="border-t bg-muted/30 px-5 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                          History — previous teams &amp; ex-members
                        </p>
                      </div>
                    )}
                    {historyMembers.length > 0 && (
                      <ul className="divide-y opacity-80">
                        {historyMembers.map((m) => {
                          const prevTeam = (m.team ?? 1) < teamNo;
                          return (
                            <li key={m._id} className="flex items-center gap-3 px-5 py-3">
                              <Avatar className="size-8">
                                <AvatarImage src={m.user.image} />
                                <AvatarFallback className="text-xs">
                                  {(m.user.name ?? m.user.email ?? "?").slice(0, 1).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">
                                  {m.user.name ?? m.user.email}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {m.role === "leader"
                                    ? "Was team leader"
                                    : m.center
                                      ? `${m.center} center`
                                      : "Contributor"}
                                </p>
                              </div>
                              {prevTeam ? (
                                <span className="rounded-full border border-slate-400/40 bg-slate-400/10 px-2 py-0.5 text-[10px] text-slate-300">
                                  Previous team
                                </span>
                              ) : (
                                <span className="rounded-full border border-zinc-400/40 bg-zinc-400/10 px-2 py-0.5 text-[10px] text-zinc-300">
                                  Ex-member
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </section>
            </div>

            {/* side column: inventory snapshot */}
            <div className="flex flex-col gap-6">
              <section className="glass-3d rounded-lg border">
                <div className="border-b px-5 py-3">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    📦 Inventory · {parts.length} part{parts.length === 1 ? "" : "s"} checked out
                  </h2>
                </div>
                {parts.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    Nothing checked out. Rent parts and return them "to this project".
                  </p>
                ) : (
                  <ul className="max-h-72 divide-y overflow-y-auto">
                    {parts.slice(0, 20).map(({ part, groupName }) => (
                      <li key={part._id} className="px-5 py-2.5">
                        <Link to={`/part/${part._id}`} className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm">{groupName}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">{part.tag}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <p className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
                Team changes here stay in the project record — missions, notes and README history
                keep every contributor's name for the archive.
              </p>

              {/* ===== New team confirm ===== */}
              <Dialog open={newTeamOpen} onOpenChange={setNewTeamOpen}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Start a new team?</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">
                    Every current member becomes the <b>previous team</b> — kept in the record
                    with their own badge, and every mission, note and README edit stays exactly
                    as it is. Add the new members right after.
                  </p>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setNewTeamOpen(false)}>Cancel</Button>
                    <Button
                      onClick={async () => {
                        try {
                          await startNewTeam({ projectId });
                          setNewTeamOpen(false);
                          toast.success("New team started — the previous team is now history");
                        } catch (e) { toast.error(asMessage(e)); }
                      }}
                    >
                      <RefreshCw className="size-4" /> Start new team
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* ===== Center tabs ===== */}
          {CENTER_KEYS.map((c) => {
            const meta = CENTER_META[c];
            const tasks = byCenter.get(c) ?? [];
            const notes = notesByCenter.get(c) ?? [];
            const pc = stats.perCenter.find((x) => x.center === c);
            const isInventoryCenter = c === "inventory";
            return (
              <div key={c} className={tab !== c ? "hidden" : "mt-6 flex flex-col gap-5"}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className={`text-lg font-semibold ${meta.color}`}>
                      {meta.icon} {meta.label}
                    </h2>
                    <p className="text-xs text-muted-foreground">{meta.blurb}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {pc && pc.total > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {pc.done}/{pc.total} done · {pc.pct}%
                      </span>
                    )}
                    {canManage && !isInventoryCenter && (
                      <Button size="sm" onClick={() => { setMissionCenter(c); setMissionOpen(true); }}>
                        <Plus className="size-3.5" /> Mission
                      </Button>
                    )}
                    {canContribute && (
                      <Button size="sm" variant="outline" onClick={() => { setNoteCenter(c); setNoteOpen(true); }}>
                        <Plus className="size-3.5" /> Note
                      </Button>
                    )}
                  </div>
                </div>

                {/* Inventory center shows checked-out parts instead of missions */}
                {isInventoryCenter ? (
                  <section className="glass-3d rounded-lg border">
                    {parts.length === 0 ? (
                      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                        No parts checked out to this project.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {parts.map(({ part, groupName }) => (
                          <li key={part._id} className="flex items-center gap-3 px-4 py-3">
                            <QrChip payload={unitQr(part.tag)} label={`${groupName} · ${part.tag}`} />
                            <Link to={`/part/${part._id}`} className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{groupName}</p>
                              <p className="font-mono text-xs text-muted-foreground">{part.tag}</p>
                            </Link>
                            {part.note && (
                              <p className="hidden max-w-48 truncate text-xs text-muted-foreground sm:block">
                                {part.note}
                              </p>
                            )}
                            <StatusBadge status={part.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : (
                  <section className="glass-3d rounded-lg border">
                    <div className="flex items-center gap-2 border-b px-4 py-2.5">
                      <ClipboardList className="size-4" />
                      <h3 className="text-sm font-semibold">Missions · {tasks.length}</h3>
                    </div>
                    {tasks.length === 0 ? (
                      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                        {canManage
                          ? "No missions yet — assign the first one."
                          : "No missions in this center yet."}
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {tasks.map((t) => (
                          <MissionRow
                            key={t._id}
                            task={t}
                            canManage={canManage}
                            isAssignee={t.assigneeId === me.userId}
                            onStatus={async (s) => {
                              try {
                                await updateTask({ taskId: t._id as any, status: s });
                                if (s === "done") toast.success("Mission completed 🎉");
                              } catch (e) {
                                toast.error(asMessage(e));
                              }
                            }}
                            onDelete={async () => {
                              try {
                                await deleteTask({ taskId: t._id as any });
                                toast.success("Mission deleted");
                              } catch (e) {
                                toast.error(asMessage(e));
                              }
                            }}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                )}

                {/* Notes in every center */}
                <section className="glass-3d rounded-lg border">
                  <div className="flex items-center gap-2 border-b px-4 py-2.5">
                    <BookOpen className="size-4" />
                    <h3 className="text-sm font-semibold">Notes &amp; references · {notes.length}</h3>
                  </div>
                  {notes.length === 0 ? (
                    <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                      Nothing pinned yet.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {notes.map((n) => (
                        <li key={n._id} className="group flex items-start gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            {n.url ? (
                              <a
                                href={n.url}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate text-sm font-medium text-primary hover:underline"
                              >
                                {n.title} ↗
                              </a>
                            ) : (
                              <p className="truncate text-sm font-medium">{n.title}</p>
                            )}
                            {n.body && (
                              <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
                                {n.body}
                              </p>
                            )}
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {n.creatorName ?? "Member"} · {new Date(n.createdAt).toLocaleDateString("en-GB")}
                            </p>
                          </div>
                          {(canManage || n.createdBy === me.userId) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 opacity-0 transition-opacity group-hover:opacity-100"
                              onClick={async () => {
                                try {
                                  await deleteNote({ noteId: n._id as any });
                                  toast.success("Note removed");
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
                </section>
              </div>
            );
          })}
        </Tabs>

        {/* ===== Add people dialog ===== */}
        <Dialog open={teamOpen} onOpenChange={setTeamOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add people to “{project.name}”</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              {teamMemberPicker()}
              <Select value={pickCenter || undefined} onValueChange={setPickCenter}>
                <SelectTrigger>
                  <SelectValue placeholder="Center (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No center</SelectItem>
                  {(["mechanical", "electrical", "programming", "inventory"] as const).map((c) => (
                    <SelectItem key={c} value={c}>{CENTER_META[c].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentMembers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Tip: add the team leader first, then use their card menu → “Make team leader”.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTeamOpen(false)}>Cancel</Button>
              <Button
                disabled={!pickUser || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await addMember({
                      projectId,
                      userId: pickUser as any,
                      center: pickCenter === "none" || !pickCenter ? undefined : (pickCenter as any),
                    });
                    toast.success("Added to the team — they were notified");
                    setPickUser("");
                    setPickCenter("");
                  } catch (e) {
                    toast.error(asMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <UserPlus className="size-4" /> Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== New mission dialog ===== */}
        <Dialog open={missionOpen} onOpenChange={setMissionOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New mission — {CENTER_META[missionCenter].label}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>Title</Label>
                <Input value={mTitle} onChange={(e) => setMTitle(e.target.value)} placeholder="Design the intake mechanism" />
              </div>
              <div className="grid gap-2">
                <Label>Details</Label>
                <Textarea value={mDetails} onChange={(e) => setMDetails(e.target.value)} rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Priority</Label>
                  <Select value={mPriority} onValueChange={(v) => setMPriority(v as Priority)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>{PRIORITY_META[p].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Due date</Label>
                  <Input type="date" value={mDue} onChange={(e) => setMDue(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Assign to</Label>
                {assigneePicker(mAssignee, (v) => setMAssignee(v === "none" ? "" : v))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMissionOpen(false)}>Cancel</Button>
              <Button onClick={submitMission} disabled={busy || mTitle.trim().length < 2}>
                {busy ? "Adding…" : "Add mission"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== New note dialog ===== */}
        <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add to {CENTER_META[noteCenter].label}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>Title</Label>
                <Input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="Motor datasheet / design decision" />
              </div>
              <div className="grid gap-2">
                <Label>Link (optional)</Label>
                <Input value={nUrl} onChange={(e) => setNUrl(e.target.value)} placeholder="https://…" />
              </div>
              <div className="grid gap-2">
                <Label>Notes</Label>
                <Textarea value={nBody} onChange={(e) => setNBody(e.target.value)} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNoteOpen(false)}>Cancel</Button>
              <Button onClick={submitNote} disabled={busy || nTitle.trim().length < 2}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Edit details dialog ===== */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit project details</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>Cover image</Label>
                <div className="flex items-center gap-3">
                  {eImage ? (
                    <img src={eImage} alt="Cover" className="size-16 glass-3d rounded-md border object-cover" />
                  ) : (
                    <div className="flex size-16 items-center justify-center glass-3d rounded-md border border-dashed text-xs text-muted-foreground">
                      none
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void pickCover(e.target.files?.[0])}
                      className="h-9 text-xs"
                    />
                    {eImage && (
                      <Button variant="ghost" size="sm" className="h-7 self-start text-xs" onClick={() => setEImage("")}>
                        Remove image
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input value={eName} onChange={(e) => setEName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                disabled={busy || eName.trim().length < 2}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await upsertProject({
                      id: project._id,
                      name: eName.trim(),
                      description: eDesc.trim() || undefined,
                      status: project.status,
                      imageUrl: eImage.trim(), // "" clears
                    });
                    toast.success("Project updated");
                    setEditOpen(false);
                  } catch (e) {
                    toast.error(asMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ===== Dismantle dialog ===== */}
        <Dialog open={dismantleOpen} onOpenChange={setDismantleOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Dismantle “{project.name}”?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              All {parts.length} checked-out part{parts.length === 1 ? "" : "s"} will be released back
              to the inventory. This cannot be undone.
            </p>
            <div className="grid gap-2">
              <Label>Condition of parts</Label>
              <div className="flex gap-2">
                {(["ok", "broken"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setFunctional(v === "ok")}
                    className={`flex-1 rounded-lg border p-3 text-sm transition-colors ${
                      functional === (v === "ok") ? "border-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {v === "ok" ? "Working — back to shelf" : "Broken — repair pile"}
                  </button>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDismantleOpen(false)}>Cancel</Button>
              <Button
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await dismantle({ id: project._id, functional });
                    toast.success("Project dismantled — parts released");
                    setDismantleOpen(false);
                  } catch (e) {
                    toast.error(asMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Dismantle project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
