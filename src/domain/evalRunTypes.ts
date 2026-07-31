import { z } from "zod";

// LLD §4.12: default is all cases. V4-6 (LLD_v4 §4): eval_run_id is
// optional — when supplied (from a prior POST /eval-runs/start), the
// runner reuses that ID instead of minting its own, so a client can
// subscribe to GET /eval-runs/:runId/events before the run starts.
export const RunEvalRequest = z.object({
  case_ids: z.array(z.string()).optional(),
  eval_run_id: z.string().optional(),
});
export type RunEvalRequest = z.infer<typeof RunEvalRequest>;
