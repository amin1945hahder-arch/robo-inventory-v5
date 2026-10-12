import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery, mutation, query, QueryCtx } from "./_generated/server";
import { touchPatch, recordTombstone } from "./sync";
import {
  hasInventoryPrivilege,
  hasPrinterPrivilege,
  inventoryPermsOf,
  requireAdmin,
  requireNonGuest,
  requireNonStudent,
  requireUser,
  safeImage,
} from "./lib";
import { emailInAdminList } from "./adminConfig";
import { notifyTelegram, telegramDM } from "./notify";
import { getRankRoleMap, mappedRoleFor } from "./clubLists";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.authHelpers.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    return user;
  },
});

/**
 * Light directory of real (non-anonymous) members for pickers — e.g. the
 * project "Add people" dialog. Available to admins and members.
 * Users are sorted once here so every consumer renders a stable order
 * without re-sorting the list on each render.
 */
export const listPeopleLite = query({
  args: {},
  handler: async (ctx) => {
    await requireNonStudent(ctx);
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => !u.isAnonymous)
      .map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        image: safeImage(u.image),
        role: u.role,
        clubRoles: u.clubRoles,
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  },
});

/**
 * Use this function internally to get the current user data. Remember to handle the null user case.
 * @param ctx
 * @returns
 */
export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
};

// Internal twin of `currentUser` for Node actions (they can only run internal
// queries) — e.g. the database-reset actions verifying the caller is an admin.
export const currentInternalUser = internalQuery({
  args: {},
  handler: async (ctx) => getCurrentUser(ctx),
});

// Bootstrap A: the first user who signs in with an email on the admin allow-list
// (ADMIN_EMAILS env var, comma-separated) is promoted to admin automatically.
export const claimAdminIfEligible = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { promoted: false };
    const user = await ctx.db.get(userId);
    if (!user || !user.email || user.role === "admin") return { promoted: false };
    if (!emailInAdminList(user.email)) return { promoted: false };
    await touchPatch(ctx, userId, { role: "admin" });
    return { promoted: true };
  },
});

// Bootstrap B (no env vars needed): while there are ZERO admins in the system,
// the signed-in caller is promoted to admin. This guarantees the first real
// user (e.g. Dr. Essa) always lands in control, even before ADMIN_EMAILS is set.
// Every OTHER new account starts as the restricted "student" role until an
// admin promotes them — the app shell runs this once per sign-in.
export const claimAdminIfNoAdmins = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { promoted: false, reason: "not-signed-in" };
    const user = await ctx.db.get(userId);
    if (!user) return { promoted: false, reason: "no-user" };
    if (user.role === "admin") return { promoted: false, alreadyAdmin: true };
    // Index lookup: ONE read instead of collecting every user in the system
    // on every single sign-in.
    const existingAdmin = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .first();
    const patch: Record<string, unknown> = {};
    if (!existingAdmin) {
      patch.role = "admin";
    } else if (!user.role) {
      // Brand-new accounts default to the restricted student role.
      patch.role = "student";
    }
    if (Object.keys(patch).length === 0) {
      return { promoted: false, reason: "admins-exist" };
    }
    await touchPatch(ctx, userId, patch);
    return { promoted: patch.role === "admin" };
  },
});

// When the club dataset pre-seeds member profiles (before those people have
// auth accounts), the first time a real person signs in with that email the
// auth layer creates a fresh user row. Merge the seeded profile (name, ids,
// phone, admin role) into the auth account and drop the seeded duplicate.
export const reconcileProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { ok: false, reason: "not-signed-in" };
    const me = await ctx.db.get(userId);
    if (!me?.email) return { ok: false, reason: "no-email" };
    const dup = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", me.email))
      .filter((q) => q.neq(q.field("_id"), userId))
      .first();
    if (!dup) return { ok: false, reason: "no-dup" };
    const patch: Record<string, unknown> = {};
    if (!me.name && dup.name) patch.name = dup.name;
    if (!me.studentId && dup.studentId) patch.studentId = dup.studentId;
    if (!me.phone && dup.phone) patch.phone = dup.phone;
    if (!me.academicState && dup.academicState) patch.academicState = dup.academicState;
    if (!me.major && dup.major) patch.major = dup.major;
    if (!me.clubRoles?.length && dup.clubRoles?.length) patch.clubRoles = dup.clubRoles;
    if (!me.studentCode && dup.studentCode) patch.studentCode = dup.studentCode;
    if (dup.role === "admin" && me.role !== "admin") patch.role = "admin";
    if (Object.keys(patch).length > 0) await touchPatch(ctx, userId, patch);
    await ctx.db.delete(dup._id);
    await recordTombstone(ctx, "users", dup._id);
    return { ok: true, merged: Object.keys(patch) };
  },
});

