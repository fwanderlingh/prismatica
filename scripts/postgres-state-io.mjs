import { Client } from "pg";

const stateVersion = 1;

const tableConfigs = [
  {
    tableName: "review_projects",
    arrayKey: "projects",
    idColumn: "id",
    extraColumns: ["project_id", "position"],
    valuesForItem: (item, index) => [item.id, item.id, index, JSON.stringify(item)]
  },
  {
    tableName: "import_batches",
    arrayKey: "imports",
    idColumn: "id",
    extraColumns: ["project_id", "position"],
    valuesForItem: (item, index) => [item.id, item.projectId ?? null, index, JSON.stringify(item)]
  },
  {
    tableName: "review_studies",
    arrayKey: "studies",
    idColumn: "id",
    extraColumns: ["project_id", "import_batch_id", "position"],
    valuesForItem: (item, index) => [item.id, item.projectId ?? null, item.importBatchId ?? null, index, JSON.stringify(item)]
  },
  {
    tableName: "review_reports",
    arrayKey: "reports",
    idColumn: "id",
    extraColumns: ["project_id", "study_id", "position"],
    valuesForItem: (item, index) => [item.id, item.projectId ?? null, item.studyId ?? null, index, JSON.stringify(item)]
  },
  {
    tableName: "review_extraction_templates",
    arrayKey: "extractionTemplates",
    idColumn: "id",
    extraColumns: ["project_id", "position"],
    valuesForItem: (item, index) => [item.id, item.projectId ?? null, index, JSON.stringify(item)]
  },
  {
    tableName: "review_extraction_responses",
    arrayKey: "extractionResponses",
    idColumn: "id",
    extraColumns: ["project_id", "study_id", "report_id", "template_id", "user_id", "position"],
    valuesForItem: (item, index) => [
      item.id,
      item.projectId ?? null,
      item.studyId ?? null,
      item.reportId ?? null,
      item.templateId ?? null,
      item.userId ?? null,
      index,
      JSON.stringify(item)
    ]
  },
  {
    tableName: "review_extraction_consensus",
    arrayKey: "extractionConsensus",
    idColumn: "id",
    extraColumns: ["project_id", "study_id", "report_id", "template_id", "position"],
    valuesForItem: (item, index) => [
      item.id,
      item.projectId ?? null,
      item.studyId ?? null,
      item.reportId ?? null,
      item.templateId ?? null,
      index,
      JSON.stringify(item)
    ]
  },
  {
    tableName: "review_decisions",
    arrayKey: "decisions",
    idColumn: "id",
    extraColumns: ["project_id", "study_id", "report_id", "user_id", "position"],
    valuesForItem: (item, index) => [
      item.id,
      item.projectId ?? null,
      item.studyId ?? null,
      item.reportId ?? null,
      item.userId ?? null,
      index,
      JSON.stringify(item)
    ]
  },
  {
    tableName: "workflow_events",
    arrayKey: "events",
    idColumn: "id",
    extraColumns: ["entity", "position"],
    valuesForItem: (item, index) => [item.id, item.entity ?? null, index, JSON.stringify(item)]
  },
  {
    tableName: "review_dedup_candidates",
    arrayKey: "dedupCandidates",
    idColumn: "id",
    extraColumns: ["record_a_id", "record_b_id", "position"],
    valuesForItem: (item, index) => [item.id, item.recordA?.id ?? null, item.recordB?.id ?? null, index, JSON.stringify(item)]
  }
];

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS auth_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      registration_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      initials TEXT NOT NULL,
      organization TEXT NOT NULL,
      title TEXT NOT NULL,
      timezone TEXT NOT NULL,
      avatar_color TEXT NOT NULL,
      website_theme TEXT NOT NULL CHECK (website_theme IN ('light', 'dark', 'system')),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_projects (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_studies (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      import_batch_id TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      study_id TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_extraction_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_extraction_responses (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      study_id TEXT,
      report_id TEXT,
      template_id TEXT,
      user_id TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_extraction_consensus (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      study_id TEXT,
      report_id TEXT,
      template_id TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      study_id TEXT,
      report_id TEXT,
      user_id TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_events (
      id TEXT PRIMARY KEY,
      entity TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_dedup_candidates (
      id TEXT PRIMARY KEY,
      record_a_id TEXT,
      record_b_id TEXT,
      position INTEGER NOT NULL,
      payload JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state_store (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      state_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function normalizeTheme(value) {
  return value === "light" || value === "dark" ? value : "system";
}

function normalizeTimestamp(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function defaultState() {
  return {
    version: stateVersion,
    authSettings: {
      registrationEnabled: true
    },
    users: [],
    projects: [],
    imports: [],
    studies: [],
    reports: [],
    extractionTemplates: [],
    extractionResponses: [],
    extractionConsensus: [],
    decisions: [],
    events: [],
    dedupCandidates: []
  };
}

async function readRows(client, tableName) {
  const result = await client.query(`SELECT payload::text AS payload FROM ${tableName} ORDER BY position ASC`);
  return result.rows.map((row) => JSON.parse(row.payload));
}

async function readRelationalState(client) {
  const usersResult = await client.query(
    `
      SELECT id, name, email, is_admin, initials, organization, title, timezone,
             avatar_color, website_theme, password_hash, password_salt, created_at, updated_at
      FROM app_users
      ORDER BY created_at ASC, id ASC
    `
  );
  const authSettingsResult = await client.query(`SELECT registration_enabled FROM auth_settings WHERE id = 1`);

  const projects = await readRows(client, "review_projects");
  const imports = await readRows(client, "import_batches");
  const studies = await readRows(client, "review_studies");
  const reports = await readRows(client, "review_reports");
  const extractionTemplates = await readRows(client, "review_extraction_templates");
  const extractionResponses = await readRows(client, "review_extraction_responses");
  const extractionConsensus = await readRows(client, "review_extraction_consensus");
  const decisions = await readRows(client, "review_decisions");
  const events = await readRows(client, "workflow_events");
  const dedupCandidates = await readRows(client, "review_dedup_candidates");

  const hasRelationalState =
    usersResult.rowCount > 0 ||
    authSettingsResult.rowCount > 0 ||
    projects.length > 0 ||
    imports.length > 0 ||
    studies.length > 0 ||
    reports.length > 0 ||
    extractionTemplates.length > 0 ||
    extractionResponses.length > 0 ||
    extractionConsensus.length > 0 ||
    decisions.length > 0 ||
    events.length > 0 ||
    dedupCandidates.length > 0;

  if (!hasRelationalState) {
    return null;
  }

  return {
    version: stateVersion,
    authSettings: {
      registrationEnabled: authSettingsResult.rows[0]?.registration_enabled ?? true
    },
    users: usersResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      isAdmin: row.is_admin,
      initials: row.initials,
      organization: row.organization,
      title: row.title,
      timezone: row.timezone,
      avatarColor: row.avatar_color,
      websiteTheme: row.website_theme,
      passwordHash: row.password_hash,
      passwordSalt: row.password_salt,
      createdAt: normalizeTimestamp(row.created_at?.toISOString?.() ?? row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at?.toISOString?.() ?? row.updated_at)
    })),
    projects,
    imports,
    studies,
    reports,
    extractionTemplates,
    extractionResponses,
    extractionConsensus,
    decisions,
    events,
    dedupCandidates
  };
}

async function readLegacyBlobState(client) {
  const result = await client.query("SELECT state_json::text AS state_json FROM app_state_store WHERE id = 1");
  const payload = result.rows[0]?.state_json;
  return typeof payload === "string" ? payload : "";
}

async function truncateReviewStateTables(client) {
  await client.query(`
    TRUNCATE TABLE
      review_projects,
      import_batches,
      review_studies,
      review_reports,
      review_extraction_templates,
      review_extraction_responses,
      review_extraction_consensus,
      review_decisions,
      workflow_events,
      review_dedup_candidates
  `);
}

async function writeUsers(client, state) {
  await client.query("DELETE FROM app_users");
  for (const user of state.users ?? []) {
    await client.query(
      `
        INSERT INTO app_users (
          id, name, email, is_admin, initials, organization, title,
          timezone, avatar_color, website_theme, password_hash, password_salt,
          created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        user.id,
        user.name,
        user.email,
        Boolean(user.isAdmin),
        user.initials,
        user.organization,
        user.title,
        user.timezone,
        user.avatarColor,
        normalizeTheme(user.websiteTheme),
        user.passwordHash,
        user.passwordSalt,
        normalizeTimestamp(user.createdAt),
        normalizeTimestamp(user.updatedAt)
      ]
    );
  }
}

async function writeAuthSettings(client, state) {
  await client.query(
    `
      INSERT INTO auth_settings (id, registration_enabled, updated_at)
      VALUES (1, $1, NOW())
      ON CONFLICT (id)
      DO UPDATE SET registration_enabled = EXCLUDED.registration_enabled, updated_at = NOW()
    `,
    [Boolean(state.authSettings?.registrationEnabled ?? true)]
  );
}

async function writeReviewTables(client, state) {
  for (const config of tableConfigs) {
    const items = Array.isArray(state[config.arrayKey]) ? state[config.arrayKey] : [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const columnList = [config.idColumn, ...config.extraColumns, "payload"];
      const placeholders = columnList.map((_, valueIndex) => `$${valueIndex + 1}`).join(", ");
      await client.query(
        `INSERT INTO ${config.tableName} (${columnList.join(", ")}) VALUES (${placeholders})`,
        config.valuesForItem(item, index)
      );
    }
  }
}

async function run() {
  const action = process.argv[2];
  if (action !== "read" && action !== "write") {
    throw new Error("Usage: node scripts/postgres-state-io.mjs <read|write>");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when PRISMATICA_STORAGE_MODE=postgres.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureSchema(client);

    if (action === "read") {
      const relationalState = await readRelationalState(client);
      if (relationalState) {
        process.stdout.write(JSON.stringify(relationalState));
        return;
      }

      const payload = await readLegacyBlobState(client);
      if (payload) {
        process.stdout.write(payload);
      }
      return;
    }

    const raw = await readStdin();
    if (!raw.trim()) {
      throw new Error("Write mode expects JSON payload via stdin.");
    }

    const parsed = JSON.parse(raw);
    const nextState = {
      ...defaultState(),
      ...parsed
    };
    await client.query("BEGIN");
    await writeAuthSettings(client, nextState);
    await writeUsers(client, nextState);
    await truncateReviewStateTables(client);
    await writeReviewTables(client, nextState);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  // Best-effort rollback if a transaction is open.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
