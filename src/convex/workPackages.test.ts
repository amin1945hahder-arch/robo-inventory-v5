// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The OPENPROJECT-STYLE RULES the work-package server now enforces. These are
 * the behaviours a user notices: a status the workflow forbids is refused, a
 * blocked package cannot be closed, the progress mode decides how % Complete
 * and Remaining work are derived, an automatic package is re-planned from its
 * predecessors, and a custom field rejects a value its format does not allow.
 *
 * The Convex runtime is replaced the same way src/convex/settings.test.ts does
 * it: the auth seam is stubbed, query()/mutation() pass their definitions
 * straight through, and the db is a tiny in-memory stand-in that implements
 * exactly the calls these handlers make (get / query.withIndex / collect /
 * unique / insert / patch / delete).
 */

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: async (ctx: TestCtx) => (await ctx.auth.getUserIdentity())?.subject ?? null,
}));

vi.mock("./sync", () => ({ touchPatch: vi.fn(), recordTombstone: vi.fn() }));
vi.mock("./notify", () => ({ notifyTelegram: vi.fn(), telegramDM: vi.fn(), telegramGroup: vi.fn() }));

vi.mock("./_generated/server", () => ({
  query: (def: unknown) => def,
  mutation: (def: unknown) => def,
  action: (def: unknown) => def,
  internalQuery: (def: unknown) => def,
  internalMutation: (def: unknown) => def,
}));

vi.mock("./_generated/api", () => ({ api: {}, internal: {} }));

const wp = await import("./workPackages");

// ── the in-memory db ─────────────────────────────────────────────────────────

type Row = { _id: string } & Record<string, unknown>;

class Q {
  db: Db;
  table: string;
  conds: [string, unknown][];

  constructor(db: Db, table: string, conds: [string, unknown][]) {
    this.db = db;
    this.table = table;
    this.conds = conds;
  }

  withIndex(_name: string, cb: (q: { eq: (f: string, v: unknown) => unknown }) => unknown) {
    const conds: [string, unknown][] = [];
    const q = {
      eq: (f: string, v: unknown) => {
        conds.push([f, v]);
        return q;
      },
    };
    cb(q);
    return new Q(this.db, this.table, conds);
  }

  private rows() {
    return this.db
      .rows(this.table)
      .filter((r) => this.conds.every(([f, v]) => r[f] === v));
  }

  async collect() {
    return this.rows().map((r) => ({ ...r }));
  }

  async unique() {
    const rows = this.rows();
    return rows.length > 0 ? { ...rows[0] } : null;
  }
}

class Db {
  private tables = new Map<string, Row[]>();
  private seq = 0;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table) as Row[];
  }

  insert(table: string, doc: Record<string, unknown>): string {
    this.seq += 1;
    const id = `${table}:${this.seq}`;
    this.rows(table).push({ _id: id, ...doc });
    return id;
  }

  get(id: string): Row | null {
    for (const rows of this.tables.values()) {
      const row = rows.find((r) => r._id === id);
      if (row) return row;
    }
    return null;
  }

  patch(id: string, patch: Record<string, unknown>) {
    const row = this.get(id);
    if (!row) throw new Error(`no row ${id}`);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete row[k];
      else row[k] = v;
    }
  }

  delete(id: string) {
    for (const rows of this.tables.values()) {
      const i = rows.findIndex((r) => r._id === id);
      if (i >= 0) {
        rows.splice(i, 1);
        return;
      }
    }
  }

  query(table: string) {
    return new Q(this, table, []);
  }
}

type TestCtx = {
  db: Db;
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
};

function handlerOf<A, R>(fn: unknown): (ctx: TestCtx, args: A) => Promise<R> {
  return (fn as { handler: (ctx: TestCtx, args: A) => Promise<R> }).handler;
}

// ── seed ─────────────────────────────────────────────────────────────────────

const ADMIN = "users:admin";
const LEADER = "users:leader";
const PROJECT = "projects:1";

let db: Db;
let ctx: TestCtx;

