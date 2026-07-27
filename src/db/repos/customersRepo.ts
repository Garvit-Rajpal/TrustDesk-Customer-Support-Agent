import { pool } from "../pool.js";
import { Customer } from "../../domain/entities.js";

export async function upsertCustomer(customer: Customer): Promise<void> {
  await pool.query(
    `INSERT INTO customers (customer_id, name, email, tier, country, verified, tags, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (customer_id) DO UPDATE SET
       name = EXCLUDED.name, email = EXCLUDED.email, tier = EXCLUDED.tier,
       country = EXCLUDED.country, verified = EXCLUDED.verified,
       tags = EXCLUDED.tags, created_at = EXCLUDED.created_at`,
    [
      customer.customer_id,
      customer.name,
      customer.email,
      customer.tier,
      customer.country,
      customer.verified,
      JSON.stringify(customer.tags),
      customer.created_at,
    ]
  );
}

export async function getCustomerById(customerId: string): Promise<Customer | null> {
  const { rows } = await pool.query(
    `SELECT customer_id, name, email, tier, country, verified, tags, created_at::text
     FROM customers WHERE customer_id = $1`,
    [customerId]
  );
  if (rows.length === 0) return null;
  return Customer.parse(rows[0]);
}
