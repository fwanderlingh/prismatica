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

    CREATE TABLE IF NOT EXISTS checkout_window_settings (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      screening_checkout_window_minutes INTEGER NOT NULL DEFAULT 60,
      extraction_checkout_window_minutes INTEGER NOT NULL DEFAULT 120,
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
  return Math.max(1, Math.min(120, Math.round(numericValue)));
}

function defaultState() {
  return {
    version: stateVersion,
    authSettings: {
      registrationEnabled: true,
      screeningCheckoutWindowMinutes: 60,
      extractionCheckoutWindowMinutes: 120
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
             avatar_color, website_theme, password_hash, password_salt, created_at, updated_at
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
  const checkoutWindowSettingsResult = await client.query(
    `
      SELECT
        screening_checkout_window_minutes,
        extraction_checkout_window_minutes
      FROM checkout_window_settings
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
      registrationEnabled: authSettingsResult.rows[0]?.registration_enabled ?? true,
    },
    checkoutWindowSettings: {
      screeningCheckoutWindowMinutes: checkoutWindowSettingsResult.rows[0]?.screening_checkout_window_minutes ?? 2,
      extractionCheckoutWindowMinutes: checkoutWindowSettingsResult.rows[0]?.extraction_checkout_window_minutes ?? 15
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

async function writeCheckoutWindowSettings(client, state) {
  await client.query(
    `
      INSERT INTO checkout_window_settings (
        id, screening_checkout_window_minutes,
        extraction_checkout_window_minutes, updated_at
      )
      VALUES (1, $1, $2, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        screening_checkout_window_minutes = EXCLUDED.screening_checkout_window_minutes,
        extraction_checkout_window_minutes = EXCLUDED.extraction_checkout_window_minutes,
        updated_at = NOW()
    `,
    [
      clampCheckoutWindowMinutes(state.checkoutWindowSettings?.screeningCheckoutWindowMinutes, 60),
      clampCheckoutWindowMinutes(state.checkoutWindowSettings?.extractionCheckoutWindowMinutes, 120)
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
    await writeCheckoutWindowSettings(client, nextState);
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
