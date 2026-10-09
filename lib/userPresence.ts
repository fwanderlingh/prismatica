import { Pool } from "pg";

export const presenceWindowSeconds = 300;

export type ConnectedUser = {
  id: string;
  name: string;
  email: string;
  sessions: number;
  lastSeenAt: string;
};

export type UserPresenceSnapshot = {
  users: ConnectedUser[];
  checkedAt: string;
  windowSeconds: number;
};

const globalPool = globalThis as typeof globalThis & { __prismaticaPresencePool?: Pool };
const pool = globalPool.__prismaticaPresencePool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3_000,
  query_timeout: 5_000
});
globalPool.__prismaticaPresencePool = pool;
let schemaReady: Promise<void> | null = null;

async function ensureSchema() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to track connected users.");
  schemaReady ??= (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS website_user_presence (
      session_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query("CREATE INDEX IF NOT EXISTS website_user_presence_last_seen ON website_user_presence (last_seen_at)");
  })().catch(error => { schemaReady = null; throw error; });
  await schemaReady;
}

export async function recordUserPresence(userId: string, sessionKey: string) {
  await ensureSchema();
  // Expired presence is temporary operational data, not a browsing history.
  await pool.query("DELETE FROM website_user_presence WHERE last_seen_at <= NOW() - make_interval(secs => $1)", [presenceWindowSeconds]);
  const result = await pool.query(`
    INSERT INTO website_user_presence (session_key, user_id, last_seen_at)
    SELECT $1, id, NOW() FROM app_users WHERE id = $2
    ON CONFLICT (session_key) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
    RETURNING user_id
  `, [sessionKey, userId]);
  return result.rows.length > 0;
}

export async function clearUserPresence(sessionKey: string) {
  await ensureSchema();
  await pool.query("DELETE FROM website_user_presence WHERE session_key = $1", [sessionKey]);
}

export async function getConnectedUsersForAdmin(userId: string): Promise<UserPresenceSnapshot | null> {
  await ensureSchema();
  const admin = await pool.query("SELECT id FROM app_users WHERE id = $1 AND is_admin = TRUE", [userId]);
  if (admin.rows.length === 0) return null;
  const result = await pool.query(`
    SELECT users.id, users.name, users.email, COUNT(*)::int AS sessions, MAX(presence.last_seen_at) AS last_seen_at
    FROM website_user_presence AS presence
    JOIN app_users AS users ON users.id = presence.user_id
    WHERE presence.last_seen_at > NOW() - make_interval(secs => $1)
    GROUP BY users.id, users.name, users.email
    ORDER BY MAX(presence.last_seen_at) DESC, users.id
  `, [presenceWindowSeconds]);
  return {
    users: result.rows.map(row => ({ id: row.id, name: row.name, email: row.email, sessions: Number(row.sessions), lastSeenAt: new Date(row.last_seen_at).toISOString() })),
    checkedAt: new Date().toISOString(),
    windowSeconds: presenceWindowSeconds
  };
}
