import fs from "fs";
import { normalizeAuditHistoryLimit } from "./auditHistory";
import path from "path";
import { Pool } from "pg";

type StoredUserRecord = {
  id: string;
  name: string;
  email: string;
  isAdmin?: boolean;
  initials?: string;
  organization?: string;
  title?: string;
  timezone?: string;
  avatarColor?: string;
  websiteTheme?: string;
  websiteWidth?: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt?: string;
  updatedAt?: string;
};

type StoredState = {
  authSettings?: {
    registrationEnabled?: boolean;
  };
  reviewSettings?: {
    screeningCheckoutWindowMinutes?: number;
    extractionCheckoutWindowMinutes?: number;
    pdfUploadMaxSizeMb?: number;
    auditHistoryLimit?: number;
  };
  users?: StoredUserRecord[];
};

let pool: Pool | null = null;

function dataFilePath() {
  if (process.env.PRISMATICA_DATA_FILE) {
    return path.resolve(/*turbopackIgnore: true*/ process.env.PRISMATICA_DATA_FILE);
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "prismatica-state.json");
}

function usersSyncEnabled() {
  if ((process.env.PRISMATICA_STORAGE_MODE ?? "").toLowerCase() === "postgres") {
    return false;
  }
  return process.env.PRISMATICA_USERS_SYNC_POSTGRES === "true" && Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required when PRISMATICA_USERS_SYNC_POSTGRES=true.");
    }
    pool = new Pool({ connectionString: databaseUrl });
  }
  return pool;
}

function readState(): StoredState {
  const filePath = dataFilePath();
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    throw new Error(`State file not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8")) as StoredState;
  return parsed;
}

function normalizeTheme(theme: string | undefined) {
  return theme === "light" || theme === "dark" ? theme : "system";
}

function parseIsoOrNow(value: string | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

function clampPdfUploadMaxSizeMb(value: unknown, fallback: number) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(1, Math.min(500, Math.round(numericValue)));
}

async function ensureSchema(client: Pool) {
  const sqlFile = path.join(/*turbopackIgnore: true*/ process.cwd(), "db", "users_preferences.sql");
  const sql = fs.readFileSync(/*turbopackIgnore: true*/ sqlFile, "utf8");
  await client.query(sql);
}

async function upsertUser(client: Pool, user: StoredUserRecord) {
  await client.query(
    `
      INSERT INTO app_users (
        id, name, email, is_admin, initials, organization, title,
        timezone, avatar_color, website_theme, password_hash, password_salt,
        created_at, updated_at, website_width
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15
      )
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        is_admin = EXCLUDED.is_admin,
        initials = EXCLUDED.initials,
        organization = EXCLUDED.organization,
        title = EXCLUDED.title,
        timezone = EXCLUDED.timezone,
        avatar_color = EXCLUDED.avatar_color,
        website_theme = EXCLUDED.website_theme,
        password_hash = EXCLUDED.password_hash,
        password_salt = EXCLUDED.password_salt,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        website_width = EXCLUDED.website_width
    `,
    [
      user.id,
      user.name,
      user.email.toLowerCase(),
      Boolean(user.isAdmin),
      user.initials?.trim() || user.name.slice(0, 2).toUpperCase(),
      user.organization?.trim() || "Unknown",
      user.title?.trim() || "Reviewer",
      user.timezone?.trim() || "Europe/Rome",
      user.avatarColor?.trim() || "#42656d",
      normalizeTheme(user.websiteTheme),
      user.passwordHash,
      user.passwordSalt,
      parseIsoOrNow(user.createdAt),
      parseIsoOrNow(user.updatedAt),
      user.websiteWidth === "limited" ? "limited" : "full"
    ]
  );
}

async function upsertAuthSettings(
  client: Pool,
  registrationEnabled: boolean,
) {
  await client.query(
    `
      INSERT INTO auth_settings (
        id, registration_enabled, updated_at
      )
      VALUES (1, $1, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        registration_enabled = EXCLUDED.registration_enabled,
        updated_at = NOW()
    `,
    [registrationEnabled]
  );
}

async function upsertReviewSettings(
  client: Pool,
  screeningCheckoutWindowMinutes: number,
  extractionCheckoutWindowMinutes: number,
  pdfUploadMaxSizeMb: number,
  auditHistoryLimit: number
) {
  await client.query(
    `
      INSERT INTO review_settings (
        id, screening_checkout_window_minutes,
        extraction_checkout_window_minutes, pdf_upload_max_size_mb, audit_history_limit, updated_at
      )
      VALUES (1, $1, $2, $3, $4, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        screening_checkout_window_minutes = EXCLUDED.screening_checkout_window_minutes,
        extraction_checkout_window_minutes = EXCLUDED.extraction_checkout_window_minutes,
        pdf_upload_max_size_mb = EXCLUDED.pdf_upload_max_size_mb,
        audit_history_limit = EXCLUDED.audit_history_limit,
        updated_at = NOW()
    `,
    [screeningCheckoutWindowMinutes, extractionCheckoutWindowMinutes, pdfUploadMaxSizeMb, auditHistoryLimit]
  );
}


export async function syncUserByIdToPostgres(userId: string) {
  if (!usersSyncEnabled()) {
    return;
  }

  const state = readState();
  const users = Array.isArray(state.users) ? state.users : [];
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) {
    return;
  }

  const client = getPool();
  await ensureSchema(client);
  await upsertUser(client, user);
}

export async function syncAuthSettingsToPostgres() {
  if (!usersSyncEnabled()) {
    return;
  }

  const state = readState();
  const registrationEnabled = state.authSettings?.registrationEnabled ?? true;

  const client = getPool();
  await ensureSchema(client);
  await upsertAuthSettings(client, registrationEnabled);
}

export async function syncReviewSettingsToPostgres() {
  if (!usersSyncEnabled()) {
    return;
  }

  const state = readState();
  const screeningCheckoutWindowMinutes =
    state.reviewSettings?.screeningCheckoutWindowMinutes ?? 60;
  const extractionCheckoutWindowMinutes =
    state.reviewSettings?.extractionCheckoutWindowMinutes ?? 120;
  const pdfUploadMaxSizeMb = clampPdfUploadMaxSizeMb(
    state.reviewSettings?.pdfUploadMaxSizeMb,
    50
  );

  const client = getPool();
  await ensureSchema(client);
  await upsertReviewSettings(
    client,
    screeningCheckoutWindowMinutes,
    extractionCheckoutWindowMinutes,
    pdfUploadMaxSizeMb,
    normalizeAuditHistoryLimit(state.reviewSettings?.auditHistoryLimit)
  );
}

export async function deleteUserByIdFromPostgres(userId: string) {
  if (!usersSyncEnabled()) {
    return;
  }

  const client = getPool();
  await ensureSchema(client);
  await client.query("DELETE FROM app_users WHERE id = $1", [userId]);
}