/** A project with a leader member and an admin — enough for every guard. */
function seed() {
  db = new Db();
  ctx = { db, auth: { getUserIdentity: async () => ({ subject: LEADER }) } };
  db.insert("users", {
    _id: ADMIN,
    name: "Ada",
    role: "admin",
    profileApproved: true,
  });
  db.insert("users", {
    _id: LEADER,
    name: "Bo",
    role: "member",
    profileApproved: true,
  });
  db.insert("projects", { _id: PROJECT, name: "Rover", ownerId: LEADER, deleted: false });
  db.insert("projectMembers", {
    projectId: PROJECT,
    userId: LEADER,
    role: "leader",
    joinedAt: 1,
  });
}

const create = () => handlerOf<Record<string, unknown>, string>(wp.create);
const update = () => handlerOf<Record<string, unknown>, void>(wp.update);
const addRelation = () => handlerOf<Record<string, unknown>, void>(wp.addRelation);
const saveSettings = () => handlerOf<Record<string, unknown>, unknown>(wp.saveSettings);
const upsertCustomField = () =>
  handlerOf<Record<string, unknown>, string>(wp.upsertCustomField);

async function newTask(over: Record<string, unknown> = {}) {
  return create()(ctx, {
    projectId: PROJECT,
    type: "task",
    subject: "Wire the driver",
    ...over,
  });
}

beforeEach(seed);

// ── workflow ────────────────────────────────────────────────────────────────

describe("workflow gating", () => {
  it("refuses a status change the project workflow does not allow", async () => {
    await saveSettings()(ctx, {
      projectId: PROJECT,
      progressMode: "work_based",
      scheduling: "manual",
      workingDaysOnly: true,
      workflow: [{ type: "task", from: "new", to: "in_progress" }],
    });

    const id = await newTask();
    await expect(update()(ctx, { id, status: "closed" })).rejects.toThrow(
      /workflow does not allow/,
    );
    // The allowed move still goes through.
    await update()(ctx, { id, status: "in_progress" });
    expect(db.get(id)?.status).toBe("in_progress");
  });

  it("gates the status a package is CREATED in", async () => {
    await saveSettings()(ctx, {
      projectId: PROJECT,
      progressMode: "work_based",
      scheduling: "manual",
      workingDaysOnly: true,
      workflow: [{ type: "task", from: "new", to: "in_progress" }],
    });
    await expect(newTask({ status: "closed" })).rejects.toThrow(/workflow does not allow/);
  });

  it("is permissive while no workflow is configured", async () => {
    const id = await newTask();
    await update()(ctx, { id, status: "closed" });
    expect(db.get(id)?.status).toBe("closed");
  });
});

// ── blockers ────────────────────────────────────────────────────────────────

describe("blocked work packages", () => {
  it("cannot be closed while a package that blocks it is open", async () => {
    const blocker = await newTask({ subject: "Order the motor" });
    const blocked = await newTask({ subject: "Fit the motor" });
    await addRelation()(ctx, { fromId: blocker, toId: blocked, type: "blocks" });

    await expect(update()(ctx, { id: blocked, status: "closed" })).rejects.toThrow(
      /Blocked by/,
    );
    expect(db.get(blocked)?.status).toBe("new");

    // Closing the blocker unblocks it.
    await update()(ctx, { id: blocker, status: "closed" });
    await update()(ctx, { id: blocked, status: "closed" });
    expect(db.get(blocked)?.status).toBe("closed");
  });
});

// ── progress modes ──────────────────────────────────────────────────────────