// Admin edits a person's club profile: real positions, academic state, major,
// date of birth, GitHub URL, and the app-level role (admin/member).
export const updatePersonProfile = mutation({
  args: {
    userId: v.id("users"),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"), v.literal("student"))),
    clubRoles: v.optional(v.array(v.string())),
    academicState: v.optional(v.string()),
    major: v.optional(v.string()),
    telegramChatId: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
    // Admin-editable email: updates the sign-in identity for this member.
    email: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { userId, role, clubRoles, academicState, major, telegramChatId, dateOfBirth, githubUrl, email },
  ) => {
    const admin = await requireAdmin(ctx);
    // The last line of defence for the admin role: an admin cannot demote
    // themselves (member/student) — another admin must do it, so the club can
    // never end up with zero admins by accident.
    if (role && role !== "admin" && userId === admin._id) {
      throw new ConvexError("Admins cannot change their own role — ask another admin");
    }
    const patch: Record<string, unknown> = {};
    if (role) patch.role = role;
    if (clubRoles !== undefined) {
      patch.clubRoles = clubRoles;
      // Rank → app-role mapping: assigning a rank that an admin marked as a
      // main role (e.g. "manager" → Admin) upgrades the person automatically.
      // An explicit `role` argument always wins; a member who already holds
      // the mapped role is left untouched (no write at all).
      if (role === undefined) {
        const map = await getRankRoleMap(ctx);
        const mapped = mappedRoleFor(map, clubRoles);
        if (mapped) {
          const person = await ctx.db.get(userId);
          if (person && person.role !== mapped) patch.role = mapped;
        }
      }
    }
    if (academicState !== undefined) patch.academicState = academicState;
    if (major !== undefined) patch.major = major;
    if (telegramChatId !== undefined) patch.telegramChatId = telegramChatId.trim() || undefined;
    if (dateOfBirth !== undefined) {
      const iso = dateOfBirth.trim();
      if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        throw new ConvexError("Date of birth must be in YYYY-MM-DD format");
      }
      patch.dateOfBirth = iso || undefined;
    }
    if (githubUrl !== undefined) patch.githubUrl = githubUrl.trim() || undefined;
    if (email !== undefined) {
      const clean = email.trim().toLowerCase();
      if (clean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
        throw new ConvexError("Email format looks wrong");
      }
      if (clean) {
        // No two accounts may share one email.
        const dup = await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", clean))
          .first();
        if (dup && dup._id !== userId) {
          throw new ConvexError(`That email is already used by ${dup.name ?? "another account"}`);
        }
        patch.email = clean;
      }
    }
    await touchPatch(ctx, userId, patch);
  },
});

/**
 * Admin adds a person before they ever sign in: the profile exists immediately
 * (People page, rental assignment, team rosters) and carries a stable
 * `studentCode` reference id. When the real person later signs in with the
 * SAME email, `reconcileProfile` merges the pre-made record into their live
 * account — roles, positions, Telegram… everything survives; nothing is
 * duplicated. If they sign in with a different email, the admin can merge or
 * delete the placeholder from People as usual.
 */
export const adminCreatePerson = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"), v.literal("student"))),
    studentId: v.optional(v.string()),
    phone: v.optional(v.string()),
    clubRoles: v.optional(v.array(v.string())),
    academicState: v.optional(v.string()),
    major: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
    telegramChatId: v.optional(v.string()),
  },
  handler: async (ctx, { name, email, role, studentId, phone, clubRoles, academicState, major, dateOfBirth, githubUrl, telegramChatId }) => {
    await requireAdmin(ctx);
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new ConvexError("Enter a valid email address");
    }
    if (!name.trim()) throw new ConvexError("Name is required");
    // Same exact email already in the app?
    const dupEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", cleanEmail))
      .first();
    if (dupEmail) throw new ConvexError("A person with that email already exists");
    // Same display name (case-insensitive) already in the app?
    const cleanName = name.trim();
    const all = await ctx.db.query("users").collect();
    if (all.some((u) => (u.name ?? "").trim().toLowerCase() === cleanName.toLowerCase())) {
      throw new ConvexError(`A person named "${cleanName}" already exists`);
    }
    // Next reference-sheet id: STU-0007 style, one past the current max.
    const maxCode = all.reduce((m, u) => {
      const match = /^STU-(\d+)$/.exec(u.studentCode ?? "");
      return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    const doc: Record<string, unknown> = {
      name: cleanName,
      email: cleanEmail,
      role: role ?? "member",
      studentCode: `STU-${String(maxCode + 1).padStart(4, "0")}`,
    };
    if (studentId !== undefined) doc.studentId = studentId.trim() || undefined;
    if (phone !== undefined) doc.phone = phone.trim() || undefined;
    if (clubRoles !== undefined) doc.clubRoles = clubRoles;
    // Rank → app-role mapping for freshly created people as well (only when
    // the admin did not pick an explicit role).
    if (clubRoles !== undefined && role === undefined) {
      const map = await getRankRoleMap(ctx);
      const mapped = mappedRoleFor(map, clubRoles);
      if (mapped) doc.role = mapped;
    }
    if (academicState !== undefined) doc.academicState = academicState || undefined;
    if (major !== undefined) doc.major = major.trim() || undefined;
    if (dateOfBirth !== undefined) {
      const iso = dateOfBirth.trim();
      if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        throw new ConvexError("Date of birth must be in YYYY-MM-DD format");
      }
      doc.dateOfBirth = iso || undefined;
    }
    if (githubUrl !== undefined) doc.githubUrl = githubUrl.trim() || undefined;
    if (telegramChatId !== undefined) doc.telegramChatId = telegramChatId.trim() || undefined;
    return await ctx.db.insert("users", { ...doc, updatedAt: Date.now() });
  },
});

