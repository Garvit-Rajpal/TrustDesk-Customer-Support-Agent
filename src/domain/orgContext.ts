// V2-5 (LLD_v2 §6): "every repository method takes an OrgContext as its
// first argument — there is no unscoped variant exported." A single-field
// wrapper rather than a bare string so a repo signature like
// `listTickets(ctx: OrgContext, filters)` can never be confused with a
// stray string parameter at a call site.
export interface OrgContext {
  org_id: string;
}
