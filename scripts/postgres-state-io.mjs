import { Client } from "pg";

const stateVersion = 1;

const tableConfigs = [
  {
    tableName: "import_batches",
    arrayKey: "imports",
    idColumn: "id",
    extraColumns: ["project_id", "position"],
    valuesForItem: (item, index) => [item.id, item.projectId ?? null, index, JSON.stringify(item)]
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

    CREATE TABLE IF NOT EXISTS review_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      screening_checkout_window_minutes INTEGER NOT NULL DEFAULT 60,
      extraction_checkout_window_minutes INTEGER NOT NULL DEFAULT 120,
      pdf_upload_max_size_mb INTEGER NOT NULL DEFAULT 50,
      audit_history_limit INTEGER NOT NULL DEFAULT 100,
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
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      organization TEXT NOT NULL,
      protocol_id TEXT NOT NULL,
      blind_mode BOOLEAN NOT NULL,
      abstract_required_votes INTEGER NOT NULL,
      full_text_required_votes INTEGER NOT NULL,
      extraction_required_votes INTEGER NOT NULL,
      maybe_policy TEXT NOT NULL,
      require_sequential_phases BOOLEAN NOT NULL,
      reviewers INTEGER NOT NULL,
      last_event TEXT NOT NULL,
      description TEXT NOT NULL,
      search_strategies TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      owner_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      member_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at_text TEXT NOT NULL,
      updated_at_text TEXT NOT NULL,
      due_date TEXT NOT NULL,
      records_total INTEGER NOT NULL,
      records_screened INTEGER NOT NULL,
      conflicts INTEGER NOT NULL,
      studies_included INTEGER NOT NULL,
      payload JSONB
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
      import_item_id INTEGER,
      title TEXT NOT NULL,
      abstract TEXT NOT NULL,
      authors JSONB NOT NULL DEFAULT '[]'::jsonb,
      journal TEXT NOT NULL,
      year INTEGER NOT NULL,
      doi TEXT NOT NULL,
      source TEXT NOT NULL,
      stage TEXT NOT NULL,
      keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw_citation TEXT,
      parser_warnings JSONB,
      payload JSONB
    );

    CREATE TABLE IF NOT EXISTS review_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      study_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      citation TEXT NOT NULL,
      retrieval_status TEXT NOT NULL,
      pdf_name TEXT,
      file_name TEXT,
      mime_type TEXT,
      size INTEGER,
      checksum TEXT,
      storage_path TEXT,
      uploaded_by_user_id TEXT,
      uploaded_by_user_name TEXT,
      full_text_status TEXT,
      full_text_status_label TEXT,
      full_text_vote_count INTEGER,
      full_text_required_votes INTEGER,
      is_pdf_validated BOOLEAN NOT NULL,
      validation_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes INTEGER NOT NULL,
      payload JSONB
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

    CREATE TABLE IF NOT EXISTS review_screening_checkouts (
      project_id TEXT PRIMARY KEY,
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

    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS audit_history_limit INTEGER NOT NULL DEFAULT 100;
    ALTER TABLE review_settings ADD COLUMN IF NOT EXISTS pdf_upload_max_size_mb INTEGER NOT NULL DEFAULT 50;

    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS organization TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS protocol_id TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS blind_mode BOOLEAN;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS abstract_required_votes INTEGER;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS full_text_required_votes INTEGER;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS extraction_required_votes INTEGER;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS maybe_policy TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS require_sequential_phases BOOLEAN;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS reviewers INTEGER;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS last_event TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS search_strategies TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS status TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS stage TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS owner_id TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS owner_ids JSONB;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS member_ids JSONB;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS created_at_text TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS updated_at_text TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS due_date TEXT;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS records_total INTEGER;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS records_screened INTEGER;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS conflicts INTEGER;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS studies_included INTEGER;
    ALTER TABLE review_projects ADD COLUMN IF NOT EXISTS payload JSONB;

    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS import_item_id INTEGER;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS abstract TEXT;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS authors JSONB;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS journal TEXT;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS year INTEGER;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS doi TEXT;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS source TEXT;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS stage TEXT;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS keywords JSONB;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS raw_citation TEXT;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS parser_warnings JSONB;
    ALTER TABLE review_studies ADD COLUMN IF NOT EXISTS payload JSONB;

    ALTER TABLE auth_settings ADD COLUMN IF NOT EXISTS transactional_email_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_auth JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE app_users ADD COLUMN IF NOT EXISTS website_width TEXT NOT NULL DEFAULT 'full' CHECK (website_width IN ('full', 'limited'));
    ALTER TABLE app_users ADD COLUMN IF NOT EXISTS website_palette TEXT NOT NULL DEFAULT 'teal' CHECK (website_palette IN ('teal', 'coffee'));

    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS citation TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS retrieval_status TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS pdf_name TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS file_name TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS mime_type TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS size INTEGER;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS checksum TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS storage_path TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS uploaded_by_user_id TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS uploaded_by_user_name TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS full_text_status TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS full_text_status_label TEXT;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS full_text_vote_count INTEGER;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS full_text_required_votes INTEGER;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS is_pdf_validated BOOLEAN;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS validation_notes JSONB;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS notes INTEGER;
    ALTER TABLE review_reports ADD COLUMN IF NOT EXISTS payload JSONB;
  `);
}

function normalizeTheme(value) {
  return value === "light" || value === "dark" ? value : "system";
}

function normalizeTimestamp(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function clampCheckoutWindowMinutes(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(1, Math.min(600, Math.round(numericValue)));
}

function clampPdfUploadMaxSizeMb(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(1, Math.min(500, Math.round(numericValue)));
}

function defaultState() {
  return {
    version: stateVersion,
    authSettings: {
      registrationEnabled: true
    },
    reviewSettings: {
      screeningCheckoutWindowMinutes: 60,
      extractionCheckoutWindowMinutes: 120,
      auditHistoryLimit: 100,
      pdfUploadMaxSizeMb: 50
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
    screeningCheckouts: [],
    events: [],
    dedupCandidates: []
  };
}

async function readRows(client, tableName) {
  const result = await client.query(`SELECT payload::text AS payload FROM ${tableName} ORDER BY position ASC`);
  return result.rows.map((row) => JSON.parse(row.payload));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJsonObject(value) {
  if (value && typeof value === "object") {
    return value;
  }
  return null;
}

async function readProjects(client) {
  const result = await client.query(
    `
      SELECT
        id, title, organization, protocol_id, blind_mode,
        abstract_required_votes, full_text_required_votes, extraction_required_votes,
        maybe_policy, require_sequential_phases, reviewers, last_event, description, search_strategies,
        status, stage, owner_id, owner_ids, member_ids,
        created_at_text, updated_at_text, due_date,
        records_total, records_screened, conflicts, studies_included,
        payload
      FROM review_projects
      ORDER BY position ASC
    `
  );

  return result.rows.map((row) => {
    const payload = readJsonObject(row.payload);
    return {
      id: row.id,
      title: row.title ?? payload?.title ?? "",
      organization: row.organization ?? payload?.organization ?? "",
      protocolId: row.protocol_id ?? payload?.protocolId ?? "",
      blindMode: row.blind_mode ?? payload?.blindMode ?? false,
      abstractRequiredVotes: row.abstract_required_votes ?? payload?.abstractRequiredVotes ?? 2,
      fullTextRequiredVotes: row.full_text_required_votes ?? payload?.fullTextRequiredVotes ?? 2,
      extractionRequiredVotes: row.extraction_required_votes ?? payload?.extractionRequiredVotes ?? 2,
      exclusionReasons: asArray(payload?.exclusionReasons).filter((reason) => typeof reason === "string" && reason.trim().length > 0),
      maybePolicy: row.maybe_policy ?? payload?.maybePolicy ?? "advance_to_full_text",
      requireSequentialPhases: row.require_sequential_phases ?? payload?.requireSequentialPhases ?? true,
      reviewers: row.reviewers ?? payload?.reviewers ?? 0,
      lastEvent: row.last_event ?? payload?.lastEvent ?? "",
      description: row.description ?? payload?.description ?? "",
      searchStrategies: row.search_strategies ?? payload?.searchStrategies ?? "",
      status: row.status ?? payload?.status ?? "draft",
      stage: row.stage ?? payload?.stage ?? "setup",
      ownerId: row.owner_id ?? payload?.ownerId ?? "",
      ownerIds: asArray(row.owner_ids ?? payload?.ownerIds),
      memberIds: asArray(row.member_ids ?? payload?.memberIds),
      createdAt: row.created_at_text ?? payload?.createdAt ?? "",
      updatedAt: row.updated_at_text ?? payload?.updatedAt ?? "",
      dueDate: row.due_date ?? payload?.dueDate ?? "",
      recordsTotal: row.records_total ?? payload?.recordsTotal ?? 0,
      recordsScreened: row.records_screened ?? payload?.recordsScreened ?? 0,
      conflicts: row.conflicts ?? payload?.conflicts ?? 0,
      studiesIncluded: row.studies_included ?? payload?.studiesIncluded ?? 0
    };
  });
}

async function readStudies(client) {
  const result = await client.query(
    `
      SELECT
        id, import_item_id, project_id, import_batch_id,
        title, abstract, authors, journal, year, doi, source, stage,
        keywords, raw_citation, parser_warnings, payload
      FROM review_studies
      ORDER BY position ASC
    `
  );

  return result.rows.map((row) => {
    const payload = readJsonObject(row.payload);
    const study = {
      id: row.id,
      projectId: row.project_id ?? payload?.projectId,
      importBatchId: row.import_batch_id ?? payload?.importBatchId,
      title: row.title ?? payload?.title ?? "",
      abstract: row.abstract ?? payload?.abstract ?? "",
      authors: asArray(row.authors ?? payload?.authors),
      journal: row.journal ?? payload?.journal ?? "",
      year: row.year ?? payload?.year ?? 0,
      doi: row.doi ?? payload?.doi ?? "",
      source: row.source ?? payload?.source ?? "",
      stage: row.stage ?? payload?.stage ?? "title_abstract",
      keywords: asArray(row.keywords ?? payload?.keywords),
      rawCitation: row.raw_citation ?? payload?.rawCitation,
      parserWarnings: asArray(row.parser_warnings ?? payload?.parserWarnings)
    };

    const importItemId = row.import_item_id ?? payload?.importItemId;
    if (typeof importItemId === "number") {
      study.importItemId = importItemId;
    }

    return study;
  });
}

async function readReports(client) {
  const result = await client.query(
    `
      SELECT
        id, project_id, study_id, title, citation, retrieval_status,
        pdf_name, file_name, mime_type, size, checksum, storage_path,
        uploaded_by_user_id, uploaded_by_user_name,
        full_text_status, full_text_status_label, full_text_vote_count, full_text_required_votes,
        is_pdf_validated, validation_notes, notes, payload
      FROM review_reports
      ORDER BY position ASC
    `
  );

  return result.rows.map((row) => {
    const payload = readJsonObject(row.payload);
    return {
      id: row.id,
      projectId: row.project_id ?? payload?.projectId ?? "",
      studyId: row.study_id ?? payload?.studyId ?? "",
      title: row.title ?? payload?.title ?? "",
      citation: row.citation ?? payload?.citation ?? "",
      retrievalStatus: row.retrieval_status ?? payload?.retrievalStatus ?? "not_sought",
      pdfName: row.pdf_name ?? payload?.pdfName,
      fileName: row.file_name ?? payload?.fileName,
      mimeType: row.mime_type ?? payload?.mimeType,
      size: row.size ?? payload?.size,
      checksum: row.checksum ?? payload?.checksum,
      storagePath: row.storage_path ?? payload?.storagePath,
      uploadedByUserId: row.uploaded_by_user_id ?? payload?.uploadedByUserId,
      uploadedByUserName: row.uploaded_by_user_name ?? payload?.uploadedByUserName,
      fullTextStatus: row.full_text_status ?? payload?.fullTextStatus,
      fullTextStatusLabel: row.full_text_status_label ?? payload?.fullTextStatusLabel,
      fullTextVoteCount: row.full_text_vote_count ?? payload?.fullTextVoteCount,
      fullTextRequiredVotes: row.full_text_required_votes ?? payload?.fullTextRequiredVotes,
      isPdfValidated: row.is_pdf_validated ?? payload?.isPdfValidated ?? false,
      validationNotes: asArray(row.validation_notes ?? payload?.validationNotes),
      notes: row.notes ?? payload?.notes ?? 0
    };
  });
}

async function readRelationalState(client) {
  const usersResult = await client.query(
    `
      SELECT id, name, email, is_admin, initials, organization, title, timezone,
             avatar_color, website_theme, website_palette, website_width, password_hash, password_salt, created_at, updated_at, email_auth
      FROM app_users
      ORDER BY created_at ASC, id ASC
    `
  );
  const authSettingsResult = await client.query(
    `
      SELECT
        registration_enabled, transactional_email_enabled
      FROM auth_settings
      WHERE id = 1
    `
  );
  const reviewSettingsResult = await client.query(
    `
      SELECT
        screening_checkout_window_minutes,
        extraction_checkout_window_minutes,
        pdf_upload_max_size_mb,
        audit_history_limit
      FROM review_settings
      WHERE id = 1
    `
  );

  const projects = await readProjects(client);
  const imports = await readRows(client, "import_batches");
  const studies = await readStudies(client);
  const reports = await readReports(client);
  const extractionTemplates = await readRows(client, "review_extraction_templates");
  const extractionResponses = await readRows(client, "review_extraction_responses");
  const extractionConsensus = await readRows(client, "review_extraction_consensus");
  const decisions = await readRows(client, "review_decisions");
  const checkoutRows = await client.query("SELECT payload FROM review_screening_checkouts ORDER BY project_id ASC");
  const screeningCheckouts = checkoutRows.rows.flatMap((row) => asArray(row.payload));
  const auditLimit = normalizeAuditHistoryLimit(reviewSettingsResult.rows[0]?.audit_history_limit);
  const eventRows = await client.query(
    `${rankedWorkflowEventsSql()}
     SELECT payload::text AS payload FROM ranked_events WHERE project_rank <= $1
     ORDER BY payload->>'time' DESC, position ASC, id ASC`, [auditLimit]
  );
  const events = eventRows.rows.map((row) => JSON.parse(row.payload));
  const dedupCandidates = await readRows(client, "review_dedup_candidates");

  const hasRelationalState =
    usersResult.rowCount > 0 ||
    authSettingsResult.rowCount > 0 ||
    reviewSettingsResult.rowCount > 0 ||
    projects.length > 0 ||
    imports.length > 0 ||
    studies.length > 0 ||
    reports.length > 0 ||
    extractionTemplates.length > 0 ||
    extractionResponses.length > 0 ||
    extractionConsensus.length > 0 ||
    decisions.length > 0 ||
    screeningCheckouts.length > 0 ||
    events.length > 0 ||
    dedupCandidates.length > 0;

  if (!hasRelationalState) {
    return null;
  }

  return {
    version: stateVersion,
    authSettings: {
      registrationEnabled: authSettingsResult.rows[0]?.registration_enabled ?? true,
      transactionalEmailEnabled: authSettingsResult.rows[0]?.transactional_email_enabled ?? false,
    },
    reviewSettings: {
      screeningCheckoutWindowMinutes: reviewSettingsResult.rows[0]?.screening_checkout_window_minutes ?? 60,
      extractionCheckoutWindowMinutes: reviewSettingsResult.rows[0]?.extraction_checkout_window_minutes ?? 120,
      auditHistoryLimit: normalizeAuditHistoryLimit(reviewSettingsResult.rows[0]?.audit_history_limit),
      pdfUploadMaxSizeMb: reviewSettingsResult.rows[0]?.pdf_upload_max_size_mb ?? 50
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
      websitePalette: row.website_palette === "coffee" ? "coffee" : "teal",
      websiteWidth: row.website_width === "limited" ? "limited" : "full",
      emailAuth: row.email_auth ?? {},
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
    screeningCheckouts,
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
      review_screening_checkouts,
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
          created_at, updated_at, website_width, email_auth, website_palette
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
        normalizeTimestamp(user.updatedAt),
        user.websiteWidth === "limited" ? "limited" : "full",
        JSON.stringify(user.emailAuth ?? {}),
        user.websitePalette === "coffee" ? "coffee" : "teal"
      ]
    );
  }
}

async function writeAuthSettings(client, state) {
  await client.query(
    `
      INSERT INTO auth_settings (
        id, registration_enabled, transactional_email_enabled, updated_at
      )
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        registration_enabled = EXCLUDED.registration_enabled,
        transactional_email_enabled = EXCLUDED.transactional_email_enabled,
        updated_at = NOW()
    `,
    [
      state.authSettings?.registrationEnabled ?? true,
      state.authSettings?.transactionalEmailEnabled ?? false
    ]
  );
}

async function writeReviewSettings(client, state) {
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
    [
      clampCheckoutWindowMinutes(state.reviewSettings?.screeningCheckoutWindowMinutes, 60),
      clampCheckoutWindowMinutes(state.reviewSettings?.extractionCheckoutWindowMinutes, 120),
      clampPdfUploadMaxSizeMb(state.reviewSettings?.pdfUploadMaxSizeMb, 50),
      normalizeAuditHistoryLimit(state.reviewSettings?.auditHistoryLimit)
    ]
  );
}

async function writeProjects(client, state) {
  const projects = Array.isArray(state.projects) ? state.projects : [];
  for (let index = 0; index < projects.length; index += 1) {
    const project = projects[index];
    await client.query(
      `
        INSERT INTO review_projects (
          id, position, title, organization, protocol_id, blind_mode,
          abstract_required_votes, full_text_required_votes, extraction_required_votes,
          maybe_policy, require_sequential_phases, reviewers, last_event, description, search_strategies,
          status, stage, owner_id, owner_ids, member_ids,
          created_at_text, updated_at_text, due_date,
          records_total, records_screened, conflicts, studies_included,
          payload
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19::jsonb, $20::jsonb,
          $21, $22, $23,
          $24, $25, $26, $27,
          $28::jsonb
        )
      `,
      [
        project.id,
        index,
        project.title,
        project.organization,
        project.protocolId,
        Boolean(project.blindMode),
        Number(project.abstractRequiredVotes ?? 2),
        Number(project.fullTextRequiredVotes ?? 2),
        Number(project.extractionRequiredVotes ?? 2),
        project.maybePolicy,
        Boolean(project.requireSequentialPhases ?? true),
        Number(project.reviewers ?? 0),
        project.lastEvent,
        project.description,
        project.searchStrategies ?? "",
        project.status,
        project.stage,
        project.ownerId,
        JSON.stringify(asArray(project.ownerIds)),
        JSON.stringify(asArray(project.memberIds)),
        project.createdAt,
        project.updatedAt,
        project.dueDate,
        Number(project.recordsTotal ?? 0),
        Number(project.recordsScreened ?? 0),
        Number(project.conflicts ?? 0),
        Number(project.studiesIncluded ?? 0),
        JSON.stringify(project)
      ]
    );
  }
}

function updateInsertedColumns(columns) {
  return `ON CONFLICT (id) DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}`;
}

async function writeStudies(client, state, positionOffset = 0, upsert = false) {
  const studies = Array.isArray(state.studies) ? state.studies : [];
  for (let index = 0; index < studies.length; index += 1) {
    const study = studies[index];
    await client.query(
      `
        INSERT INTO review_studies (
          id, project_id, import_batch_id, position, import_item_id,
          title, abstract, authors, journal, year, doi, source, stage,
          keywords, raw_citation, parser_warnings, payload
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8::jsonb, $9, $10, $11, $12, $13,
          $14::jsonb, $15, $16::jsonb, $17::jsonb
        )
        ${upsert ? updateInsertedColumns(["project_id", "import_batch_id", "import_item_id", "title", "abstract", "authors", "journal", "year", "doi", "source", "stage", "keywords", "raw_citation", "parser_warnings", "payload"]) : ""}
      `,
      [
        study.id,
        study.projectId ?? null,
        study.importBatchId ?? null,
        positionOffset + index,
        typeof study.importItemId === "number" ? study.importItemId : null,
        study.title,
        study.abstract,
        JSON.stringify(asArray(study.authors)),
        study.journal,
        Number(study.year ?? 0),
        study.doi,
        study.source,
        study.stage,
        JSON.stringify(asArray(study.keywords)),
        study.rawCitation ?? null,
        study.parserWarnings ? JSON.stringify(asArray(study.parserWarnings)) : null,
        JSON.stringify(study)
      ]
    );
  }
}

async function writeReports(client, state, positionOffset = 0, upsert = false) {
  const reports = Array.isArray(state.reports) ? state.reports : [];
  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index];
    await client.query(
      `
        INSERT INTO review_reports (
          id, project_id, study_id, position,
          title, citation, retrieval_status,
          pdf_name, file_name, mime_type, size, checksum, storage_path,
          uploaded_by_user_id, uploaded_by_user_name,
          full_text_status, full_text_status_label, full_text_vote_count, full_text_required_votes,
          is_pdf_validated, validation_notes, notes, payload
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15,
          $16, $17, $18, $19,
          $20, $21::jsonb, $22, $23::jsonb
        )
        ${upsert ? updateInsertedColumns(["project_id", "study_id", "title", "citation", "retrieval_status", "pdf_name", "file_name", "mime_type", "size", "checksum", "storage_path", "uploaded_by_user_id", "uploaded_by_user_name", "full_text_status", "full_text_status_label", "full_text_vote_count", "full_text_required_votes", "is_pdf_validated", "validation_notes", "notes", "payload"]) : ""}
      `,
      [
        report.id,
        report.projectId,
        report.studyId,
        positionOffset + index,
        report.title,
        report.citation,
        report.retrievalStatus,
        report.pdfName ?? null,
        report.fileName ?? null,
        report.mimeType ?? null,
        typeof report.size === "number" ? report.size : null,
        report.checksum ?? null,
        report.storagePath ?? null,
        report.uploadedByUserId ?? null,
        report.uploadedByUserName ?? null,
        report.fullTextStatus ?? null,
        report.fullTextStatusLabel ?? null,
        typeof report.fullTextVoteCount === "number" ? report.fullTextVoteCount : null,
        typeof report.fullTextRequiredVotes === "number" ? report.fullTextRequiredVotes : null,
        Boolean(report.isPdfValidated),
        JSON.stringify(asArray(report.validationNotes)),
        Number(report.notes ?? 0),
        JSON.stringify(report)
      ]
    );
  }
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
  const checkoutsByProject = new Map();
  const projectIds = new Set(asArray(state.projects).map((project) => project.id));
  for (const checkout of asArray(state.screeningCheckouts)) {
    if (!projectIds.has(checkout.projectId)) continue;
    const checkouts = checkoutsByProject.get(checkout.projectId) ?? [];
    checkouts.push(checkout);
    checkoutsByProject.set(checkout.projectId, checkouts);
  }
  for (const [projectId, checkouts] of checkoutsByProject) {
    await writeScreeningCheckouts(client, projectId, checkouts);
  }
  // Resolve ownership after all records (including duplicate candidates) are saved.
  await pruneWorkflowEvents(client, state.reviewSettings?.auditHistoryLimit);
}

function normalizeAuditHistoryLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit >= 1 ? Math.min(10000, Math.round(limit)) : 100;
}

function rankedWorkflowEventsSql() {
  return `WITH ranked_events AS (
    SELECT e.*, ROW_NUMBER() OVER (
      PARTITION BY COALESCE(
        c.payload->>'projectId', c.payload->'recordA'->>'projectId',
        c.payload->'recordB'->>'projectId',
        CASE WHEN c.id IS NOT NULL THEN 'demo-review' END,
        r.project_id, r.payload->>'projectId',
        s.project_id, s.payload->>'projectId', p.id, ''
      )
      ORDER BY e.payload->>'time' DESC, e.position ASC, e.id ASC
    ) AS project_rank
    FROM workflow_events e
    LEFT JOIN review_projects p ON p.id = e.entity
    LEFT JOIN review_studies s ON s.id = e.entity
    LEFT JOIN review_reports r ON r.id = e.entity
    LEFT JOIN review_dedup_candidates c ON c.id = e.entity
  )`;
}

async function pruneWorkflowEvents(client, limit) {
  await client.query(
    `${rankedWorkflowEventsSql()}
     DELETE FROM workflow_events WHERE id IN (
       SELECT id FROM ranked_events WHERE project_rank > $1
     )`,
    [normalizeAuditHistoryLimit(limit)]
  );
}

async function appendWorkflowEvent(client, event) {
  // Serialize incremental appends so each project keeps its newest events.
  await client.query("LOCK TABLE workflow_events IN SHARE ROW EXCLUSIVE MODE");
  await client.query(
    `INSERT INTO workflow_events (id, entity, position, payload)
     VALUES ($1, $2, COALESCE((SELECT MIN(position) FROM workflow_events), 0) - 1, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET entity = EXCLUDED.entity, payload = EXCLUDED.payload`,
    [event.id, event.entity ?? null, JSON.stringify(event)]
  );
  const settings = await client.query("SELECT audit_history_limit FROM review_settings WHERE id = 1");
  await pruneWorkflowEvents(client, settings.rows[0]?.audit_history_limit);
}

async function writeImportStudyMutation(client, mutation) {
  await client.query("BEGIN");
  try {
    if (mutation.__expectedRevision !== undefined) {
      await lockStateTables(client);
      if (await readStorageRevision(client) !== mutation.__expectedRevision) {
        await client.query("ROLLBACK");
        process.stdout.write(JSON.stringify({ updated: false }));
        return;
      }
    }
    const { study, studyPosition, batch, batchPosition, project, reports, event, dedupCandidates } = mutation;
    await client.query(
      `
        INSERT INTO review_studies (
          id, project_id, import_batch_id, position, import_item_id,
          title, abstract, authors, journal, year, doi, source, stage,
          keywords, raw_citation, parser_warnings, payload
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8::jsonb, $9, $10, $11, $12, $13,
          $14::jsonb, $15, $16::jsonb, $17::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          import_batch_id = EXCLUDED.import_batch_id,
          import_item_id = EXCLUDED.import_item_id,
          title = EXCLUDED.title,
          abstract = EXCLUDED.abstract,
          authors = EXCLUDED.authors,
          journal = EXCLUDED.journal,
          year = EXCLUDED.year,
          doi = EXCLUDED.doi,
          source = EXCLUDED.source,
          stage = EXCLUDED.stage,
          keywords = EXCLUDED.keywords,
          raw_citation = EXCLUDED.raw_citation,
          parser_warnings = EXCLUDED.parser_warnings,
          payload = EXCLUDED.payload
      `,
      [
        study.id,
        study.projectId ?? null,
        study.importBatchId ?? null,
        studyPosition,
        typeof study.importItemId === "number" ? study.importItemId : null,
        study.title,
        study.abstract,
        JSON.stringify(asArray(study.authors)),
        study.journal,
        Number(study.year ?? 0),
        study.doi,
        study.source,
        study.stage,
        JSON.stringify(asArray(study.keywords)),
        study.rawCitation ?? null,
        JSON.stringify(asArray(study.parserWarnings)),
        JSON.stringify(study)
      ]
    );
    await client.query(
      `
        INSERT INTO import_batches (id, project_id, position, payload)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          project_id = EXCLUDED.project_id,
          payload = EXCLUDED.payload
      `,
      [batch.id, batch.projectId ?? null, batchPosition, JSON.stringify(batch)]
    );

    const projectUpdate = await client.query(
      `
        UPDATE review_projects SET
          status = $1,
          stage = $2,
          last_event = $3,
          updated_at_text = $4,
          records_total = $5,
          records_screened = $6,
          conflicts = $7,
          studies_included = $8,
          payload = $9::jsonb
        WHERE id = $10
      `,
      [
        project.status,
        project.stage,
        project.lastEvent,
        project.updatedAt,
        Number(project.recordsTotal ?? 0),
        Number(project.recordsScreened ?? 0),
        Number(project.conflicts ?? 0),
        Number(project.studiesIncluded ?? 0),
        JSON.stringify(project),
        project.id
      ]
    );
    if (projectUpdate.rowCount !== 1) {
      throw new Error("Project was not found while saving the imported citation.");
    }

    for (const { report } of reports) {
      await client.query(
        `
          UPDATE review_reports SET title = $1, citation = $2, payload = $3::jsonb
          WHERE id = $4 AND project_id = $5 AND study_id = $6
        `,
        [report.title, report.citation, JSON.stringify(report), report.id, report.projectId, report.studyId]
      );
    }

    await appendWorkflowEvent(client, event);

    if (Array.isArray(dedupCandidates)) {
      await client.query(
        `
          DELETE FROM review_dedup_candidates
          WHERE record_a_id IN (SELECT id FROM review_studies WHERE project_id = $1)
             OR record_b_id IN (SELECT id FROM review_studies WHERE project_id = $1)
        `,
        [project.id]
      );
      const positionResult = await client.query("SELECT COALESCE(MAX(position), 0) AS max_position FROM review_dedup_candidates");
      const firstPosition = Number(positionResult.rows[0]?.max_position ?? 0) + 1;
      for (let index = 0; index < dedupCandidates.length; index += 1) {
        const candidate = dedupCandidates[index];
        await client.query(
          `
            INSERT INTO review_dedup_candidates (id, record_a_id, record_b_id, position, payload)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            ON CONFLICT (id) DO UPDATE SET
              record_a_id = EXCLUDED.record_a_id,
              record_b_id = EXCLUDED.record_b_id,
              position = EXCLUDED.position,
              payload = EXCLUDED.payload
          `,
          [candidate.id, candidate.recordA?.id ?? null, candidate.recordB?.id ?? null, firstPosition + index, JSON.stringify(candidate)]
        );
      }
    }

    await client.query("COMMIT");
    process.stdout.write(JSON.stringify({ updated: true }));
  } catch (error) {
    await client.query("ROLLBACK");
    if (error?.code === "55P03" || error?.code === "40P01" || error?.code === "40001") {
      process.stdout.write(JSON.stringify({ updated: false }));
      return;
    }
    throw error;
  }
}

async function readImportRevision(client, projectId) {
  // Hash database rows, rather than normalized application objects, so a retry can
  // detect every change affecting project metadata, item numbering, or deduplication.
  const result = await client.query(
    `SELECT md5(jsonb_build_object(
       'project', (SELECT to_jsonb(p) FROM review_projects p WHERE p.id = $1),
       'studies', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
         FROM review_studies s WHERE s.project_id = $1), '[]'::jsonb),
       'imports', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id)
         FROM import_batches b WHERE b.project_id = $1), '[]'::jsonb),
       'dedupCandidates', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id)
         FROM review_dedup_candidates c
         WHERE COALESCE(c.payload->>'projectId', c.payload->'recordA'->>'projectId',
                        c.payload->'recordB'->>'projectId') = $1
            OR c.record_a_id IN (SELECT id FROM review_studies WHERE project_id = $1)
            OR c.record_b_id IN (SELECT id FROM review_studies WHERE project_id = $1)), '[]'::jsonb)
     )::text) AS revision`,
    [projectId]
  );
  return result.rows[0].revision;
}

const stateTables = [
  ["app_users", "id"], ["auth_settings", "id"], ["review_settings", "id"],
  ["review_projects", "id"], ["import_batches", "id"], ["review_studies", "id"],
  ["review_reports", "id"], ["review_extraction_templates", "id"],
  ["review_extraction_responses", "id"], ["review_extraction_consensus", "id"],
  ["review_decisions", "id"], ["review_screening_checkouts", "project_id"],
  ["workflow_events", "id"], ["review_dedup_candidates", "id"]
];

async function lockStateTables(client, incremental = false) {
  // NOWAIT avoids deadlocks with older mutations that acquire row locks first.
  // A conflict leaves the caller free to reread and recalculate its mutation.
  if (incremental) {
    await client.query("LOCK TABLE app_users, auth_settings, review_settings IN SHARE MODE NOWAIT");
    await client.query(`LOCK TABLE ${stateTables.slice(3).map(([table]) => table).join(", ")} IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
  } else {
    await client.query(`LOCK TABLE ${stateTables.map(([table]) => table).join(", ")} IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
  }
}

async function readStorageRevision(client, projectId) {
  // xmin changes on every database update, including full-state replacement.
  // Hashing IDs and transaction IDs avoids serializing every citation's payload.
  const entries = stateTables.filter(([table]) => projectId === undefined || table !== "workflow_events")
    .map(([table, idColumn]) => {
      let condition = "";
      if (projectId !== undefined && !["app_users", "auth_settings", "review_settings"].includes(table)) {
        if (table === "review_projects") condition = " WHERE id = $1";
        else if (table === "review_dedup_candidates") {
          condition = ` WHERE COALESCE(payload->>'projectId', payload->'recordA'->>'projectId',
            payload->'recordB'->>'projectId') = $1
            OR record_a_id IN (SELECT id FROM review_studies WHERE project_id = $1)
            OR record_b_id IN (SELECT id FROM review_studies WHERE project_id = $1)`;
        } else condition = " WHERE project_id = $1";
      }
      return `'${table}', (SELECT COALESCE(jsonb_agg(jsonb_build_array(${idColumn}, xmin::text) ORDER BY ${idColumn}), '[]'::jsonb) FROM ${table}${condition})`;
    });
  const result = await client.query(
    `SELECT md5(jsonb_build_object(${entries.join(", ")})::text) AS revision`,
    projectId === undefined ? [] : [projectId]
  );
  return result.rows[0].revision;
}

async function readScreeningRevision(client, projectId) {
  return readStorageRevision(client, projectId);
}

async function readStateSnapshot(client, projectId) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const state = await readRelationalState(client);
    const globalRevision = await readStorageRevision(client);
    const revision = projectId === undefined ? undefined : await readScreeningRevision(client, projectId);
    const legacy = state ? "" : await readLegacyBlobState(client);
    await client.query("COMMIT");
    return {
      state: state ? { ...state, __storageRevision: globalRevision }
        : legacy ? { ...JSON.parse(legacy), __storageRevision: globalRevision } : null,
      revision
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function readScreeningState(client, projectId) {
  return readStateSnapshot(client, projectId);
}

async function writeScreeningCheckouts(client, projectId, checkouts) {
  if (checkouts.length === 0) {
    await client.query("DELETE FROM review_screening_checkouts WHERE project_id = $1", [projectId]);
    return;
  }
  await client.query(
    `INSERT INTO review_screening_checkouts (project_id, payload) VALUES ($1, $2::jsonb)
     ON CONFLICT (project_id) DO UPDATE SET payload = EXCLUDED.payload`,
    [projectId, JSON.stringify(checkouts)]
  );
}

async function writeScreeningProject(client, currentProject, project) {
  // Screening owns summary fields; metadata and membership stay with their writers.
  const updated = {
    ...currentProject,
    status: project.status,
    stage: project.stage,
    lastEvent: project.lastEvent,
    updatedAt: project.updatedAt,
    recordsTotal: project.recordsTotal,
    recordsScreened: project.recordsScreened,
    conflicts: project.conflicts,
    studiesIncluded: project.studiesIncluded
  };
  await client.query(
    `UPDATE review_projects SET status = $1, stage = $2, last_event = $3,
       updated_at_text = $4, records_total = $5, records_screened = $6,
       conflicts = $7, studies_included = $8, payload = $9::jsonb WHERE id = $10`,
    [updated.status, updated.stage, updated.lastEvent, updated.updatedAt,
      Number(updated.recordsTotal ?? 0), Number(updated.recordsScreened ?? 0),
      Number(updated.conflicts ?? 0), Number(updated.studiesIncluded ?? 0),
      JSON.stringify(updated), updated.id]
  );
}

async function writeScreeningPatch(client, mutation) {
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await lockStateTables(client, true);
    const { userId, projectId, revision, project, changes = {}, screeningCheckouts, events = [], sessionVersion } = mutation;
    const actorResult = await client.query("SELECT id, name, is_admin, email_auth FROM app_users WHERE id = $1", [userId]);
    const actor = actorResult.rows[0];
    const currentProject = (await readProjects(client)).find((candidate) => candidate.id === projectId);
    const authSettings = await client.query("SELECT transactional_email_enabled FROM auth_settings WHERE id = 1");
    let accessError;
    if (!actor || (sessionVersion !== undefined && (actor.email_auth?.sessionVersion ?? "") !== sessionVersion) ||
        (authSettings.rows[0]?.transactional_email_enabled && actor.email_auth?.verificationRequired)) {
      accessError = { updated: false, status: 401, error: "Your session is no longer valid. Sign in again." };
    } else if (!currentProject || (!actor.is_admin && ![
      currentProject.ownerId, ...asArray(currentProject.ownerIds), ...asArray(currentProject.memberIds)
    ].includes(userId))) {
      accessError = { updated: false, status: 403, error: "You do not have access to that project." };
    }
    if (accessError) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return accessError;
    }
    if (!revision || await readScreeningRevision(client, projectId) !== revision) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { updated: false };
    }
    const patchTables = {
      studies: "review_studies", reports: "review_reports",
      decisions: "review_decisions", extractionConsensus: "review_extraction_consensus"
    };
    if ((project && project.id !== projectId) || !Array.isArray(screeningCheckouts) ||
        screeningCheckouts.some((checkout) => checkout.projectId !== projectId) ||
        !Array.isArray(events) || Object.keys(changes).some((key) => !patchTables[key])) {
      throw new Error("Screening persistence data is incomplete.");
    }
    for (const [key, change] of Object.entries(changes)) {
      if (!Array.isArray(change.upserts) || !Array.isArray(change.deleteIds) ||
          change.upserts.some((item) => !item.id || item.projectId !== projectId) ||
          change.deleteIds.some((id) => typeof id !== "string")) {
        throw new Error("Screening persistence data is incomplete.");
      }
      const table = patchTables[key];
      if (change.upserts.length > 0) {
        const existing = await client.query(`SELECT id, project_id FROM ${table} WHERE id = ANY($1::text[])`, [change.upserts.map((item) => item.id)]);
        if (existing.rows.some((row) => row.project_id !== projectId)) {
          throw new Error("Screening persistence cannot move records between reviews.");
        }
      }
    }
    for (const [key, change] of Object.entries(changes)) {
      const table = patchTables[key];
      if (change.deleteIds.length > 0) {
        await client.query(`DELETE FROM ${table} WHERE id = ANY($1::text[]) AND project_id = $2`, [change.deleteIds, projectId]);
      }
      if (change.upserts.length === 0) continue;
      const positions = await client.query(`SELECT COALESCE(MAX(position), -1) + 1 AS position FROM ${table}`);
      const firstPosition = Number(positions.rows[0].position);
      if (key === "studies") {
        await writeStudies(client, { studies: change.upserts }, firstPosition, true);
      } else if (key === "reports") {
        await writeReports(client, { reports: change.upserts }, firstPosition, true);
      } else {
        const config = tableConfigs.find((candidate) => candidate.arrayKey === key);
        const columns = [config.idColumn, ...config.extraColumns, "payload"];
        for (let index = 0; index < change.upserts.length; index += 1) {
          await client.query(
            `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, valueIndex) => `$${valueIndex + 1}`).join(", ")})
             ${updateInsertedColumns(columns.filter((column) => column !== "id" && column !== "position"))}`,
            config.valuesForItem(change.upserts[index], firstPosition + index)
          );
        }
      }
    }
    if (project) await writeScreeningProject(client, currentProject, project);
    await writeScreeningCheckouts(client, projectId, screeningCheckouts);
    // Preserve events appended by other reviews. The caller supplies new events only.
    for (const event of events) await appendWorkflowEvent(client, event);
    await client.query("COMMIT");
    transactionOpen = false;
    return { updated: true };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    if (error?.code === "55P03" || error?.code === "40P01" || error?.code === "40001") {
      return { updated: false };
    }
    throw error;
  }
}

async function writeFullStateMutation(client, parsed) {
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await lockStateTables(client);
    if (parsed.__expectedRevision !== undefined && await readStorageRevision(client) !== parsed.__expectedRevision) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { updated: false };
    }
    const nextState = { ...defaultState(), ...parsed };
    await writeAuthSettings(client, nextState);
    await writeReviewSettings(client, nextState);
    await writeUsers(client, nextState);
    await truncateReviewStateTables(client);
    await writeProjects(client, nextState);
    await writeStudies(client, nextState);
    await writeReports(client, nextState);
    await writeReviewTables(client, nextState);
    const revision = await readStorageRevision(client);
    await client.query("COMMIT");
    transactionOpen = false;
    return { updated: true, revision };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    if (error?.code === "55P03" || error?.code === "40P01" || error?.code === "40001") return { updated: false };
    throw error;
  }
}

async function readImportState(client, projectId) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const state = await readRelationalState(client);
    const revision = await readImportRevision(client, projectId);
    await client.query("COMMIT");
    return { state, revision };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function writeImportBatchMutation(client, mutation) {
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    // Do not wait while holding some locks: full-state writers acquire user locks
    // before review-table locks, and incremental mutations use their own order.
    await client.query("LOCK TABLE app_users IN SHARE MODE NOWAIT");
    await client.query(`LOCK TABLE review_projects, import_batches, review_studies,
      review_reports, review_dedup_candidates, workflow_events
      IN SHARE ROW EXCLUSIVE MODE NOWAIT`);

    const { userId, projectId, revision, project, batch, studies, reports, dedupCandidates, event } = mutation;
    const users = await client.query("SELECT id, is_admin FROM app_users WHERE id = $1", [userId]);
    const actor = users.rows[0];
    const currentProject = (await readProjects(client)).find((candidate) => candidate.id === projectId);
    let accessError;
    if (!actor) {
      accessError = { updated: false, status: 401, error: "Your session is no longer valid. Sign in again." };
    } else if (!currentProject || (!actor.is_admin && ![
      currentProject.ownerId, ...asArray(currentProject.ownerIds), ...asArray(currentProject.memberIds)
    ].includes(userId))) {
      accessError = { updated: false, status: 403, error: "You do not have access to that project." };
    }
    if (accessError) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return accessError;
    }
    if (await readImportRevision(client, projectId) !== revision) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return { updated: false };
    }

    if (project?.id !== projectId || batch?.projectId !== projectId || event?.entity !== projectId ||
        !Array.isArray(studies) || !Array.isArray(reports) || !Array.isArray(dedupCandidates) ||
        studies.some((study) => study.projectId !== projectId || study.importBatchId !== batch.id) ||
        reports.some((report) => report.projectId !== projectId || !studies.some((study) => study.id === report.studyId)) ||
        dedupCandidates.some((candidate) =>
          (candidate.projectId ?? candidate.recordA?.projectId ?? candidate.recordB?.projectId) !== projectId)) {
      throw new Error("Import batch persistence data is incomplete.");
    }

    const batchPosition = await client.query("SELECT COALESCE(MIN(position), 0) - 1 AS position FROM import_batches");
    await client.query(
      "INSERT INTO import_batches (id, project_id, position, payload) VALUES ($1, $2, $3, $4::jsonb)",
      [batch.id, projectId, Number(batchPosition.rows[0].position), JSON.stringify(batch)]
    );
    const studyPosition = await client.query("SELECT COALESCE(MIN(position), 0) AS position FROM review_studies");
    await writeStudies(client, { studies }, Number(studyPosition.rows[0].position) - studies.length);
    const reportPosition = await client.query("SELECT COALESCE(MIN(position), 0) AS position FROM review_reports");
    await writeReports(client, { reports }, Number(reportPosition.rows[0].position) - reports.length);

    // Preserve all fresh project metadata; an import owns only these summary fields.
    const updatedProject = {
      ...currentProject,
      status: project.status,
      stage: project.stage,
      lastEvent: project.lastEvent,
      updatedAt: project.updatedAt,
      recordsTotal: project.recordsTotal
    };
    await client.query(
      `UPDATE review_projects SET status = $1, stage = $2, last_event = $3,
         updated_at_text = $4, records_total = $5, payload = $6::jsonb WHERE id = $7`,
      [updatedProject.status, updatedProject.stage, updatedProject.lastEvent, updatedProject.updatedAt,
        Number(updatedProject.recordsTotal ?? 0), JSON.stringify(updatedProject), projectId]
    );

    await client.query(
      `DELETE FROM review_dedup_candidates
       WHERE COALESCE(payload->>'projectId', payload->'recordA'->>'projectId',
                      payload->'recordB'->>'projectId') = $1
          OR record_a_id IN (SELECT id FROM review_studies WHERE project_id = $1)
          OR record_b_id IN (SELECT id FROM review_studies WHERE project_id = $1)`,
      [projectId]
    );
    const candidatePosition = await client.query("SELECT COALESCE(MAX(position), 0) + 1 AS position FROM review_dedup_candidates");
    for (let index = 0; index < dedupCandidates.length; index += 1) {
      const candidate = dedupCandidates[index];
      await client.query(
        `INSERT INTO review_dedup_candidates (id, record_a_id, record_b_id, position, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [candidate.id, candidate.recordA?.id ?? null, candidate.recordB?.id ?? null,
          Number(candidatePosition.rows[0].position) + index, JSON.stringify(candidate)]
      );
    }
    await appendWorkflowEvent(client, event);
    await client.query("COMMIT");
    transactionOpen = false;
    return { updated: true };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    if (error?.code === "55P03" || error?.code === "40P01") {
      return { updated: false };
    }
    throw error;
  }
}