// Mark someone as no longer in the club (ex-member). Their history stays;
// they just stop counting as an active member.
export const setMembershipStatus = mutation({
  args: { userId: v.id("users"), status: v.union(v.literal("active"), v.literal("ex")) },
  handler: async (ctx, { userId, status }) => {
    await requireAdmin(ctx);
    await touchPatch(ctx, userId, { membershipStatus: status });
  },
});

// Member sets their own Telegram @username so the club bot can tag them in
// the group and DM them. Self-service — no admin needed.
export const setMyTelegramUsername = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const user = await requireNonGuest(ctx);
    const clean = username.trim().replace(/^@/, "");
    await touchPatch(ctx, user._id, {
      telegramUsername: clean === "" ? undefined : clean,
    });
  },
});

// Member sets their own Telegram chat id (the number @chatid_echo_bot and
// similar bots report). Self-service — mirrors the admin override in People.
export const setMyTelegramChatId = mutation({
  args: { chatId: v.string() },
  handler: async (ctx, { chatId }) => {
    const user = await requireNonGuest(ctx);
    const clean = chatId.trim();
    if (clean !== "" && !/^-?\d{4,}$/.test(clean)) {
      throw new ConvexError("That does not look like a Telegram chat id (numbers only)");
    }
    await touchPatch(ctx, user._id, {
      telegramChatId: clean === "" ? undefined : clean,
    });
  },
});

/**
 * Bot-side auto-linking: the club bot periodically reads its updates and, for
 * any private message it receives, records the sender's chat id. Callers pass
 * a chat id + username (as Telegram reports them); if a member with that
 * @username exists and has no chat id yet, it is linked automatically.
 * Unauthenticated by design — anyone messaging the bot gets linked.
 */
export const linkTelegramChatByUsername = mutation({
  args: { chatId: v.string(), username: v.optional(v.string()) },
  handler: async (ctx, { chatId, username }) => {
    const clean = chatId.trim();
    if (!/^-?\d{4,}$/.test(clean)) return { linked: false };
    const cleanUser = username?.trim().replace(/^@/, "");
    if (!cleanUser) return { linked: false };
    const person = await ctx.db
      .query("users")
      .withIndex("by_telegram_username", (q) => q.eq("telegramUsername", cleanUser))
      .unique();
    if (!person || person.telegramChatId === clean) return { linked: false };
    await touchPatch(ctx, person._id, { telegramChatId: clean });
    return { linked: true };
  },
});

// Remove a person from the app entirely. Blocked while they still hold parts
// or have pending requests so inventory never loses track of a unit. Purges
// every row tied to the user — auth accounts/sessions/tokens (so their login
// is dead for good), their profile-change and rank requests — then deletes
// the user doc itself. Only historical rental rows survive (rendered as
// "(removed)"), so the ledger stays auditable.
export const deletePerson = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireAdmin(ctx);
    if (userId === (await getAuthUserId(ctx))) {
      throw new ConvexError("You cannot delete your own account");
    }
    const person = await ctx.db.get(userId);
    if (!person) return;

    const openRentals = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
    if (openRentals.length > 0) {
      throw new ConvexError(
        `${person.name ?? person.email} still holds ${openRentals.length} rented part(s). Process their returns first.`,
      );
    }
    const pendingRentals = await ctx.db
      .query("rentals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    if (pendingRentals.length > 0) {
      throw new ConvexError("This person still has pending rental requests. Deny them first.");
    }
    const onProject = await ctx.db
      .query("parts")
      .withIndex("by_group")
      .filter((q) => q.eq(q.field("currentHolderId"), userId))
      .collect();
    if (onProject.length > 0) {
      throw new ConvexError("This person still holds parts. Process returns first.");
    }

    // 1) Auth data — accounts, sessions, refresh tokens, verification codes —
    //    so the person can never sign back in with the same credentials.
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();
    for (const acc of accounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", acc._id))
        .collect();
      for (const c of codes) await ctx.db.delete(c._id);
      await ctx.db.delete(acc._id);
    }
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const s of sessions) {
      const refresh = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const t of refresh) await ctx.db.delete(t._id);
      await ctx.db.delete(s._id);
    }

    // 2) Their profile-change and rank requests.
    for (const table of ["profileRequests", "rankRequests"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_status")
        .collect();
      for (const r of rows.filter((r) => r.userId === userId)) await ctx.db.delete(r._id);
    }

    // 3) The user document itself. Past rental history rows are kept (they
    //    render "(removed)") — deleting a member never rewrites the ledger.
    await ctx.db.delete(userId);
    await recordTombstone(ctx, "users", userId);
  },
});

// ===== Person profile card (behind a person QR label) =====

/**
 * Profile card for a scanned person QR: the club profile for every signed-in
 * role, plus their rental history when the viewer is an admin or the person
 * themselves. Guests never resolve (they are not people).
 */
