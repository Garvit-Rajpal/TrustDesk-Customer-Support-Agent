import { z } from "zod";
import { Vertical } from "./schemas.js";

// V2-5 (LLD_v2 §6): "POST /orgs (admin) { name, vertical } -> creates org +
// stamps the vertical's policy pack + creates the org's first admin
// invite." Admin invite credentials ride along on the request since there's
// no cross-org platform-admin flow yet (v3) to otherwise seed one.
export const CreateOrgRequest = z.object({
  name: z.string().min(1),
  vertical: Vertical,
  admin_username: z.string().min(1),
  admin_password: z.string().min(8),
  admin_display_name: z.string().min(1),
});
export type CreateOrgRequest = z.infer<typeof CreateOrgRequest>;

// V3-6 (LLD_v3 §4): both flags optional and independently settable.
export const UpdateConsentRequest = z.object({
  allow_platform_support: z.boolean().optional(),
  allow_platform_metrics: z.boolean().optional(),
});
export type UpdateConsentRequest = z.infer<typeof UpdateConsentRequest>;
