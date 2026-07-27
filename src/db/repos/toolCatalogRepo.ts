import { pool } from "../pool.js";
import { ToolCatalogEntry } from "../../domain/entities.js";

export async function upsertToolCatalogEntry(tool: ToolCatalogEntry): Promise<void> {
  await pool.query(
    `INSERT INTO tool_catalog
       (tool_name, description, risk_level, requires_human_approval, allowed_categories, required_fields, max_amount_inr)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tool_name) DO UPDATE SET
       description = EXCLUDED.description, risk_level = EXCLUDED.risk_level,
       requires_human_approval = EXCLUDED.requires_human_approval,
       allowed_categories = EXCLUDED.allowed_categories,
       required_fields = EXCLUDED.required_fields, max_amount_inr = EXCLUDED.max_amount_inr`,
    [
      tool.tool_name,
      tool.description,
      tool.risk_level,
      tool.requires_human_approval,
      JSON.stringify(tool.allowed_categories),
      JSON.stringify(tool.required_fields),
      tool.max_amount_inr ?? null,
    ]
  );
}

// requires_human_approval is read ONLY from this table (HLD invariant #1) —
// model output claiming otherwise is ignored by ToolActionService.
export async function getToolCatalogEntry(toolName: string): Promise<ToolCatalogEntry | null> {
  const { rows } = await pool.query(
    `SELECT tool_name, description, risk_level, requires_human_approval,
            allowed_categories, required_fields, max_amount_inr
     FROM tool_catalog WHERE tool_name = $1`,
    [toolName]
  );
  if (rows.length === 0) return null;
  return ToolCatalogEntry.parse(rows[0]);
}

export async function listToolCatalog(): Promise<ToolCatalogEntry[]> {
  const { rows } = await pool.query(
    `SELECT tool_name, description, risk_level, requires_human_approval,
            allowed_categories, required_fields, max_amount_inr
     FROM tool_catalog ORDER BY tool_name`
  );
  return rows.map((row) => ToolCatalogEntry.parse(row));
}