export const getPersonCard = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await requireUser(ctx);
    const person = await ctx.db.get(userId);
    if (!person || person.isAnonymous) return null;

    const canSeeHistory = me.role === "admin" || me._id === userId;
    const rentals: {
      _id: string;
      status: string;
      requestedAt: number;
      decidedAt?: number;
      pickedUpAt?: number;
      returnedAt?: number;
      partTag: string;
      groupName: string;
      partId?: string;
    }[] = [];
    if (canSeeHistory) {
      const cache = new Map<string, Promise<any>>();
      const get = (id: string | undefined) => {
        if (!id) return null;
        let p = cache.get(id);
        if (!p) {
          p = ctx.db.get(id as any);
          cache.set(id, p);
        }
        return p;
      };
      const rows = await ctx.db
        .query("rentals")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const r of rows.sort((a, b) => b.requestedAt - a.requestedAt)) {
        const part = (await get(r.partId)) as any;
        const group = part ? ((await get(part.groupId)) as any) : null;
        rentals.push({
          _id: r._id,
          status: r.status,
          requestedAt: r.requestedAt,
          decidedAt: r.decidedAt,
          pickedUpAt: r.pickedUpAt,
          returnedAt: r.returnedAt,
          partTag: part?.tag ?? "?",
          groupName: group?.name ?? "Part",
          partId: part?._id,
        });
      }
    }

    return {
      person: {
        _id: person._id,
        name: person.name,
        email: person.email,
        image: safeImage(person.image),
        role: person.role,
        studentId: person.studentId,
        phone: person.phone,
        clubRoles: person.clubRoles,
        academicState: person.academicState,
        major: person.major,
        studentCode: person.studentCode,
        dateOfBirth: person.dateOfBirth,
        githubUrl: person.githubUrl,
        telegramUsername: person.telegramUsername,
        membershipStatus: person.membershipStatus,
        profileApproved: person.profileApproved,
        printerRole: person.printerRole,
      },
      canSeeHistory,
      isSelf: me._id === userId,
      viewerIsAdmin: me.role === "admin",
      rentals,
    };
  },
});

// Internal: the Telegram action fetches a member's delivery targets (name,
// chat id, @username) without exposing them through a public query.
export const getUserForDm = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      name: user.name,
      telegramChatId: user.telegramChatId,
      telegramUsername: user.telegramUsername,
    };
  },
});

// ===== Member rank/position upgrade requests =====

// A member asks the admin for specific club positions (and can add a message).
export const requestRankUpgrade = mutation({
  args: {
    requestedRoles: v.array(v.string()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { requestedRoles, message }) => {
    const user = await requireNonGuest(ctx);
    const clean = requestedRoles.map((r) => r.trim()).filter(Boolean);
    if (clean.length === 0) throw new ConvexError("Select at least one position");
    const mine = await ctx.db
      .query("rankRequests")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending"),
      )
      .first();
    if (mine) {
      throw new ConvexError("You already have a pending rank request");
    }
    await ctx.db.insert("rankRequests", {
      userId: user._id,
      requestedRoles: clean,
      message: message?.trim() || undefined,
      status: "pending",
      requestedAt: Date.now(),
    });
    // OS-level push to every admin device.
    await ctx.scheduler.runAfter(0, internal.push.pushToAdmins, {
      title: "New rank request",
      body: `${user.name ?? user.email ?? "A member"} requests: ${clean.join(", ")}`,
      tag: "rc-rank",
      url: "/admin/requests",
    });
  },
});

// ===== Main role requests (member / admin) =====

// A member asks to be upgraded to one of the app's main roles. The admin
// reviews it in the Requests console exactly like a rank request.
export const requestRoleUpgrade = mutation({
  args: {
    role: v.union(v.literal("member"), v.literal("admin")),
    message: v.optional(v.string()),
  },
  handler: async (ctx, { role, message }) => {
    const user = await requireNonGuest(ctx);
    if (user.role === role) {
      throw new ConvexError(`You already have the ${role} role`);
    }
    const mine = await ctx.db
      .query("rankRequests")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending"),
      )
      .first();
    if (mine) {
      throw new ConvexError("You already have a pending request — wait for the admin first");
    }
    await ctx.db.insert("rankRequests", {
      userId: user._id,
      kind: "role",
      requestedRoles: [role],
      message: message?.trim() || undefined,
      status: "pending",
      requestedAt: Date.now(),
    });
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "role_request",
      text: `${user.name ?? user.email ?? "A member"} requested the ${role} role`,
      link: "/admin/requests?tab=ranks",
    });
    await ctx.scheduler.runAfter(0, internal.push.pushToAdmins, {
      title: "New role request",
      body: `${user.name ?? user.email ?? "A member"} requested the ${role} role`,
      tag: "rc-role",
      url: "/admin/requests?tab=ranks",
    });
  },
});

// Admin view of all rank/role requests with the requester joined in.
export const listRankRequests = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"))) },
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const rows = status
      ? await ctx.db.query("rankRequests").withIndex("by_status", (q) => q.eq("status", status)).collect()
      : await ctx.db.query("rankRequests").collect();
    const sorted = rows.sort((a, b) => b.requestedAt - a.requestedAt);
    // Parallel member joins — latency is wall-clock, so Promise.all keeps the
    // console snappy while the read count stays one per request row.
    const users = await Promise.all(sorted.map((r) => ctx.db.get(r.userId)));
    return sorted.map((r, i) => ({
      request: r,
      user: users[i]
        ? {
            _id: users[i]!._id,
            name: users[i]!.name,
            email: users[i]!.email,
            image: safeImage(users[i]!.image),
            role: users[i]!.role,
            clubRoles: users[i]!.clubRoles,
            studentId: users[i]!.studentId,
            telegramChatId: users[i]!.telegramChatId,
            telegramUsername: users[i]!.telegramUsername,
          }
        : null,
    }));
  },
});

