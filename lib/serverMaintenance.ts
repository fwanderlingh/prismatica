import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { Pool } from "pg";
import { ApiError, getUserSessionState } from "./serverStore";
import type { MaintenanceSettings } from "./maintenance";

const defaults: MaintenanceSettings = { enabled: false, endsAt: null };
const globalStore = globalThis as typeof globalThis & {
  __prismaticaMaintenancePool?: Pool;
  __prismaticaMaintenanceSchema?: Promise<void>;
};

function maintenanceFilePath() {
  const statePath = process.env.PRISMATICA_DATA_FILE
    ? path.resolve(/*turbopackIgnore: true*/ process.env.PRISMATICA_DATA_FILE)
    : path.join(process.cwd(), "data", "prismatica-state.json");
  return `${statePath}.maintenance.json`;
}

async function maintenancePool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL maintenance settings.");
  const pool = globalStore.__prismaticaMaintenancePool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 120_000,
    query_timeout: 5_000
  });
  globalStore.__prismaticaMaintenanceSchema ??= pool.query(`
    CREATE TABLE IF NOT EXISTS website_maintenance (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ends_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (NOT enabled OR ends_at IS NOT NULL)
    )
  `).then(() => undefined).catch(error => {
    delete globalStore.__prismaticaMaintenanceSchema;
    throw error;
  });
  await globalStore.__prismaticaMaintenanceSchema;
  return pool;
}

export async function getMaintenanceSettings(): Promise<MaintenanceSettings> {
  if (process.env.PRISMATICA_STORAGE_MODE?.toLowerCase() === "postgres") {
    const pool = await maintenancePool();
    const result = await pool.query("SELECT enabled, ends_at FROM website_maintenance WHERE id = 1");
    const row = result.rows[0];
    return row ? { enabled: row.enabled, endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null } : { ...defaults };
  }

  try {
    return JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ maintenanceFilePath(), "utf8")) as MaintenanceSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaults };
    throw error;
  }
}

function requireMaintenanceAdmin(userId: string) {
  const user = getUserSessionState(userId);
  if (!user) throw new ApiError("Your session is no longer valid. Sign in again.", 401);
  if (!user.isAdmin) throw new ApiError("Only administrators can manage maintenance mode.", 403);
}

export async function getMaintenanceSettingsForAdmin(userId: string) {
  requireMaintenanceAdmin(userId);
  return getMaintenanceSettings();
}

export async function updateMaintenanceSettingsForAdmin(userId: string, input: Record<string, unknown>) {
  requireMaintenanceAdmin(userId);
  if (typeof input.enabled !== "boolean") throw new ApiError("Maintenance enabled must be true or false.");
  const previous = await getMaintenanceSettings();
  let endsAt = previous.endsAt;
  if (input.enabled) {
    // Require an explicit offset so the server never guesses the administrator's timezone.
    if (typeof input.endsAt !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(input.endsAt) || !Number.isFinite(Date.parse(input.endsAt))) {
      throw new ApiError("Specify a valid maintenance end date and time, including its timezone.");
    }
    if (Date.parse(input.endsAt) <= Date.now()) throw new ApiError("The expected end date must be in the future.");
    endsAt = new Date(input.endsAt).toISOString();
  }
  const settings: MaintenanceSettings = { enabled: input.enabled, endsAt };
  if (process.env.PRISMATICA_STORAGE_MODE?.toLowerCase() === "postgres") {
    const pool = await maintenancePool();
    await pool.query(`
      INSERT INTO website_maintenance (id, enabled, ends_at) VALUES (1, $1, $2)
      ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, ends_at = EXCLUDED.ends_at, updated_at = NOW()
    `, [settings.enabled, settings.endsAt]);
  } else {
    const filePath = maintenanceFilePath();
    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(/*turbopackIgnore: true*/ tempPath, `${JSON.stringify(settings)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.rename(/*turbopackIgnore: true*/ tempPath, filePath);
    } finally {
      await fs.rm(/*turbopackIgnore: true*/ tempPath, { force: true });
    }
  }
  return settings;
}
