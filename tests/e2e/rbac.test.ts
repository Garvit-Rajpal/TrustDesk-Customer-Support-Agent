// V2-2 (LLD_v2 §3/§9, ADR-9): "route × role permission table test; 403
// envelopes; invite creates user in inviter's org." Table-driven over every
// permission-gated route × every role: a role NOT in that permission's
// allowlist must get exactly 403 FORBIDDEN before any business logic runs;
// a role that IS allowed must get anything else (400/404/200/201 — the
// route's ordinary behavior for a deliberately minimal/invalid request),
// proving the permission check let it through rather than coincidentally
// also returning 403 for an unrelated reason.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

type Role = "agent" | "manager" | "admin";
const ROLES: Role[] = ["agent", "manager", "admin"];
const CREDENTIALS: Record<Role, { username: string; password: string }> = {
  agent: { username: "agent1", password: "agent123" },
  manager: { username: "manager1", password: "manager123" },
  admin: { username: "admin1", password: "admin123" },
};

interface RouteCase {
  name: string;
  allowedRoles: Role[];
  request: (token: string) => request.Test;
}

const ROUTE_CASES: RouteCase[] = [
  {
    name: "GET /tickets",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) => request(app).get("/tickets").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "POST /tickets/:id/triage",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app).post("/tickets/tkt_does_not_exist/triage").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "POST /tickets/:id/draft-reply",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app).post("/tickets/tkt_does_not_exist/draft-reply").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "GET /tickets/:id/runs/:runId/events",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app)
        .get("/tickets/tkt_does_not_exist/runs/run_does_not_exist/events")
        .set("Authorization", `Bearer ${t}`),
  },
  {
    name: "POST /tool-actions",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app)
        .post("/tool-actions")
        .set("Authorization", `Bearer ${t}`)
        .send({ ticket_id: "tkt_does_not_exist", tool_name: "nope", payload: {} }),
  },
  {
    name: "POST /tool-actions/:id/approve",
    allowedRoles: ["manager", "admin"],
    request: (t) =>
      request(app)
        .post("/tool-actions/act_does_not_exist/approve")
        .set("Authorization", `Bearer ${t}`)
        .send({ reason: "x" }),
  },
  {
    name: "POST /tool-actions/:id/reject",
    allowedRoles: ["manager", "admin"],
    request: (t) =>
      request(app)
        .post("/tool-actions/act_does_not_exist/reject")
        .set("Authorization", `Bearer ${t}`)
        .send({ reason: "x" }),
  },
  {
    name: "POST /tool-actions/:id/execute",
    allowedRoles: ["manager", "admin"],
    request: (t) =>
      request(app).post("/tool-actions/act_does_not_exist/execute").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "GET /agent-runs/:runId",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) => request(app).get("/agent-runs/run_does_not_exist").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "GET /documents",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) => request(app).get("/documents").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "GET /documents/:docId",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) => request(app).get("/documents/KB-DOES-NOT-EXIST").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "POST /documents/ingest",
    allowedRoles: ["admin"],
    request: (t) => request(app).post("/documents/ingest").set("Authorization", `Bearer ${t}`).send({}),
  },
  {
    name: "POST /eval-runs",
    allowedRoles: ["admin"],
    request: (t) =>
      request(app).post("/eval-runs").set("Authorization", `Bearer ${t}`).send({ case_ids: ["nope"] }),
  },
  {
    name: "GET /eval-runs/:id",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app).get("/eval-runs/eval_run_does_not_exist").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "POST /users/invite",
    allowedRoles: ["admin"],
    request: (t) => request(app).post("/users/invite").set("Authorization", `Bearer ${t}`).send({}),
  },
  {
    name: "POST /drafts/:id/feedback",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app)
        .post("/drafts/draft_does_not_exist/feedback")
        .set("Authorization", `Bearer ${t}`)
        .send({ rating: 5 }),
  },
  {
    name: "GET /metrics/agent-quality",
    allowedRoles: ["manager", "admin"],
    request: (t) => request(app).get("/metrics/agent-quality").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "GET /tickets/:id/messages",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app).get("/tickets/tkt_does_not_exist/messages").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "POST /tickets/:id/messages/simulate-inbound",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app)
        .post("/tickets/tkt_does_not_exist/messages/simulate-inbound")
        .set("Authorization", `Bearer ${t}`)
        .send({ body: "hi" }),
  },
  {
    name: "POST /drafts/:id/send",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app).post("/drafts/draft_does_not_exist/send").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "POST /tickets/:id/resolve",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app).post("/tickets/tkt_does_not_exist/resolve").set("Authorization", `Bearer ${t}`),
  },
  {
    name: "POST /tickets/:id/close",
    allowedRoles: ["agent", "manager", "admin"],
    request: (t) =>
      request(app).post("/tickets/tkt_does_not_exist/close").set("Authorization", `Bearer ${t}`),
  },
];