// Admin approves (adds the positions to the member) or denies the request.
// Role requests (kind "role") set the member's MAIN app role instead.
export const decideRankRequest = mutation({
  args: { id: v.id("rankRequests"), approve: v.boolean() },
  handler: async (ctx, { id, approve }) => {
    await requireAdmin(ctx);
    const req = await ctx.db.get(id);
    if (!req || req.status !== "pending") throw new ConvexError("Request not found or already handled");
    const user = await ctx.db.get(req.userId);
    let appliedRole: string | undefined;
    if (approve && user) {
      if (req.kind === "role") {
        const target = req.requestedRoles[0];
        if (target === "admin" || target === "member") {
          // Already holds it → no write at all (nothing to change).
          if (user.role !== target) {
            await touchPatch(ctx, user._id, { role: target });
            appliedRole = target;
          }
        }
      } else {
        const merged = [...new Set([...(user.clubRoles ?? []), ...req.requestedRoles])];
        const patch: Record<string, unknown> = { clubRoles: merged };
        // Rank → app-role mapping (admin marks a rank in Settings): when the
        // requested/assigned rank maps to a main role and the member does not
        // hold it yet, the role is granted automatically.
        const map = await getRankRoleMap(ctx);
        const mapped = mappedRoleFor(map, merged);
        if (mapped && user.role !== mapped) {
          patch.role = mapped;
          appliedRole = mapped;
        }
        await touchPatch(ctx, user._id, patch);
      }
    }
    await touchPatch(ctx, id, { status: approve ? "approved" : "denied", decidedAt: Date.now() });
    const member = await ctx.db.get(req.userId);
    if (member) {
      await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
        userId: member._id,
        title: approve
          ? req.kind === "role"
            ? "Role request approved 🎉"
            : "Rank request approved 🏅"
          : "Request reviewed",
        body: approve
          ? req.kind === "role"
            ? `You are now ${appliedRole ?? "the requested role"} in the app.`
            : `Your positions: ${req.requestedRoles.join(", ")}`
          : `Your request (${req.requestedRoles.join(", ")}) was not approved this time.`,
        tag: "rc-rank",
        url: "/profile",
      });
      if (member.telegramChatId) {
        await notifyTelegram(
          ctx,
          approve
            ? req.kind === "role"
              ? `🎉 ${member.name ?? member.email} — your ${req.requestedRoles[0]} role request was approved.`
              : `🏅 ${member.name ?? member.email} — your rank request was approved. New positions: ${req.requestedRoles.join(", ")}`
            : `ℹ️ ${member.name ?? member.email} — your request (${req.requestedRoles.join(", ")}) was not approved this time.`,
          member.telegramChatId,
        );
      }
    }
  },
});

// The signed-in member's own pending rank/role request (if any).
export const myPendingRankRequest = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query("rankRequests")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending"),
      )
      .first();
    return Boolean(row);
  },
});

// ===== Printer privilege (stacks on any role; admins hold it implicitly) =====

// Member asks the admin for the "printer" privilege (print farm access).
export const requestPrinterRole = mutation({
  args: { message: v.optional(v.string()) },
  handler: async (ctx, { message }) => {
    const user = await requireNonGuest(ctx);
    if (hasPrinterPrivilege(user)) {
      throw new ConvexError("You already have printer access");
    }
    const mine = await ctx.db
      .query("printerRequests")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending"),
      )
      .first();
    if (mine) {
      throw new ConvexError("You already have a pending printer request");
    }
    await ctx.db.insert("printerRequests", {
      userId: user._id,
      message: message?.trim() || undefined,
      status: "pending",
      requestedAt: Date.now(),
    });
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "printer_request",
      text: `${user.name ?? user.email ?? "A member"} requested printer access`,
      link: "/admin/requests",
    });
    // OS-level push to every admin device.
    await ctx.scheduler.runAfter(0, internal.push.pushToAdmins, {
      title: "New printer request",
      body: `${user.name ?? user.email ?? "A member"} requested printer access`,
      tag: "rc-printer",
      url: "/admin/requests",
    });
  },
});

// Admin view of printer-privilege requests with the requester joined in.
export const listPrinterRequests = query({
  args: {
    status: v.optional(
      v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
    ),
  },
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const rows = status
      ? await ctx.db
          .query("printerRequests")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect()
      : await ctx.db.query("printerRequests").collect();
    const sorted = rows.sort((a, b) => b.requestedAt - a.requestedAt);
    const users = await Promise.all(sorted.map((r) => ctx.db.get(r.userId)));
    return sorted.map((r, i) => ({
      request: r,
      user: users[i]
        ? {
            _id: users[i]!._id,
            name: users[i]!.name,
            email: users[i]!.email,
            image: safeImage(users[i]!.image),
            role: users[i]!.role,
            printerRole: users[i]!.printerRole,
            inventoryRole: users[i]!.inventoryRole,
            inventoryPerms: users[i]!.inventoryPerms,
            studentId: users[i]!.studentId,
            clubRoles: users[i]!.clubRoles,
            telegramUsername: users[i]!.telegramUsername,
          }
        : null,
    }));
  },
});