async function writeDedupDecisions(client, mutation) {
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    if (mutation.__expectedRevision !== undefined) {
      await lockStateTables(client);
      if (await readStorageRevision(client) !== mutation.__expectedRevision) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        process.stdout.write(JSON.stringify({ updated: false }));
        return;
      }
    }
    const { candidates, project, event } = mutation;
    const projectLock = await client.query("SELECT id FROM review_projects WHERE id = $1 FOR UPDATE", [project.id]);
    if (projectLock.rowCount !== 1) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      process.stdout.write(JSON.stringify({ updated: false }));
      return;
    }

    for (const { candidate, expectedStatus } of candidates) {
      const current = await client.query(
        "SELECT payload->>'status' AS status FROM review_dedup_candidates WHERE id = $1 FOR UPDATE",
        [candidate.id]
      );
      if (current.rows[0]?.status !== expectedStatus) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        process.stdout.write(JSON.stringify({ updated: false }));
        return;
      }
    }

    for (const { candidate, expectedStatus } of candidates) {
      const update = await client.query(
        `
          UPDATE review_dedup_candidates SET
            record_a_id = $1,
            record_b_id = $2,
            payload = $3::jsonb
          WHERE id = $4 AND payload->>'status' = $5
        `,
        [candidate.recordA?.id ?? null, candidate.recordB?.id ?? null, JSON.stringify(candidate), candidate.id, expectedStatus]
      );
      if (update.rowCount !== 1) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        process.stdout.write(JSON.stringify({ updated: false }));
        return;
      }
    }

    const projectUpdate = await client.query(
      `
        UPDATE review_projects SET
          status = $1,
          stage = $2,
          last_event = $3,
          updated_at_text = $4,
          records_total = $5,
          records_screened = $6,
          conflicts = $7,
          studies_included = $8,
          payload = $9::jsonb
        WHERE id = $10
      `,
      [
        project.status,
        project.stage,
        project.lastEvent,
        project.updatedAt,
        Number(project.recordsTotal ?? 0),
        Number(project.recordsScreened ?? 0),
        Number(project.conflicts ?? 0),
        Number(project.studiesIncluded ?? 0),
        JSON.stringify(project),
        project.id
      ]
    );
    if (projectUpdate.rowCount !== 1) {
      throw new Error("Project was not found while saving the deduplication decision.");
    }

    await appendWorkflowEvent(client, event);
    await client.query("COMMIT");
    transactionOpen = false;
    process.stdout.write(JSON.stringify({ updated: true }));
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    if (error?.code === "55P03" || error?.code === "40P01" || error?.code === "40001") {
      process.stdout.write(JSON.stringify({ updated: false }));
      return;
    }
    throw error;
  }
}

