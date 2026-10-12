import { useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useOfflineQuery as useQuery } from "@/hooks/use-offline-query";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { tabColor } from "@/lib/utils";

// Each subtab fills with its OWN color when active (Settings-bar treatment).
const TAB_COLORS: Record<string, string> = {
  info: "#38bdf8",
  records: "#fbbf24",
  positions: "#a78bfa",
};
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BadgeCheck, IdCard, Pencil, UserRound } from "lucide-react";
import { PersonBadgeDialog } from "@/components/PersonBadgeDialog";
import QRCodeReact from "react-qr-code";
import { qrUrl, personQr } from "@/lib/qr";

const fmt = (n?: number) => (n ? new Date(n).toLocaleString() : "—");

type PersonCardData = {
  person: any;
  canSeeHistory: boolean;
  isSelf: boolean;
  viewerIsAdmin: boolean;
  rentals: any[];
};

/** Person profile — opened by scanning a person QR label (person:<id>) or via
 *  "view profile" on the scan popup. Structured tabs: info, lend records,
 *  positions. Self and admins see everything; other members get a limited
 *  public view. */
export default function PersonCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const card = useQuery(api.users.getPersonCard, id ? { userId: id as any } : "skip") as
    | PersonCardData
    | null
    | undefined;

  const [badgeOpen, setBadgeOpen] = useState(false);
  // Arrived from a fresh QR scan (?scan=1): show the action popup first,
  // "View profile" reveals the full tabbed profile.
  const [params] = useSearchParams();
  const [scanPopup, setScanPopup] = useState(params.get("scan") === "1");

  if (card === undefined) {
    return (
      <AppShell>
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <LoadingGifInline size={18} className="size-4" /> Loading…
        </p>
      </AppShell>
    );
  }

  if (card === null || !card.person) {
    return (
      <AppShell>
        <div className="mx-auto mt-16 max-w-md glass-3d rounded-lg border border-dashed p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/40">
            <UserRound className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm font-medium">Person not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This QR belongs to someone who is no longer in the club, or to a guest session.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </AppShell>
    );
  }

  const p = card.person;
  const viewerIsAdmin = card.viewerIsAdmin;
  const isSelf = card.isSelf;
  const fullView = card.canSeeHistory;

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Member profile</h1>
            <p className="mt-1 text-sm text-muted-foreground">Scanned person QR</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Done
          </Button>
        </header>

        {/* Identity header (always visible above the tabs) */}
        <section className="glass-3d flex flex-wrap items-center gap-4 rounded-lg p-5">
          <Avatar className="size-16 shrink-0 border">
            <AvatarImage src={p.image} />
            <AvatarFallback className="text-lg">
              {(p.name ?? p.email ?? "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {/* The person's own QR — always visible next to the photo. Scanning
              it opens this same profile (with the chat/profile popup). */}
          <div className="flex shrink-0 flex-col items-center gap-1 glass-3d rounded-lg border bg-white p-1.5">
            <QRCodeReact
              value={qrUrl(personQr(p._id))}
              size={64}
              style={{ height: "auto", maxWidth: "100%" }}
            />
            <span className="font-mono text-[8px] text-neutral-500">scan profile</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-snug">{p.name ?? "Unnamed member"}</p>
            <p className="break-all text-xs text-muted-foreground">{p.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {p.role === "admin" && (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  Admin
                </span>
              )}
              {p.role === "student" && (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                  Student
                </span>
              )}
              {p.role === "member" && p.profileApproved === true && (
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                  Approved member
                </span>
              )}
              {p.membershipStatus === "ex" && (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                  Ex-member
                </span>
              )}
              {(p.clubRoles ?? []).map((r: string) => (
                <span
                  key={r}
                  className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
          {/* Print me: the badge with every info + the person QR. */}
          <Button variant="outline" onClick={() => setBadgeOpen(true)}>
            <IdCard className="size-4" /> Badge card
          </Button>
        </section>

        {/* Structured profile — everything of this person, per tab. */}
        <Tabs defaultValue="info">
          <TabsList className="colored-tabs flex w-full flex-wrap">
            <TabsTrigger value="info" style={tabColor(TAB_COLORS.info)}>Info</TabsTrigger>
            {fullView && (
              <TabsTrigger value="records" style={tabColor(TAB_COLORS.records)}>
                Lend records
              </TabsTrigger>
            )}
            {fullView && (
              <TabsTrigger value="positions" style={tabColor(TAB_COLORS.positions)}>
                Positions
              </TabsTrigger>
            )}
          </TabsList>

          {/* ---- Info ---- */}
          <TabsContent value="info" className="mt-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {p.studentId && (
                <div className="glass-3d rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Student ID</p>
                  <p className="mt-0.5 font-medium">{p.studentId}</p>
                </div>
              )}
              {p.studentCode && (
                <div className="glass-3d rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Club code</p>
                  <p className="mt-0.5 font-mono">{p.studentCode}</p>
                </div>
              )}
              {p.phone && (
                <div className="glass-3d rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p className="mt-0.5 font-medium">{p.phone}</p>
                </div>
              )}
              {p.telegramUsername && (
                <div className="glass-3d rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Telegram</p>
                  <p className="mt-0.5 font-medium">@{p.telegramUsername}</p>
                </div>
              )}
              {p.githubUrl && (
                <div className="glass-3d rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">GitHub</p>
                  <a
                    href={p.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 block truncate font-medium text-primary hover:underline"
                  >
                    {p.githubUrl.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                </div>
              )}
              {p.dateOfBirth && (
                <div className="glass-3d rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Age</p>
                  <p className="mt-0.5 font-medium">
                    {Math.floor((Date.now() - new Date(p.dateOfBirth).getTime()) / 3.15576e10)} yrs
                  </p>
                </div>
              )}
              {p.academicState && (
                <div className="glass-3d rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Academic state</p>
                  <p className="mt-0.5 font-medium">{p.academicState}</p>
                </div>
              )}
              {p.major && (
                <div className="glass-3d rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Major</p>
                  <p className="mt-0.5 font-medium">{p.major}</p>
                </div>
              )}
              {p.printerRole && (
                <div className="glass-3d rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Printer access</p>
                  <p className="mt-0.5 font-medium">Granted</p>
                </div>
              )}
            </div>
            {!fullView && (
              <p className="mt-3 rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
                Records and projects are visible to the member and to admins only.
              </p>
            )}
          </TabsContent>

          {/* ---- Lend records ---- */}
          {fullView && (
            <TabsContent value="records" className="mt-4">
              {card.rentals.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  No rentals yet.
                </p>
              ) : (
                <ul className="divide-y glass-3d rounded-lg border text-sm">
                  {card.rentals.map((r: any) => (
                    <li key={r._id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {r.groupName}{" "}
                          <span className="font-mono text-xs text-muted-foreground">
                            ({r.partTag})
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmt(r.requestedAt)}
                          {r.returnedAt ? ` · returned ${fmt(r.returnedAt)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.partId && (
                          <Link
                            to={`/part/${r.partId}`}
                            className="text-xs text-primary hover:underline"
                          >
                            Unit
                          </Link>
                        )}
                        <StatusBadge status={r.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          )}

          {/* ---- Positions ---- */}
          {fullView && (
            <TabsContent value="positions" className="mt-4">
              {(p.clubRoles ?? []).length === 0 && !p.academicState && !p.major ? (
                <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                  No club positions recorded.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {(p.clubRoles ?? []).length > 0 && (
                    <section className="glass-3d rounded-lg border p-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Club positions
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(p.clubRoles ?? []).map((r: string) => (
                          <span
                            key={r}
                            className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                          >
                            <BadgeCheck className="size-3.5" /> {r}
                          </span>
                        ))}
                      </div>
                    </section>
                  )}
                  <section className="grid grid-cols-2 gap-3 text-sm">
                    {p.academicState && (
                      <div className="glass-3d rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Academic state</p>
                        <p className="mt-0.5 font-medium">{p.academicState}</p>
                      </div>
                    )}
                    {p.major && (
                      <div className="glass-3d rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Major</p>
                        <p className="mt-0.5 font-medium">{p.major}</p>
                      </div>
                    )}
                    {p.studentCode && (
                      <div className="glass-3d rounded-lg border p-3">
                        <p className="text-xs text-muted-foreground">Club code</p>
                        <p className="mt-0.5 font-mono">{p.studentCode}</p>
                      </div>
                    )}
                  </section>
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>

        {/* Actions */}
        <section className="flex flex-wrap gap-2">
          {viewerIsAdmin && (
            <Button variant="outline" onClick={() => navigate("/people")}>
              <Pencil className="size-4" /> Edit in People
            </Button>
          )}
          {isSelf && (
            <Button variant="outline" onClick={() => navigate("/profile")}>
              Open my profile
            </Button>
          )}
        </section>

        {/* Fresh scan popup: straight to the full profile. */}
        {scanPopup && !isSelf && (
          <Dialog open onOpenChange={(v) => !v && setScanPopup(false)}>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{p.name ?? "Member"}</DialogTitle>
                <DialogDescription>You scanned this member's QR code.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-2">
                <Button onClick={() => setScanPopup(false)}>
                  <UserRound className="size-4" /> View profile
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {badgeOpen && (
          <PersonBadgeDialog
            p={{
              userId: p._id,
              name: p.name ?? "Member",
              email: p.email,
              image: p.image,
              role: p.role,
              studentId: p.studentId,
              clubRoles: p.clubRoles,
              academicState: p.academicState,
              major: p.major,
              phone: p.phone,
              telegramUsername: p.telegramUsername,
            }}
            onClose={() => setBadgeOpen(false)}
          />
        )}
      </div>
    </AppShell>
  );
}