// Admin grants or revokes the printer privilege directly (People page toggle).
// Revocation is allowed only while the person has no queued/active prints.
export const setPrinterRole = mutation({
  args: { userId: v.id("users"), granted: v.boolean() },
  handler: async (ctx, { userId, granted }) => {
    const admin = await requireAdmin(ctx);
    const person = await ctx.db.get(userId);
    if (!person) throw new ConvexError("Person not found");
    if (!granted) {
      const busy = await ctx.db
        .query("printJobs")
        .withIndex("by_requester", (q) => q.eq("requesterId", userId))
        .collect();
      if (busy.some((j) => ["queued", "printing"].includes(j.status))) {
        throw new ConvexError(
          "This person still has queued or active prints — finish them first",
        );
      }
    }
    await touchPatch(ctx, userId, { printerRole: granted || undefined });
    // Auto-resolve their pending request (if any) to keep the console clean.
    const mine = await ctx.db
      .query("printerRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    for (const r of mine.filter((r) => r.userId === userId)) {
      await touchPatch(ctx, r._id, {
        status: granted ? "approved" : "denied",
        decidedAt: Date.now(),
      });
    }
    if (userId !== admin._id) {
      await telegramDM(
        ctx,
        {
          name: person.name ?? person.email,
          telegramChatId: person.telegramChatId,
          telegramUsername: person.telegramUsername,
        },
        granted
          ? `🖨️ ${admin.name ?? admin.email} granted you printer access — the Slicer Studio and print scheduling are unlocked.`
          : `🖨️ ${admin.name ?? admin.email} revoked your printer access.`,
        { name: admin.name ?? admin.email },
        "members",
      );
    }
  },
});

// Admin approves/denies a member's printer-privilege request.
export const decidePrinterRequest = mutation({
  args: { id: v.id("printerRequests"), approve: v.boolean() },
  handler: async (ctx, { id, approve }) => {
    const admin = await requireAdmin(ctx);
    const req = await ctx.db.get(id);
    if (!req || req.status !== "pending")
      throw new ConvexError("Request not found or already handled");
    if (approve) {
      await touchPatch(ctx, req.userId, { printerRole: true });
    }
    await touchPatch(ctx, id, {
      status: approve ? "approved" : "denied",
      decidedAt: Date.now(),
    });
    const user = await ctx.db.get(req.userId);
    if (user?.telegramChatId || user?.telegramUsername) {
      await notifyTelegram(
        ctx,
        approve
          ? `🖨️ ${user.name ?? user.email} — your printer access was granted. Slicer Studio unlocked!`
          : `ℹ️ ${user.name ?? user.email} — your printer access request was not approved this time.`,
        user.telegramChatId,
      );
    }
  },
});

// The signed-in member's own pending printer request (if any).
export const myPendingPrinterRequest = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query("printerRequests")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending"),
      )
      .first();
    return Boolean(row);
  },
});

// ===== Inventory manager privilege (stacks on any role) =====

// Member asks the admin for inventory-manager access.
export const requestInventoryRole = mutation({
  args: { message: v.optional(v.string()) },
  handler: async (ctx, { message }) => {
    const user = await requireNonGuest(ctx);
    if (hasInventoryPrivilege(user)) {
      throw new ConvexError("You already have inventory manager access");
    }
    const mine = await ctx.db
      .query("inventoryRequests")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending"),
      )
      .first();
    if (mine) {
      throw new ConvexError("You already have a pending inventory request");
    }
    await ctx.db.insert("inventoryRequests", {
      userId: user._id,
      message: message?.trim() || undefined,
      status: "pending",
      requestedAt: Date.now(),
    });
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "inventory_request",
      text: `${user.name ?? user.email ?? "A member"} requested inventory manager access`,
      link: "/admin/requests?tab=printers",
    });
    await ctx.scheduler.runAfter(0, internal.push.pushToAdmins, {
      title: "New inventory request",
      body: `${user.name ?? user.email ?? "A member"} requested inventory manager access`,
      tag: "rc-inventory",
      url: "/admin/requests?tab=printers",
    });
  },
});

// Admin view of inventory-manager requests with the requester joined in.
export const listInventoryRequests = query({
  args: {
    status: v.optional(
      v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
    ),
  },
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const rows = status
      ? await ctx.db
          .query("inventoryRequests")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect()
      : await ctx.db.query("inventoryRequests").collect();
    const sorted = rows.sort((a, b) => b.requestedAt - a.requestedAt);
    const users = await Promise.all(sorted.map((r) => ctx.db.get(r.userId)));
    return sorted.map((r, i) => ({
      request: r,
      user: users[i]
        ? {
            _id: users[i]!._id,
            name: users[i]!.name,
            email: users[i]!.email,
            image: safeImage(users[i]!.image),
            role: users[i]!.role,
            printerRole: users[i]!.printerRole,
            inventoryRole: users[i]!.inventoryRole,
            inventoryPerms: users[i]!.inventoryPerms,
            studentId: users[i]!.studentId,
            clubRoles: users[i]!.clubRoles,
            telegramUsername: users[i]!.telegramUsername,
          }
        : null,
    }));
  },
});

