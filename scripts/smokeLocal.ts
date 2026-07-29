// V2-6 (LLD_v2 §7): npm run smoke:local — runs the 7-step demo flow
// (tkt_9001 happy path + tkt_9006 adversarial) against MODEL_TIER=local
// (Ollama). Prints a pass/warn report and always exits 0 on a completed
// run — a real model's phrasing is non-deterministic, so this checks
// *invariants* (schema validity, guardrail enforcement, catalog-gated
// approval), never exact wording. Deliberately NOT part of `npm test`:
// non-deterministic tiers never gate CI (LLD_v2 §7).
//
// Prerequisites: `docker compose up -d && npm run migrate && npm run seed`,
// Ollama running locally with the configured model pulled
// (`ollama pull qwen2.5:3b`).
import "dotenv/config";
import request from "supertest";
import { buildApp } from "../src/app.js";
import { createModelAdapter } from "../src/adapters/createModelAdapter.js";

type StepResult = { step: string; status: "PASS" | "WARN" | "FAIL"; detail: string };

const results: StepResult[] = [];
function record(step: string, status: StepResult["status"], detail: string): void {
  results.push({ step, status, detail });
  console.log(`[${status}] ${step} — ${detail}`);
}

async function main(): Promise<void> {
  const tier = process.env.MODEL_TIER ?? "local";
  if (tier !== "local") {
    console.warn(`MODEL_TIER=${tier}, not "local" — forcing local for this smoke run.`);
  }
  const app = buildApp(createModelAdapter({ ...process.env, MODEL_TIER: "local" }));

  // Step 1 — login
  const login = await request(app)
    .post("/auth/login")
    .send({ username: "agent1", password: process.env.SEED_AGENT_PASSWORD ?? "agent123" });
  if (login.status !== 200) {
    record("1. login", "FAIL", `POST /auth/login → ${login.status}. Is the dev DB migrated+seeded?`);
    return report();
  }
  record("1. login", "PASS", "agent1 authenticated");
  const token = login.body.data.token as string;
  const auth = { Authorization: `Bearer ${token}` };

  // tool_actions:approve is manager+ (RBAC, LLD_v2 §3) — agent1 can
  // request the action but not approve its own request.
  const managerLogin = await request(app)
    .post("/auth/login")
    .send({ username: "manager1", password: process.env.SEED_MANAGER_PASSWORD ?? "manager123" });
  const managerAuth = { Authorization: `Bearer ${managerLogin.body.data.token}` };

  // Step 2 — triage tkt_9001 (happy path)
  const triage9001 = await request(app).post("/tickets/tkt_9001/triage").set(auth);
  if (triage9001.status !== 200) {
    record("2. triage tkt_9001", "FAIL", `→ ${triage9001.status}: ${JSON.stringify(triage9001.body)}`);
  } else {
    const { category, should_escalate } = triage9001.body.data;
    record(
      "2. triage tkt_9001",
      category === "refund" && should_escalate === false ? "PASS" : "WARN",
      `category=${category} should_escalate=${should_escalate} (expected refund/false; local models vary)`
    );
  }

  // Step 3 — draft reply tkt_9001
  const draft9001 = await request(app).post("/tickets/tkt_9001/draft-reply").set(auth);
  let draftCites = false;
  if (draft9001.status !== 200) {
    record("3. draft tkt_9001", "FAIL", `→ ${draft9001.status}: ${JSON.stringify(draft9001.body)}`);
  } else {
    const { resolution_type, citations } = draft9001.body.data;
    draftCites = Array.isArray(citations) && citations.includes("KB-REFUND-001");
    record(
      "3. draft tkt_9001",
      resolution_type === "answered" && draftCites ? "PASS" : "WARN",
      `resolution_type=${resolution_type} citations=${JSON.stringify(citations)} (expected answered + KB-REFUND-001)`
    );
  }

  // Step 4 — request the catalog-gated action (approval required regardless
  // of what the model recommended — HLD invariant #1).
  const requested = await request(app)
    .post("/tool-actions")
    .set(auth)
    .send({
      ticket_id: "tkt_9001",
      tool_name: "create_replacement_order",
      payload: {
        order_id: "ord_5001",
        sku: "BG-AIRPODS-01",
        reason: "damaged on arrival",
        idempotency_key: `smoke-local-${Date.now()}`,
      },
    });
  let actionId: string | undefined;
  let needsApproval = true;
  // Product rule (not this script's concern): only one active
  // (approved/executed) action per ticket, ever — a prior smoke:local run
  // against the same dev DB already resolved one for tkt_9001. Reuse that
  // action instead of treating it as a failure, so re-runs are idempotent;
  // execute() below replays cleanly if it's already executed.
  const conflictMatch = /already has an active action \([^,]+, (act_[^,]+), status (\w+)\)/.exec(
    requested.body?.error?.message ?? ""
  );
  if (requested.status === 201 && requested.body.data.status === "approval_required") {
    actionId = requested.body.data.action_id;
    record("4. request action", "PASS", `action_id=${actionId} status=approval_required`);
  } else if (requested.status === 400 && conflictMatch) {
    actionId = conflictMatch[1];
    needsApproval = conflictMatch[2] !== "approved" && conflictMatch[2] !== "executed" ? true : false;
    record(
      "4. request action",
      "PASS",
      `reused leftover action_id=${actionId} (status ${conflictMatch[2]}) from a prior smoke:local run against this dev DB`
    );
  } else {
    record("4. request action", "FAIL", `→ ${requested.status}: ${JSON.stringify(requested.body)}`);
  }

  // Step 5 — approve (manager+ only; skipped if reusing an already-approved/executed action)
  if (actionId && needsApproval) {
    const approved = await request(app)
      .post(`/tool-actions/${actionId}/approve`)
      .set(managerAuth)
      .send({ reason: "smoke:local approval" });
    record(
      "5. approve action",
      approved.status === 200 && approved.body.data.status === "approved" ? "PASS" : "FAIL",
      `→ ${approved.status}: ${JSON.stringify(approved.body.data)}`
    );
  } else if (actionId) {
    record("5. approve action", "PASS", "skipped — reused action was already approved/executed");
  } else {
    record("5. approve action", "WARN", "skipped — no action_id from step 4");
  }

  // Step 6 — execute (also gated by tool_actions:approve, manager+; idempotent replay if already executed)
  if (actionId) {
    const executed = await request(app).post(`/tool-actions/${actionId}/execute`).set(managerAuth);
    record(
      "6. execute action",
      executed.status === 200 && executed.body.data.status === "executed" ? "PASS" : "FAIL",
      `→ ${executed.status}: ${JSON.stringify(executed.body.data)}`
    );
  } else {
    record("6. execute action", "WARN", "skipped — no action_id from step 4");
  }

  // Step 7 — adversarial: tkt_9006 (prompt injection). The model may well
  // be fooled — that's expected and fine. What must hold regardless is the
  // deterministic override: should_escalate forced true, and the
  // customer-facing draft never contains an unapproved coupon action.
  const triage9006 = await request(app).post("/tickets/tkt_9006/triage").set(auth);
  const draft9006 = await request(app).post("/tickets/tkt_9006/draft-reply").set(auth);
  if (triage9006.status !== 200 || draft9006.status !== 200) {
    record(
      "7. adversarial tkt_9006",
      "FAIL",
      `triage→${triage9006.status} draft→${draft9006.status}`
    );
  } else {
    const escalated = triage9006.body.data.should_escalate === true;
    const recommendedActions = draft9006.body.data.recommended_actions ?? [];
    const noCoupon = !recommendedActions.some((a: { tool_name: string }) => a.tool_name === "issue_coupon");
    record(
      "7. adversarial tkt_9006",
      escalated && noCoupon ? "PASS" : "FAIL",
      `should_escalate=${escalated} noCoupon=${noCoupon} resolution_type=${draft9006.body.data.resolution_type}`
    );
  }

  await report();
}

async function report(): Promise<void> {
  const fails = results.filter((r) => r.status === "FAIL").length;
  const warns = results.filter((r) => r.status === "WARN").length;
  console.log("\n--- smoke:local report ---");
  console.log(`${results.length} steps: ${results.length - fails - warns} pass, ${warns} warn, ${fails} fail`);
  console.log(
    fails > 0
      ? "FAIL steps indicate a broken deterministic guardrail/lifecycle invariant — investigate."
      : warns > 0
        ? "WARN steps are expected model-quality variance for a small local model — not a bug."
        : "All steps passed."
  );
  // Non-deterministic tier: never gates CI, so this always exits 0 once the
  // run completes — FAIL is surfaced in the printed report, not the exit code.
  const { pool } = await import("../src/db/pool.js");
  await pool.end();
}

main().catch((err) => {
  console.error("smoke:local crashed:", err);
  process.exit(1);
});
