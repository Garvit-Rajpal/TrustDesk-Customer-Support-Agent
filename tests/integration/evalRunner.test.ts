// Milestone 8: EvalRunner runs the SAME production triage+draft pipeline
// (LLD §7) — this test proves it end-to-end against the app's own default
// mock scenarios and checks the resulting numbers against a hand-computed
// expectation (see docs/PROGRESS.md for the full case-by-case derivation).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { runEvalSet, loadEvalCases } from "../../src/services/evalRunner.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "../../src/adapters/defaultMockScenarios.js";
import { getEvalRunById } from "../../src/db/repos/evalRunsRepo.js";
import { listRunEventsByRunId } from "../../src/db/repos/runEventsRepo.js";
import { ORG_DEFAULT } from "../helpers/org.js";

describe("EvalRunner", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("loads all 8 seed eval cases from data/eval_cases.jsonl", async () => {
    const cases = await loadEvalCases();
    expect(cases).toHaveLength(8);
    expect(cases.map((c) => c.case_id)).toEqual([
      "eval_001",
      "eval_002",
      "eval_003",
      "eval_004",
      "eval_005",
      "eval_006",
      "eval_007",
      "eval_008",
    ]);
  });

  it("runs all 8 cases and produces the hand-computed metrics for the default demo scenarios", async () => {
    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    const report = await runEvalSet(adapter);

    expect(report.total_cases).toBe(8);
    expect(report.case_results).toHaveLength(8);

    // Every triage category matches expected (hand-checked against
    // defaultMockScenarios.ts vs eval_cases.jsonl).
    expect(report.metrics.triage_accuracy).toBe(1);

    // eval_006 and eval_007's mock drafts are deliberately adversarial and
    // get fail-closed (citations wiped to []) — 6/8 cases retain their
    // required citation, 2 don't. This is an intentional trade-off: the
    // demo proves the guardrail works rather than inflating this metric.
    expect(report.metrics.citation_coverage).toBe(0.75);

    // No disallowed action ever reaches recommended_actions — guardrails
    // strip them even in the two adversarial cases.
    expect(report.metrics.unsafe_action_block_rate).toBe(1);

    // Every escalation-required case is either flagged by triage's
    // deterministic override or resolves the draft to "escalated".
    expect(report.metrics.escalation_accuracy).toBe(1);
  });

  it("persists the eval_run row, fetchable by id", async () => {
    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    const report = await runEvalSet(adapter);

    const stored = await getEvalRunById(ORG_DEFAULT, report.eval_run_id);
    expect(stored).not.toBeNull();
    expect(stored?.total_cases).toBe(8);
    expect(stored?.metrics).toEqual(report.metrics);
    expect(stored?.case_results).toHaveLength(8);
    expect(stored?.completed_at).not.toBeNull();
  });

  it("runs a selected subset of cases via case_ids", async () => {
    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    const report = await runEvalSet(adapter, ["eval_001", "eval_003"]);

    expect(report.total_cases).toBe(2);
    expect(report.case_results.map((r) => r.case_id).sort()).toEqual(["eval_001", "eval_003"]);
  });

  it("records each case's triage_run_id and draft_run_id for drill-down", async () => {
    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    const report = await runEvalSet(adapter, ["eval_001"]);

    const result = report.case_results[0]!;
    expect(result.triage_run_id).toMatch(/^run_/);
    expect(result.draft_run_id).toMatch(/^run_/);
  });

  // V4-6 (LLD_v4 §4, HLD_v4 ADR-20): eval-run streaming — every case emits
  // a started/completed pair under the eval_run_id, so a client can
  // subscribe (GET /eval-runs/:runId/events) before the run finishes.
  it("emits a started/completed eval_case event pair per case, in order, under the eval_run_id", async () => {
    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    const report = await runEvalSet(adapter, ["eval_001", "eval_003"]);

    const events = await listRunEventsByRunId(report.eval_run_id);
    expect(events).toHaveLength(4);
    expect(events.map((e) => [e.stage, e.status])).toEqual([
      ["eval_case", "started"],
      ["eval_case", "completed"],
      ["eval_case", "started"],
      ["eval_case", "completed"],
    ]);
    expect((events[0]!.summary as { case_id: string; counts: { index: number; total: number } }).case_id).toBe(
      "eval_001"
    );
    expect((events[0]!.summary as { counts: { index: number; total: number } }).counts).toEqual({
      index: 1,
      total: 2,
    });
    expect((events[2]!.summary as { case_id: string }).case_id).toBe("eval_003");
    expect((events[3]!.summary as { counts: { index: number; total: number } }).counts).toEqual({
      index: 2,
      total: 2,
    });
  });

  it("accepts a pre-minted eval_run_id and reuses it instead of generating its own", async () => {
    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    const preMinted = "eval_run_pre_minted_test_id";
    const report = await runEvalSet(adapter, ["eval_001"], preMinted);

    expect(report.eval_run_id).toBe(preMinted);
    const stored = await getEvalRunById(ORG_DEFAULT, preMinted);
    expect(stored).not.toBeNull();
  });
});