// Admin grants/revokes the inventory privilege and picks the sub-permissions
// (edit / add / delete) in one go. Pending requests are auto-resolved.
export const setInventoryRole = mutation({
  args: {
    userId: v.id("users"),
    granted: v.boolean(),
    perms: v.optional(
      v.object({ edit: v.boolean(), add: v.boolean(), delete: v.boolean() }),
    ),
  },
  handler: async (ctx, { userId, granted, perms }) => {
    const admin = await requireAdmin(ctx);
    const person = await ctx.db.get(userId);
    if (!person) throw new ConvexError("Person not found");
    const nextPerms =
      perms ??
      (granted
        ? // Keep the current sub-permissions when re-granting, otherwise
          // start with full access.
          (person.inventoryPerms ?? { edit: true, add: true, delete: true })
        : undefined);
    await touchPatch(ctx, userId, {
      inventoryRole: granted || undefined,
      inventoryPerms: granted ? nextPerms : undefined,
    });
    // Auto-resolve their pending request (if any) to keep the console clean.
    const mine = await ctx.db
      .query("inventoryRequests")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "pending"),
      )
      .collect();
    for (const r of mine) {
      await touchPatch(ctx, r._id, {
        status: granted ? "approved" : "denied",
        decidedAt: Date.now(),
      });
    }
    if (userId !== admin._id) {
      await telegramDM(
        ctx,
        {
          name: person.name ?? person.email,
          telegramChatId: person.telegramChatId,
          telegramUsername: person.telegramUsername,
        },
        granted
          ? `📦 ${admin.name ?? admin.email} granted you INVENTORY MANAGER access — you can now manage the shelf.`
          : `📦 ${admin.name ?? admin.email} revoked your inventory manager access.`,
        { name: admin.name ?? admin.email },
        "members",
      );
    }
    return { ok: true };
  },
});

// Admin approves/denies an inventory-manager request (full access by default;
// the admin can narrow the sub-permissions afterwards from People / Requests).
export const decideInventoryRequest = mutation({
  args: {
    id: v.id("inventoryRequests"),
    approve: v.boolean(),
    perms: v.optional(
      v.object({ edit: v.boolean(), add: v.boolean(), delete: v.boolean() }),
    ),
  },
  handler: async (ctx, { id, approve, perms }) => {
    const admin = await requireAdmin(ctx);
    const req = await ctx.db.get(id);
    if (!req || req.status !== "pending")
      throw new ConvexError("Request not found or already handled");
    if (approve) {
      await touchPatch(ctx, req.userId, {
        inventoryRole: true,
        inventoryPerms: perms ?? { edit: true, add: true, delete: true },
      });
    }
    await touchPatch(ctx, id, {
      status: approve ? "approved" : "denied",
      decidedAt: Date.now(),
    });
    const user = await ctx.db.get(req.userId);
    if (user) {
      await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
        userId: user._id,
        title: approve ? "Inventory manager 📦" : "Inventory request reviewed",
        body: approve
          ? "You can now manage inventory items — ask an admin to fine-tune your permissions."
          : "Your inventory manager request was not approved this time.",
        tag: "rc-inventory",
        url: "/inventory",
      });
      if (user.telegramChatId || user.telegramUsername) {
        await telegramDM(
          ctx,
          {
            name: user.name ?? user.email,
            telegramChatId: user.telegramChatId,
            telegramUsername: user.telegramUsername,
          },
          approve
            ? `📦 Your INVENTORY MANAGER access was granted${admin ? ` by ${admin.name ?? admin.email}` : ""}.`
            : `ℹ️ Your inventory manager request was not approved this time.`,
          { name: admin?.name ?? admin?.email },
          "members",
        );
      }
    }
    return { ok: true };
  },
});

// The signed-in member's own pending inventory request (if any).
export const myPendingInventoryRequest = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query("inventoryRequests")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", user._id).eq("status", "pending"),
      )
      .first();
    return Boolean(row);
  },
});

// Effective inventory access for the SIGNED-IN user — the client uses this
// to show/hide inventory edit controls (admins always see everything).
export const myInventoryAccess = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    return {
      isManager: hasInventoryPrivilege(me),
      perms: inventoryPermsOf(me),
    };
  },
});

// ===== Profile approval (new members start view-only) =====

