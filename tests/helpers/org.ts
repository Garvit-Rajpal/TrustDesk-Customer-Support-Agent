import type { OrgContext } from "../../src/domain/orgContext.js";

// V2-5: every seed fixture (tkt_9001, cus_1001, KB-REFUND-001, ...) lives
// under org_default — this is the context every pre-V2-5 integration test
// now needs to pass into org-scoped repo/service calls.
export const ORG_DEFAULT: OrgContext = { org_id: "org_default" };
