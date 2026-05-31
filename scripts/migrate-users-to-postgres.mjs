import fs from "fs";
import path from "path";
import process from "process";
import { Client } from "pg";

function readStateFile(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`State file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid state JSON: expected root object.");
  }

  const users = Array.isArray(parsed.users) ? parsed.users : [];
  const authSettings = parsed.authSettings && typeof parsed.authSettings === "object" ? parsed.authSettings : {};
  return { users, authSettings, absolutePath };
}

function parseIsoOrNow(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(parsed)) {
    return new Date().toISOString();
  }
  return new Date(parsed).toISOString();
}

function normalizeTheme(value) {
  return value === "light" || value === "dark" ? value : "system";
}

function normalizeUser(user, index) {
  const email = String(user.email ?? "").trim().toLowerCase();
  const name = String(user.name ?? "").trim();
  const id = String(user.id ?? "").trim();
  const passwordHash = String(user.passwordHash ?? "").trim();
  const passwordSalt = String(user.passwordSalt ?? "").trim();

  if (!id || !email || !name || !passwordHash || !passwordSalt) {
    throw new Error(`User at index ${index} is missing required fields (id, email, name, passwordHash, passwordSalt).`);
  }

  return {
    id,
    name,
    email,
    isAdmin: Boolean(user.isAdmin),
    initials: String(user.initials ?? "").trim() || name.slice(0, 2).toUpperCase(),
    organization: String(user.organization ?? "").trim() || "Unknown",
    title: String(user.title ?? "").trim() || "Reviewer",
    timezone: String(user.timezone ?? "").trim() || "Europe/Rome",
    avatarColor: String(user.avatarColor ?? "").trim() || "#42656d",
    websiteTheme: normalizeTheme(user.websiteTheme),
    passwordHash,
    passwordSalt,
    createdAt: parseIsoOrNow(user.createdAt),
    updatedAt: parseIsoOrNow(user.updatedAt)
  };
}

async function ensureSchema(client) {
  const schemaPath = path.resolve("db/users_preferences.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await client.query(sql);
}

async function migrateAuthSettings(client, authSettings) {
  const registrationEnabled = typeof authSettings.registrationEnabled === "boolean" ? authSettings.registrationEnabled : true;
  await client.query(
    `
      INSERT INTO auth_settings (id, registration_enabled, updated_at)
      VALUES (1, $1, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        registration_enabled = EXCLUDED.registration_enabled,
        updated_at = NOW()
    `,
    [registrationEnabled]
  );
}

async function migrateUsers(client, users) {
  let importedCount = 0;
  for (let index = 0; index < users.length; index += 1) {
    const normalized = normalizeUser(users[index], index);
    await client.query(
      `
        INSERT INTO app_users (
          id, name, email, is_admin, initials, organization, title,
          timezone, avatar_color, website_theme, password_hash, password_salt,
          created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          $13, $14
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
          updated_at = EXCLUDED.updated_at
      `,
      [
        normalized.id,
        normalized.name,
        normalized.email,
        normalized.isAdmin,
        normalized.initials,
        normalized.organization,
        normalized.title,
        normalized.timezone,
        normalized.avatarColor,
        normalized.websiteTheme,
        normalized.passwordHash,
        normalized.passwordSalt,
        normalized.createdAt,
        normalized.updatedAt
      ]
    );
    importedCount += 1;
  }

  return importedCount;
}

async function run() {
  const sourceFile = process.env.PRISMATICA_SOURCE_STATE_FILE || "data/prismatica-state.json";
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const { users, authSettings, absolutePath } = readStateFile(sourceFile);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    await ensureSchema(client);
    await migrateAuthSettings(client, authSettings);
    const importedUsers = await migrateUsers(client, users);
    await client.query("COMMIT");

    console.log(`Imported auth settings and ${importedUsers} users from ${absolutePath}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
