import { Pool } from "pg";

const globalPool = globalThis as typeof globalThis & {
  __prismaticaWebsiteVisitPool?: Pool;
};

const pool = globalPool.__prismaticaWebsiteVisitPool ?? new Pool({ connectionString: process.env.DATABASE_URL });
globalPool.__prismaticaWebsiteVisitPool = pool;

let schemaReady: Promise<void> | null = null;

async function ensureWebsiteVisitSchema() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to store website visits.");
  }

  schemaReady ??= (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS website_visit_counter (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        visits BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query("INSERT INTO website_visit_counter (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  await schemaReady;
}

export async function recordWebsiteVisit() {
  await ensureWebsiteVisitSchema();
  const result = await pool.query(
    "UPDATE website_visit_counter SET visits = visits + 1, updated_at = NOW() WHERE id = 1 RETURNING visits"
  );
  return Number(result.rows[0]?.visits ?? 0);
}

export async function getWebsiteVisitCountForAdmin(userId: string) {
  await ensureWebsiteVisitSchema();
  const result = await pool.query(
    `
      SELECT counter.visits
      FROM website_visit_counter AS counter
      WHERE counter.id = 1
        AND EXISTS (SELECT 1 FROM app_users WHERE id = $1 AND is_admin = TRUE)
    `,
    [userId]
  );
  return result.rows.length > 0 ? Number(result.rows[0].visits) : null;
}