async function writeUserRoleMutation(client, mutation) {
  await client.query("BEGIN");
  try {
    // Serialize role changes and validate fresh roles, including the acting administrator.
    await client.query("LOCK TABLE app_users IN SHARE ROW EXCLUSIVE MODE");
    const { rows: users } = await client.query("SELECT id, is_admin FROM app_users");
    const actor = users.find(user => user.id === mutation.adminUserId);
    const target = users.find(user => user.id === mutation.targetUserId);
    let error;
    if (!actor) error = { error: "Your session is no longer valid. Sign in again.", status: 401 };
    else if (!actor.is_admin) error = { error: "Administrator access is required.", status: 403 };
    else if (typeof mutation.isAdmin !== "boolean") error = { error: "Administrator access must be true or false.", status: 400 };
    else if (!target) error = { error: "Account not found.", status: 404 };
    else if (!mutation.isAdmin && target.is_admin && users.filter(user => user.is_admin).length <= 1) error = { error: "The last administrator cannot be removed.", status: 400 };
    else if (!mutation.isAdmin && target.id === actor.id) error = { error: "Ask another administrator to revoke your administrator access.", status: 400 };
    if (error) {
      await client.query("ROLLBACK");
      return error;
    }
    const changed = target.is_admin !== mutation.isAdmin;
    if (changed) {
      await client.query(`UPDATE app_users SET is_admin = $1,
        email_auth = COALESCE(email_auth, '{}'::jsonb) || jsonb_build_object('sessionVersion', $2::text),
        updated_at = NOW() WHERE id = $3`, [mutation.isAdmin, mutation.sessionVersion, target.id]);
    }
    await client.query("COMMIT");
    return { changed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function run() {
  const action = process.argv[2];
  if (!["read", "read-auth-config", "read-import-state", "read-screening-state", "write", "write-screening-patch", "write-import-batch", "write-import-study", "write-dedup-decisions", "write-user-role"].includes(action)) {
    throw new Error("Usage: node scripts/postgres-state-io.mjs <read|read-auth-config|read-import-state|read-screening-state|write|write-screening-patch|write-import-batch|write-import-study|write-dedup-decisions|write-user-role>");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when PRISMATICA_STORAGE_MODE=postgres.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    if (action === "read-auth-config") {
      await client.query(`
        CREATE TABLE IF NOT EXISTS auth_settings (
          id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          registration_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query("ALTER TABLE auth_settings ADD COLUMN IF NOT EXISTS transactional_email_enabled BOOLEAN NOT NULL DEFAULT FALSE");
      const result = await client.query("SELECT registration_enabled, transactional_email_enabled FROM auth_settings WHERE id = 1");
      process.stdout.write(JSON.stringify({ registrationEnabled: result.rows[0]?.registration_enabled ?? true, transactionalEmailEnabled: result.rows[0]?.transactional_email_enabled ?? false }));
      return;
    }

    await ensureSchema(client);

    if (action === "read") {
      const { state } = await readStateSnapshot(client);
      if (state) process.stdout.write(JSON.stringify(state));
      return;
    }

    const raw = await readStdin();
    if (!raw.trim()) {
      throw new Error("Write mode expects JSON payload via stdin.");
    }

    const parsed = JSON.parse(raw);
    if (action === "read-screening-state") {
      process.stdout.write(JSON.stringify(await readScreeningState(client, parsed.projectId)));
      return;
    }
    if (action === "write-screening-patch") {
      process.stdout.write(JSON.stringify(await writeScreeningPatch(client, parsed)));
      return;
    }
    if (action === "read-import-state") {
      process.stdout.write(JSON.stringify(await readImportState(client, parsed.projectId)));
      return;
    }
    if (action === "write-import-batch") {
      process.stdout.write(JSON.stringify(await writeImportBatchMutation(client, parsed)));
      return;
    }
    if (action === "write-user-role") {
      process.stdout.write(JSON.stringify(await writeUserRoleMutation(client, parsed)));
      return;
    }
    if (action === "write-import-study") {
      await writeImportStudyMutation(client, parsed);
      return;
    }
    if (action === "write-dedup-decisions") {
      await writeDedupDecisions(client, parsed);
      return;
    }

    process.stdout.write(JSON.stringify(await writeFullStateMutation(client, parsed)));
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  // Best-effort rollback if a transaction is open.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