describe("progress calculation modes", () => {
  it("status-based: the status drives % Complete and Remaining work", async () => {
    await saveSettings()(ctx, {
      projectId: PROJECT,
      progressMode: "status_based",
      scheduling: "manual",
      workingDaysOnly: true,
      workflow: [],
    });
    const id = await newTask({ estimatedHours: 10 });
    // New = 0% → 10h remaining.
    expect(db.get(id)?.doneRatio).toBe(0);
    expect(db.get(id)?.remainingHours).toBe(10);

    // Developed = 60% → 4h remaining, derived from the estimate.
    await update()(ctx, { id, status: "developed" });
    expect(db.get(id)?.doneRatio).toBe(60);
    expect(db.get(id)?.remainingHours).toBe(4);
  });

  it("work-based: Work and Remaining work derive % Complete", async () => {
    const id = await newTask({ estimatedHours: 8 });
    await update()(ctx, { id, remainingHours: 4 });
    expect(db.get(id)?.doneRatio).toBe(50);
  });

  it("work-based: % Complete and Work derive Remaining work", async () => {
    const id = await newTask({ estimatedHours: 12 });
    await update()(ctx, { id, doneRatio: 25 });
    expect(db.get(id)?.remainingHours).toBe(9);
  });
});

// ── automatic scheduling ────────────────────────────────────────────────────

describe("automatic scheduling", () => {
  const MON = new Date(2026, 4, 4).getTime();
  const FRI = new Date(2026, 4, 8).getTime();

  it("starts a successor on the next working day after its predecessor", async () => {
    const pred = await newTask({
      subject: "Predecessor",
      scheduling: "automatic",
      startAt: MON,
      finishAt: FRI,
    });
    const succ = await newTask({ subject: "Successor", scheduling: "automatic" });
    await addRelation()(ctx, { fromId: pred, toId: succ, type: "precedes" });

    // Friday + 1 working day = Monday.
    expect(db.get(succ)?.startAt).toBe(new Date(2026, 4, 11).getTime());
  });

  it("re-plans the successor when the predecessor moves", async () => {
    const pred = await newTask({
      subject: "Predecessor",
      scheduling: "automatic",
      startAt: MON,
      finishAt: FRI,
    });
    const succ = await newTask({ subject: "Successor", scheduling: "automatic" });
    await addRelation()(ctx, { fromId: pred, toId: succ, type: "precedes" });

    // Pull the predecessor in to Wednesday → the successor follows on Thursday.
    await update()(ctx, { id: pred, finishAt: new Date(2026, 4, 6).getTime() });
    expect(db.get(succ)?.startAt).toBe(new Date(2026, 4, 7).getTime());
  });

  it("leaves a MANUAL package exactly where the user put it", async () => {
    const pred = await newTask({
      subject: "Predecessor",
      scheduling: "automatic",
      startAt: MON,
      finishAt: FRI,
    });
    const manual = await newTask({ subject: "Manual", scheduling: "manual", startAt: MON });
    await addRelation()(ctx, { fromId: pred, toId: manual, type: "precedes" });
    expect(db.get(manual)?.startAt).toBe(MON);
  });

  it("spans an automatic parent across its children", async () => {
    const parent = await newTask({ subject: "Phase", type: "phase", scheduling: "automatic" });
    await newTask({ subject: "Alpha", parentId: parent, startAt: MON, finishAt: FRI });
    await newTask({
      subject: "Bravo",
      parentId: parent,
      startAt: new Date(2026, 4, 11).getTime(),
    });

    expect(db.get(parent)?.startAt).toBe(MON);
    expect(db.get(parent)?.finishAt).toBe(new Date(2026, 4, 11).getTime());
  });
});

// ── custom fields ───────────────────────────────────────────────────────────

describe("custom fields", () => {
  it("keeps a value whose format matches and rejects one that does not", async () => {
    const fieldId = await upsertCustomField()(ctx, {
      projectId: PROJECT,
      name: "Test rig",
      fieldFormat: "int",
      types: [],
    });

    await expect(newTask({ customFields: { [fieldId]: 1.5 } })).rejects.toThrow(
      /whole number/,
    );

    await upsertCustomField()(ctx, {
      projectId: PROJECT,
      id: fieldId,
      name: "Test rig",
      fieldFormat: "list",
      possibleValues: ["Bench", "Field"],
    });
    await expect(newTask({ customFields: { [fieldId]: "Roof" } })).rejects.toThrow(
      /listed options/,
    );

    const ok = await newTask({ customFields: { [fieldId]: "Bench" } });
    expect(db.get(ok)?.customFields).toEqual({ [fieldId]: "Bench" });
  });
});