// Single top-level beforeAll/afterAll: this file has two logical groups of
// tests (permission matrix, invite-flow specifics) but only one pool.end()
// may ever run per test file (a second call throws "Called end on pool
// more than once" — the same gotcha documented in docs/PROGRESS.md).
beforeAll(async () => {
  await truncateAll();
  await runSeed();
});

afterAll(async () => {
  await pool.end();
});

describe("RBAC — route × role permission matrix (LLD_v2 §3)", () => {
  const tokens: Record<Role, string> = { agent: "", manager: "", admin: "" };

  beforeAll(async () => {
    for (const role of ROLES) {
      const login = await request(app).post("/auth/login").send(CREDENTIALS[role]);
      tokens[role] = login.body.data.token;
    }
  });

  for (const routeCase of ROUTE_CASES) {
    for (const role of ROLES) {
      const allowed = routeCase.allowedRoles.includes(role);
      it(`${routeCase.name} — ${role} is ${allowed ? "allowed" : "forbidden"}`, async () => {
        const res = await routeCase.request(tokens[role]);
        if (allowed) {
          expect(res.status).not.toBe(403);
        } else {
          expect(res.status).toBe(403);
          expect(res.body).toEqual({
            error: {
              code: "FORBIDDEN",
              message: expect.any(String),
              details: undefined,
            },
          });
        }
      });
    }
  }

  it("401s (not 403) when there's no token at all — auth runs before permissions", async () => {
    const res = await request(app).post("/users/invite").send({});
    expect(res.status).toBe(401);
  });
});

describe("POST /users/invite (LLD_v2 §3/§9, ADR-9)", () => {
  let adminToken: string;
  let agentToken: string;

  beforeAll(async () => {
    const adminLogin = await request(app)
      .post("/auth/login")
      .send({ username: "admin1", password: "admin123" });
    adminToken = adminLogin.body.data.token;
    const agentLogin = await request(app)
      .post("/auth/login")
      .send({ username: "agent1", password: "agent123" });
    agentToken = agentLogin.body.data.token;
  });

  it("creates a user the invited role can immediately log in as", async () => {
    const invite = await request(app)
      .post("/users/invite")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ username: "manager2", password: "manager2pw", display_name: "New Manager", role: "manager" });

    expect(invite.status).toBe(201);
    expect(invite.body.data).toEqual({
      user_id: expect.stringMatching(/^usr_/),
      username: "manager2",
      display_name: "New Manager",
      role: "manager",
    });

    const login = await request(app)
      .post("/auth/login")
      .send({ username: "manager2", password: "manager2pw" });
    expect(login.status).toBe(200);
    expect(login.body.data.user.display_name).toBe("New Manager");
  });

  it("defaults role to 'agent' when omitted", async () => {
    const invite = await request(app)
      .post("/users/invite")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ username: "agent2", password: "agent2pwpw", display_name: "New Agent" });

    expect(invite.status).toBe(201);
    expect(invite.body.data.role).toBe("agent");
  });

  it("409s on a duplicate username", async () => {
    const res = await request(app)
      .post("/users/invite")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ username: "agent1", password: "whatever1", display_name: "Duplicate" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("403s for a non-admin, before validation even runs", async () => {
    const res = await request(app)
      .post("/users/invite")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ username: "", password: "" });
    expect(res.status).toBe(403);
  });

  it("400s on an invalid payload (short password)", async () => {
    const res = await request(app)
      .post("/users/invite")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ username: "shortpw", password: "short", display_name: "X" });
    expect(res.status).toBe(400);
  });
});
