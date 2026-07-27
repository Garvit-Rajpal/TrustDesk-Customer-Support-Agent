import { z } from "zod";
import { KbDocumentInput } from "./entities.js";

export const IngestRequest = z.object({
  documents: z.array(KbDocumentInput).min(1),
});
export type IngestRequest = z.infer<typeof IngestRequest>;
