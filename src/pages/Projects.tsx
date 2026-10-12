import { useState } from "react";
import { Link } from "react-router";
import { useMutation } from "convex/react";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { LoadingGif } from "@/components/LoadingGif";
import { QrChip } from "@/components/QrChip";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { projectQr } from "@/lib/qr";
import { compressImageFile } from "@/lib/utils";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { Boxes, FolderKanban, Pencil, Plus } from "lucide-react";

type ProjectRow = { _id: string; name: string; description?: string; imageUrl?: string; status: string };

export default function Projects() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Each project carries the count of inventory parts currently checked out.
  const rows = useQuery(api.projects.listProjectsWithCounts, {});
  const upsert = useMutation(api.projects.upsertProject);
  const [open, setOpen] = useState(false);
  // Edit state: which project is being edited (null = creating).
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const active = (rows ?? []).filter((r) => r.project.status === "active");
  const past = (rows ?? []).filter((r) => r.project.status !== "active");

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setImageUrl("");
    setOpen(true);
  };

  const openEdit = (p: ProjectRow) => {
    setEditing(p);
    setName(p.name);
    setDescription(p.description ?? "");
    setImageUrl(p.imageUrl ?? "");
    setOpen(true);
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImageUrl(await compressImageFile(file, 512));
    } catch {
      toast.error("Could not read that image");
    }
  };

  const submit = async () => {
    if (!name.trim()) return;
    const cover = imageUrl.trim();
    if (cover && !/^(https?:\/\/|data:image\/)/i.test(cover)) {
      toast.error("Cover image must be an image URL (https://…) or a chosen file");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await upsert({
          id: editing._id as never,
          name: name.trim(),
          description: description.trim() || undefined,
          status: editing.status as "active",
          imageUrl: cover, // "" clears
        });
        toast.success("Project updated");
      } else {
        await upsert({
          name: name.trim(),
          description: description.trim() || undefined,
          status: "active",
          imageUrl: cover || undefined,
        });
        toast.success("Project created");
      }
      setOpen(false);
      setName("");
      setDescription("");
      setImageUrl("");
      setEditing(null);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col justify-between gap-4 wide:flex-row wide:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A project is a place inventory can be checked out to. Parts stay assigned until the
              project is dismantled.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={openCreate}>
              <Plus className="size-4" /> New project
            </Button>
          )}
        </header>

        {rows === undefined ? (
          <LoadingGif size={48} label={null} />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {active.map(({ project: p, partCount }) => (
                <Card
                  key={p._id}
                  className="group relative overflow-hidden border-border/80 shadow-none transition-colors hover:border-primary/40"
                >
                  {p.imageUrl && (
                    <Link to={`/projects/${p._id}`} className="block">
                      {/* Fixed-height image area (the card never changes
                          size); the picture fits by its longest side —
                          contain, never stretched or cropped. */}
                      <div className="flex h-32 w-full items-center justify-center border-b border-border/60 bg-muted/30">
                        <img src={p.imageUrl} alt={p.name} className="h-full w-full object-contain" />
                      </div>
                    </Link>
                  )}
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <Link to={`/projects/${p._id}`} className="min-w-0 flex-1">
                        <p className="truncate text-base font-semibold">{p.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {p.description ?? "Club project"}
                        </p>
                      </Link>
                      <div className="flex shrink-0 items-center gap-1">
                        <QrChip payload={projectQr(p._id)} label={p.name} />
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Edit project"
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={p.status} />
                      <span className="flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                        <Boxes className="size-3" /> {partCount} part{partCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {active.length === 0 && (
                <div className="col-span-full flex flex-col items-center gap-2 glass-3d rounded-lg border border-dashed px-6 py-12 text-center">
                  <FolderKanban className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No active projects yet.</p>
                  {isAdmin && (
                    <Button size="sm" variant="outline" onClick={openCreate}>
                      <Plus className="size-3.5" /> Create the first one
                    </Button>
                  )}
                </div>
              )}
            </section>

            {past.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">Completed &amp; dismantled</h2>
                <ul className="divide-y glass-3d rounded-lg border">
                  {past.map(({ project: p, partCount }) => (
                    <li key={p._id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <Link to={`/projects/${p._id}`} className="truncate text-sm font-medium">
                        {p.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {partCount} part{partCount === 1 ? "" : "s"}
                        </span>
                        <StatusBadge status={p.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>Cover image</Label>
                <div className="flex items-center gap-3">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
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
                      onChange={(e) => void pickImage(e.target.files?.[0])}
                      className="h-9 text-xs"
                    />
                    <Input
                      value={imageUrl.startsWith("data:") ? "" : imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      placeholder={
                        imageUrl.startsWith("data:")
                          ? "Image chosen from file"
                          : "…or paste an image URL"
                      }
                      className="h-9 text-xs"
                      inputMode="url"
                    />
                    {imageUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 self-start text-xs"
                        onClick={() => setImageUrl("")}
                      >
                        Remove image
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Line Follower 2026"
                />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !name.trim()}>
                {busy ? "Saving…" : editing ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}
