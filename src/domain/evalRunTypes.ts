import { z } from "zod";

// LLD §4.12: default is all cases.
export const RunEvalRequest = z.object({
  case_ids: z.array(z.string()).optional(),
});
export type RunEvalRequest = z.infer<typeof RunEvalRequest>;