// Member submits their profile data (name + student id or phone) directly.
// Stores it on their user row (not live for interactions until approved) and
// pings the admins. Self-submission is allowed for guests-free real users; the
// profile simply stays locked until an admin approves it.
export const submitMyProfile = mutation({
  args: {
    name: v.string(),
    studentId: v.optional(v.string()),
    phone: v.optional(v.string()),
    telegramUsername: v.optional(v.string()),
  },
  handler: async (ctx, { name, studentId, phone, telegramUsername }) => {
    const user = await requireUser(ctx);
    if (user.isAnonymous) throw new ConvexError("Guests cannot submit a profile — sign in first");
    const cleanName = name.trim();
    if (cleanName.length < 2) throw new ConvexError("Enter your full name");
    if (!studentId?.trim() && !phone?.trim()) {
      throw new ConvexError("Add your student ID or phone so the admin can verify you");
    }
    await touchPatch(ctx, user._id, {
      name: cleanName,
      studentId: studentId?.trim() || undefined,
      phone: phone?.trim() || undefined,
      telegramUsername: telegramUsername?.trim().replace(/^@/, "") || user.telegramUsername,
      // Explicitly pending: new submissions wait for admin approval (legacy
      // seeded members without the flag stay grandfathered).
      profileApproved: false,
    });
    // The NEW MEMBER hears back immediately: their submission landed and an
    // admin will review it (push on their devices + bot DM when linked).
    await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
      userId: user._id,
      title: "Profile submitted 📝",
      body: `Thanks ${cleanName} — an admin will review it shortly.`,
      tag: "rc-profile",
      url: "/profile",
    });
    if (user.telegramChatId || user.telegramUsername) {
      await telegramDM(
        ctx,
        {
          name: user.name,
          telegramUsername: user.telegramUsername,
          telegramChatId: user.telegramChatId,
        },
        `📝 We received your profile — an admin will review it shortly.`,
        { name: cleanName },
        "members",
      );
    }
    await ctx.db.insert("notifications", {
      forRole: "admin",
      type: "profile",
      text: `${cleanName} submitted their profile for approval`,
      link: "/admin/requests",
    });
    // OS-level push to every admin device.
    await ctx.scheduler.runAfter(0, internal.push.pushToAdmins, {
      title: "Profile awaiting approval",
      body: `${cleanName} submitted their profile for approval`,
      tag: "rc-profile",
      url: "/admin/requests",
    });
    return { ok: true };
  },
});

// Admin approves a member's profile: they unlock all member interactions.
export const approveProfile = mutation({
  args: { userId: v.id("users"), approved: v.boolean() },
  handler: async (ctx, { userId, approved }) => {
    const admin = await requireAdmin(ctx);
    const member = await ctx.db.get(userId);
    if (!member) throw new ConvexError("Member not found");
    await touchPatch(ctx, userId, { profileApproved: approved });
    await notifyTelegram(
      ctx,
      approved
        ? `✅ ${admin.name ?? admin.email} approved ${member.name ?? member.email ?? "a member"}'s profile — full member access unlocked.`
        : `🔒 ${admin.name ?? admin.email} revoked approval for ${member.name ?? member.email ?? "a member"}'s profile.`,
    );
    // The member THEMSELVES gets the news: welcome push on their devices +
    // a bot DM when they have one — approval unlocks the whole app for them.
    if (approved) {
      await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
        userId,
        title: "Welcome to the club 🎉",
        body: `Hi ${member.name ?? member.email ?? "there"} — your profile is approved, full access is unlocked.`,
        tag: "rc-welcome",
        url: "/dashboard",
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.push.pushToUser, {
        userId,
        title: "Profile review update",
        body: "Your profile approval was revoked — contact an admin for details.",
        tag: "rc-profile",
        url: "/profile",
      });
    }
    if (member.telegramChatId || member.telegramUsername) {
      await telegramDM(
        ctx,
        {
          name: member.name,
          telegramUsername: member.telegramUsername,
          telegramChatId: member.telegramChatId,
        },
        approved
          ? `🎉 Welcome aboard! Your profile is approved — full member access is unlocked.`
          : `ℹ️ Your profile approval was revoked. Please contact an admin for details.`,
        { name: admin.name ?? admin.email },
        "members",
      );
    }
    return { ok: true };
  },
});

// Who still needs profile approval (People page badge + Requests console).
// ONLY explicitly-pending submissions count (profileApproved === false) —
// legacy members without the flag are grandfathered and must not inflate the
// Requests badge with numbers that don't match any actionable list.
export const listUnapprovedProfiles = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // Index lookup: only explicitly-pending submissions are read — never the
    // whole users table (this was one of the biggest reads in the console).
    const rows = await ctx.db
      .query("users")
      .withIndex("by_profileApproved", (q) => q.eq("profileApproved", false))
      .collect();
    return rows
      .filter((u) => !u.isAnonymous && (u.name || u.studentId || u.phone))
      .map((u) => ({
        _id: u._id,
        name: u.name,
        email: u.email,
        studentId: u.studentId,
        phone: u.phone,
        profileApproved: u.profileApproved,
      }));
  },
});

// Member changes their own profile picture directly (always allowed — it's
// their face; admins can still see change history if ever needed).
// Images are compressed client-side; this hard cap (~200 KB of base64 ≈ a
// 256px JPEG) is the safety net — a multi-MB avatar on a user document makes
// every query joining that user heavy and can exceed per-execution read
// limits (this exact issue crashed the Requests console and unit pages).
export const updateMyImage = mutation({
  args: { image: v.string() },
  handler: async (ctx, { image }) => {
    const user = await requireUser(ctx);
    if (user.isAnonymous) throw new ConvexError("Guests cannot change a profile picture — sign in first");
    const clean = image.trim();
    if (!clean) throw new ConvexError("Image URL is empty");
    if (clean.length > 60_000) {
      throw new ConvexError(
        "Image is too large after compression — try a different photo (it will be resized automatically)",
      );
    }
    await touchPatch(ctx, user._id, { image: clean });
    return { ok: true };
  },
});
