import { Router } from "express";
import { CreateCustomerRequest } from "../../domain/customerTypes.js";
import { newCustomerId } from "../../domain/ids.js";
import { insertCustomer, listCustomers } from "../../db/repos/customersRepo.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

export const customersRouter = Router();

// V2-5 follow-up: lets the "new ticket" form offer existing customers
// without the caller needing to know an ID up front.
customersRouter.get("/", requirePermission("customers:view"), async (req, res, next) => {
  try {
    const customers = await listCustomers(req.orgContext!);
    res.status(200).json({ data: { customers } });
  } catch (err) {
    next(err);
  }
});

// V2-5 follow-up: the write path missing since v1 — customers previously
// only ever came from seed data, which left a freshly onboarded org (V2-5)
// with no way to create one, and therefore no way to create a ticket either.
customersRouter.post("/", requirePermission("customers:write"), async (req, res, next) => {
  try {
    const parsed = CreateCustomerRequest.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "VALIDATION_ERROR", "Invalid customer payload", parsed.error.flatten());
      return;
    }

    const customer = await insertCustomer(req.orgContext!, {
      customer_id: newCustomerId(),
      ...parsed.data,
      created_at: new Date().toISOString(),
    });

    res.status(201).json({ data: customer });
  } catch (err) {
    next(err);
  }
});
