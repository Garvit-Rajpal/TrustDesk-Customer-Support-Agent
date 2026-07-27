import { pool } from "../pool.js";
import { Order } from "../../domain/entities.js";

export async function upsertOrder(order: Order): Promise<void> {
  await pool.query(
    `INSERT INTO orders (order_id, customer_id, status, placed_at, delivered_at,
       eligible_return_until, total, currency, payment_status, tracking_number, items)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (order_id) DO UPDATE SET
       customer_id = EXCLUDED.customer_id, status = EXCLUDED.status,
       placed_at = EXCLUDED.placed_at, delivered_at = EXCLUDED.delivered_at,
       eligible_return_until = EXCLUDED.eligible_return_until, total = EXCLUDED.total,
       currency = EXCLUDED.currency, payment_status = EXCLUDED.payment_status,
       tracking_number = EXCLUDED.tracking_number, items = EXCLUDED.items`,
    [
      order.order_id,
      order.customer_id,
      order.status,
      order.placed_at,
      order.delivered_at,
      order.eligible_return_until,
      order.total,
      order.currency,
      order.payment_status,
      order.tracking_number,
      JSON.stringify(order.items),
    ]
  );
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  const { rows } = await pool.query(
    `SELECT order_id, customer_id, status, placed_at::text, delivered_at::text,
            eligible_return_until::text, total::float8 AS total, currency,
            payment_status, tracking_number, items
     FROM orders WHERE order_id = $1`,
    [orderId]
  );
  if (rows.length === 0) return null;
  return Order.parse(rows[0]);
}
