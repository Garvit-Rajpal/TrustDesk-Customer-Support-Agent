import { pool } from "../pool.js";
import { Customer } from "../../domain/entities.js";
import type { OrgContext } from "../../domain/orgContext.js";

// Seed-loader only — org_id is always 'org_default' for seed data (no
// OrgContext exists yet at seed time, same reasoning as usersRepo.upsertUser).
export async function upsertCustomer(customer: Customer, orgId = "org_default"): Promise<void> {
  await pool.query(
    `INSERT INTO customers (customer_id, name, email, tier, country, verified, tags, created_at, org_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (customer_id) DO UPDATE SET
       name = EXCLUDED.name, email = EXCLUDED.email, tier = EXCLUDED.tier,
       country = EXCLUDED.country, verified = EXCLUDED.verified,
       tags = EXCLUDED.tags, created_at = EXCLUDED.created_at, org_id = EXCLUDED.org_id`,
    [
      customer.customer_id,
      customer.name,
      customer.email,
      customer.tier,
      customer.country,
      customer.verified,
      JSON.stringify(customer.tags),
      customer.created_at,
      orgId,
    ]
  );
}

// V2-5 (LLD_v2 §6): every repo method takes OrgContext first — a customer_id
// from another org simply doesn't match and returns null, same as "not found".
export async function getCustomerById(ctx: OrgContext, customerId: string): Promise<Customer | null> {
  const { rows } = await pool.query(
    `SELECT customer_id, name, email, tier, country, verified, tags, created_at::text
     FROM customers WHERE customer_id = $1 AND org_id = $2`,
    [customerId, ctx.org_id]
  );
  if (rows.length === 0) return null;
  return Customer.parse(rows[0]);
}

// V2-5 follow-up (POST /customers): the real (non-seed) write path — a
// plain INSERT, not upsertCustomer's seed-only ON CONFLICT upsert.
export async function insertCustomer(ctx: OrgContext, customer: Customer): Promise<Customer> {
  const { rows } = await pool.query(
    `INSERT INTO customers (customer_id, name, email, tier, country, verified, tags, created_at, org_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING customer_id, name, email, tier, country, verified, tags, created_at::text`,
    [
      customer.customer_id,
      customer.name,
      customer.email,
      customer.tier,
      customer.country,
      customer.verified,
      JSON.stringify(customer.tags),
      customer.created_at,
      ctx.org_id,
    ]
  );
  return Customer.parse(rows[0]);
}

export async function listCustomers(ctx: OrgContext): Promise<Customer[]> {
  const { rows } = await pool.query(
    `SELECT customer_id, name, email, tier, country, verified, tags, created_at::text
     FROM customers WHERE org_id = $1 ORDER BY created_at`,
    [ctx.org_id]
  );
  return rows.map((row) => Customer.parse(row));
}
