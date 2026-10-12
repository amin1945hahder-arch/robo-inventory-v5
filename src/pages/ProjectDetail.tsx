import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { LoadingGif } from "@/components/LoadingGif";
import { NavArrows } from "@/components/NavArrows";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { projectQr, unitQr } from "@/lib/qr";
import { compressImageFile } from "@/lib/utils";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import {
  ArrowLeft,
  Boxes,
  PackageX,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

/**
 * A project is now just a holding place for inventory: the parts checked out
 * to it. The old workspace (team, missions, notes, README, work packages) was
 * removed along with its tables — assignments are made from the Inventory side
 * (a unit's page or the return flow), so this page is read-only.
 */
export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const projectId = id as never;

  const data = useQuery(api.projects.getProject, id ? { id: projectId } : "skip");
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
  const [busy, setBusy] = useState(false);

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    try {
      setEImage(await compressImageFile(file, 512));
    } catch {
      toast.error("Could not read that image");
    }
  };

  const [dismantleOpen, setDismantleOpen] = useState(false);
  const [functional, setFunctional] = useState(true);

  if (data === undefined) {
    return (
      <AppShell>
        <LoadingGif size={48} label={null} />
      </AppShell>
    );
  }
  if (data === null) {
    return (
      <AppShell>
        <p className="py-16 text-center text-sm text-muted-foreground">Project not found.</p>
      </AppShell>
    );
  }

  const { project, parts } = data;

  return (
    <AppShell>
      <NavArrows
        items={(projects ?? []).map((p) => p._id)}
        currentId={id}
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
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                  {parts.length} part{parts.length === 1 ? "" : "s"} checked out
                </span>
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
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await complete({ id: project._id });
                        toast.success("Marked completed");
                      } catch (e) {
                        toast.error(asMessage(e));
                      }
                    }}
                  >
                    Mark completed
                  </Button>
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setDismantleOpen(true)}
                  >
                    <PackageX className="size-4" /> Dismantle
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        await reactivate({ id: project._id });
                        toast.success("Project reactivated");
                      } catch (e) {
                        toast.error(asMessage(e));
                      }
                    }}
                  >
                    <RotateCcw className="size-4" /> Reactivate
                  </Button>
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={async () => {
                      try {
                        await deleteProject({ id: project._id });
                        toast.success("Project deleted");
                        navigate("/projects");
                      } catch (e) {
                        toast.error(asMessage(e));
                      }
                    }}
                  >
                    <Trash2 className="size-4" /> Delete record
                  </Button>
                </>
              )}
            </div>
          )}
        </header>

        {/* ===== Inventory ===== */}
        <section className="glass-3d rounded-lg border">
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
            <Boxes className="size-4 text-cyan-400" />
            <h2 className="text-sm font-semibold">Inventory · {parts.length}</h2>
            <p className="text-xs text-muted-foreground">
              Parts checked out to this project stay here until it is dismantled.
            </p>
          </div>

          {parts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <Boxes className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No parts checked out to this project.
              </p>
              <Button size="sm" variant="outline" asChild>
                <Link to="/inventory">
                  <Plus className="size-3.5" /> Assign from inventory
                </Link>
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {parts.map(({ part, group }) => (
                <li key={part._id} className="flex items-center gap-3 px-5 py-3">
                  <QrChip payload={unitQr(part.tag)} label={`${group?.name ?? "Part"} · ${part.tag}`} />
                  <Link to={`/part/${part._id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{group?.name ?? "Part"}</p>
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
      </div>

      {/* ===== Edit details dialog ===== */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Cover image</Label>
              <div className="flex items-center gap-3">
                {eImage ? (
                  <img
                    src={eImage}
                    alt="Cover"
                    className="size-16 glass-3d rounded-md border object-contain bg-muted/30"
                  />
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 self-start text-xs"
                      onClick={() => setEImage("")}
                    >
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
              <Textarea value={eDesc} onChange={(e) => setEDesc(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !eName.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await upsertProject({
                    id: project._id,
                    name: eName.trim(),
                    description: eDesc.trim() || undefined,
                    status: project.status,
                    imageUrl: eImage, // "" clears
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
              {busy ? "Saving…" : "Save changes"}
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
            Every part checked out to this project is released back to the shelf and the project is
            marked dismantled.
          </p>
          <div className="grid gap-2">
            <Label>Released parts are…</Label>
            <div className="flex gap-2">
              <Button
                variant={functional ? "default" : "outline"}
                size="sm"
                onClick={() => setFunctional(true)}
              >
                Functional
              </Button>
              <Button
                variant={!functional ? "default" : "outline"}
                size="sm"
                onClick={() => setFunctional(false)}
              >
                Broken
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismantleOpen(false)}>
              Cancel
            </Button>
            <Button
              className="text-destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await dismantle({ id: project._id, functional });
                  toast.success("Project dismantled — its parts are back on the shelf");
                  setDismantleOpen(false);
                } catch (e) {
                  toast.error(asMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <PackageX className="size-4" /> Dismantle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
