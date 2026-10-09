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

    ALTER TABLE app_users ADD COLUMN IF NOT EXISTS website_width TEXT NOT NULL DEFAULT 'full' CHECK (website_width IN ('full', 'limited'));

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
             avatar_color, website_theme, website_width, password_hash, password_salt, created_at, updated_at
      FROM app_users
      ORDER BY created_at ASC, id ASC
    `
  );
  const authSettingsResult = await client.query(
    `
      SELECT
        registration_enabled
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
  const auditLimit = normalizeAuditHistoryLimit(reviewSettingsResult.rows[0]?.audit_history_limit);
  const eventRows = await client.query(
    `SELECT payload::text AS payload FROM workflow_events
     ORDER BY payload->>'time' DESC, position ASC, id ASC LIMIT $1`, [auditLimit]
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
    events.length > 0 ||
    dedupCandidates.length > 0;

  if (!hasRelationalState) {
    return null;
  }

  return {
    version: stateVersion,
    authSettings: {
      registrationEnabled: authSettingsResult.rows[0]?.registration_enabled ?? true,
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
      websiteWidth: row.website_width === "limited" ? "limited" : "full",
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
          created_at, updated_at, website_width
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
        user.websiteWidth === "limited" ? "limited" : "full"
      ]
    );
  }
}

async function writeAuthSettings(client, state) {
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
    [
      state.authSettings?.registrationEnabled ?? true
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

async function writeStudies(client, state) {
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
      `,
      [
        study.id,
        study.projectId ?? null,
        study.importBatchId ?? null,
        index,
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

async function writeReports(client, state) {
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
      `,
      [
        report.id,
        report.projectId,
        report.studyId,
        index,
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
    let items = Array.isArray(state[config.arrayKey]) ? state[config.arrayKey] : [];
    if (config.arrayKey === "events") {
      items = items.slice().sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
        .slice(0, normalizeAuditHistoryLimit(state.reviewSettings?.auditHistoryLimit));
    }
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

function normalizeAuditHistoryLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit >= 1 ? Math.min(10000, Math.round(limit)) : 100;
}

async function appendWorkflowEvent(client, event) {
  // Serialize incremental appends so pruning keeps the newest events across reviews.
  await client.query("LOCK TABLE workflow_events IN SHARE ROW EXCLUSIVE MODE");
  await client.query(
    `INSERT INTO workflow_events (id, entity, position, payload)
     VALUES ($1, $2, COALESCE((SELECT MIN(position) FROM workflow_events), 0) - 1, $3::jsonb)
     ON CONFLICT (id) DO UPDATE SET entity = EXCLUDED.entity, payload = EXCLUDED.payload`,
    [event.id, event.entity ?? null, JSON.stringify(event)]
  );
  const settings = await client.query("SELECT audit_history_limit FROM review_settings WHERE id = 1");
  await client.query(
    `DELETE FROM workflow_events WHERE id IN (
       SELECT id FROM workflow_events
       ORDER BY payload->>'time' DESC, position ASC, id ASC OFFSET $1
     )`,
    [normalizeAuditHistoryLimit(settings.rows[0]?.audit_history_limit)]
  );
}

async function writeImportStudyMutation(client, mutation) {
  await client.query("BEGIN");
  try {
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
          position = EXCLUDED.position,
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
          position = EXCLUDED.position,
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
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function writeDedupDecisions(client, mutation) {
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
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
    throw error;
  }
}

async function run() {
  const action = process.argv[2];
  if (action !== "read" && action !== "read-auth-config" && action !== "write" && action !== "write-import-study" && action !== "write-dedup-decisions") {
    throw new Error("Usage: node scripts/postgres-state-io.mjs <read|read-auth-config|write|write-import-study|write-dedup-decisions>");
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
      const result = await client.query("SELECT registration_enabled FROM auth_settings WHERE id = 1");
      process.stdout.write(JSON.stringify({ registrationEnabled: result.rows[0]?.registration_enabled ?? true }));
      return;
    }

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
    if (action === "write-import-study") {
      await writeImportStudyMutation(client, parsed);
      return;
    }
    if (action === "write-dedup-decisions") {
      await writeDedupDecisions(client, parsed);
      return;
    }

    const nextState = {
      ...defaultState(),
      ...parsed
    };
    await client.query("BEGIN");
    await writeAuthSettings(client, nextState);
    await writeReviewSettings(client, nextState);
    await writeUsers(client, nextState);
    await truncateReviewStateTables(client);
    await writeProjects(client, nextState);
    await writeStudies(client, nextState);
    await writeReports(client, nextState);
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
