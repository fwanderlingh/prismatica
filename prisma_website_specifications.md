PRISMA WEBSITE SPECIFICATION
============================

PRISMA 2020 flow diagrams track records identified, records screened/excluded, reports sought/retrieved/assessed, reports excluded with reasons, and studies included; collapsing all of that into one `Studies` table will make correct PRISMA export painful later. PRISMA’s own flow-diagram guidance says the diagram maps records identified, included, excluded, and exclusion reasons, with different templates for new/updated reviews and for database-only versus database-plus-other-source reviews. ([PRISMA statement][1])

Below is the implementation blueprint I would use.

---

# 1. Core architecture

Use a modular monolith first. A distributed microservice design is unnecessary until import volume, PDF processing, or AI-assisted screening becomes large.

**Stack**:

Frontend:        Next.js + React + TypeScript
Backend:         NestJS + TypeScript
Database:        PostgreSQL
Search:          PostgreSQL Full-Text Search
Queue:           Valkey + BullMQ
File storage:    MinIO
PDF viewer:      PDF.js
Background jobs: BullMQ Workers
Auth:            Keycloak
Authorization:   PostgreSQL-backed RBAC + NestJS Guards

The backend should expose the review workflow through a small number of services:

```text
ImportService
DeduplicationService
ScreeningService
ConflictResolutionService
FullTextService
ExtractionService
RiskOfBiasService
PrismaExportService
AuditLogService
NotificationService
```

The key principle: **every reviewer action is append-only**. You may show the latest decision in the UI, but the database should preserve the historical sequence of decisions, overrides, adjudications, and exports.

---

# 2. Correct domain model: Record → Report → Study

This is the most important data-model decision.

```text
Imported record
  = one citation entry from PubMed, Embase, Scopus, etc.

Deduplicated study candidate
  = canonical review unit created from one or more imported records

Report
  = a full-text article/PDF/report associated with a study

Study
  = the real underlying research study, which may have one or more reports
```

One clinical trial can have multiple published reports. PRISMA 2020 makes this distinction visible in the flow diagram, especially around “reports sought,” “reports not retrieved,” “reports assessed,” and “studies included.” PRISMA 2020 replaced the 2009 statement and includes revised flow diagrams for original and updated reviews. ([ScienceDirect][2])

---

# 3. PostgreSQL schema outline

This is a practical schema skeleton.

```sql
-- Users and tenancy
users (
  id uuid primary key,
  email citext unique not null,
  name text,
  created_at timestamptz not null default now()
);

organizations (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

projects (
  id uuid primary key,
  organization_id uuid references organizations(id),
  title text not null,
  review_type text not null default 'systematic_review',
  prisma_template text not null default 'new_databases_registers_only',
  blind_mode boolean not null default true,
  abstract_required_votes int not null default 2,
  fulltext_required_votes int not null default 2,
  maybe_policy text not null default 'advance_to_full_text',
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

project_memberships (
  project_id uuid references projects(id),
  user_id uuid references users(id),
  role text not null check (role in ('owner','admin','reviewer','adjudicator','viewer')),
  primary key (project_id, user_id)
);
```

---

## Import and record provenance

```sql
import_batches (
  id uuid primary key,
  project_id uuid references projects(id),
  source_name text not null, -- PubMed, Embase, Scopus, manual, etc.
  original_filename text,
  file_format text not null check (file_format in ('ris','bib','endnote_xml','csv')),
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now(),
  parser_version text not null,
  status text not null default 'processing'
);

records (
  id uuid primary key,
  project_id uuid references projects(id),
  import_batch_id uuid references import_batches(id),

  raw_payload jsonb not null,
  source_record_id text,

  title text,
  abstract text,
  authors jsonb,
  first_author text,
  journal text,
  year int,
  doi text,
  pmid text,
  pmcid text,
  volume text,
  issue text,
  pages text,
  keywords text[],

  normalized_title text,
  normalized_doi text,
  normalized_first_author text,

  created_at timestamptz not null default now()
);
```

Keep the original `raw_payload`. You will need it when users complain that a title, abstract, author list, or DOI was parsed incorrectly.

For RIS specifically, expect repeated tags, multi-line field values, and inconsistent tag usage across databases. The RIS format is tag-based, with records beginning with `TY` and ending with `ER`, and tags such as author/keyword may repeat. ([Gris Documentation][3]) EndNote XML should be supported, but Clarivate notes that EndNote XML export is not intended for third-party import and recommends RIS for third-party software/databases, so treat EndNote XML as a best-effort compatibility feature rather than your canonical ingest path. ([Clarivate Support][4])

---

## Deduplication

```sql
dedup_groups (
  id uuid primary key,
  project_id uuid references projects(id),
  canonical_record_id uuid references records(id),
  status text not null check (status in ('pending','auto_merged','confirmed','rejected','needs_review')),
  created_at timestamptz not null default now()
);

dedup_group_records (
  dedup_group_id uuid references dedup_groups(id),
  record_id uuid references records(id),
  match_score numeric(5,4),
  match_method text,
  match_explanation jsonb,
  added_by text not null check (added_by in ('algorithm','user')),
  primary key (dedup_group_id, record_id)
);

studies (
  id uuid primary key,
  project_id uuid references projects(id),
  dedup_group_id uuid references dedup_groups(id),
  canonical_record_id uuid references records(id),

  title text,
  abstract text,
  authors jsonb,
  journal text,
  year int,
  doi text,

  current_stage text not null default 'title_abstract',
  lifecycle_status text not null default 'active',
  created_at timestamptz not null default now()
);
```

Do **not** delete duplicates. Mark them as duplicate records attached to a canonical study. That preserves import counts and duplicate-removal counts for PRISMA export.

---

## Reports and PDFs

```sql
reports (
  id uuid primary key,
  project_id uuid references projects(id),
  study_id uuid references studies(id),

  title text,
  doi text,
  citation text,
  retrieval_status text not null default 'not_sought'
    check (retrieval_status in ('not_sought','sought','retrieved','not_retrieved')),

  pdf_file_id uuid,
  created_at timestamptz not null default now()
);

file_assets (
  id uuid primary key,
  project_id uuid references projects(id),
  uploaded_by uuid references users(id),
  storage_key text not null,
  original_filename text,
  mime_type text,
  byte_size bigint,
  sha256 text,
  virus_scan_status text not null default 'pending',
  created_at timestamptz not null default now()
);
```

PRISMA export depends on knowing whether a report was sought, retrieved, not retrieved, assessed, or excluded with a reason.

---

# 4. Decisions and blind voting

Use an append-only `decisions` table. Never overwrite the only copy of a decision.

```sql
decisions (
  id uuid primary key,
  project_id uuid references projects(id),
  study_id uuid references studies(id),
  report_id uuid references reports(id),

  stage text not null check (stage in ('title_abstract','full_text','extraction','risk_of_bias')),
  user_id uuid references users(id),

  decision_value text not null
    check (decision_value in ('include','exclude','maybe','not_retrieved')),

  exclusion_reason_id uuid,
  note text,

  is_current boolean not null default true,
  supersedes_decision_id uuid references decisions(id),

  created_at timestamptz not null default now(),

  check (
    not (stage = 'full_text' and decision_value = 'exclude')
    or exclusion_reason_id is not null
  )
);

-- One current title/abstract vote per reviewer per study.
create unique index one_current_tiab_decision
on decisions(project_id, study_id, user_id, stage)
where is_current = true and stage = 'title_abstract';

-- One current full-text vote per reviewer per report.
create unique index one_current_fulltext_decision
on decisions(project_id, report_id, user_id, stage)
where is_current = true and stage = 'full_text';
```

Full-text exclusion reasons should be structured:

```sql
exclusion_reasons (
  id uuid primary key,
  project_id uuid references projects(id),
  label text not null,
  description text,
  prisma_display_order int not null default 0,
  is_active boolean not null default true
);
```

Covidence’s own guidance notes that full-text screening follows title/abstract screening, that excluded studies need a reason that can be displayed in the PRISMA figure, and that full-text screening should ideally be done by two independent reviewers with conflict resolution or adjudication. ([Covidence][5])

---

# 5. Consensus and adjudication

Do not encode final consensus only by mutating reviewer votes. Store explicit adjudication records.

```sql
adjudications (
  id uuid primary key,
  project_id uuid references projects(id),
  study_id uuid references studies(id),
  report_id uuid references reports(id),
  stage text not null,

  final_decision text not null
    check (final_decision in ('include','exclude','maybe','not_retrieved')),

  final_exclusion_reason_id uuid references exclusion_reasons(id),
  resolved_by uuid references users(id),
  resolution_method text not null
    check (resolution_method in ('consensus_meeting','third_reviewer','project_lead','auto_rule')),

  rationale text,
  created_at timestamptz not null default now()
);
```

This gives you defensible auditability. Rayyan’s current conflict-resolution documentation says conflicts are visible only when blind mode is off, that “Maybe” is treated as tentative and does not itself trigger a conflict, and that opposing final Include vs Exclude decisions create conflicts that must be resolved before moving forward. ([help.rayyan.ai][6])

---

# 6. State machine logic

Use a central state-machine service. Do not scatter transition logic across controllers.

A reasonable default policy:

| Stage          | Vote pattern                              | Result                                               |
| -------------- | ----------------------------------------- | ---------------------------------------------------- |
| Title/abstract | Include + Include                         | Advance to full-text                                 |
| Title/abstract | Exclude + Exclude                         | Exclude at abstract stage                            |
| Title/abstract | Include + Exclude                         | Conflict                                             |
| Title/abstract | Include + Maybe                           | Advance or maybe queue, depending on project setting |
| Title/abstract | Exclude + Maybe                           | Advance or maybe queue, conservative default         |
| Full-text      | Include + Include                         | Advance to extraction                                |
| Full-text      | Exclude + Exclude, same/compatible reason | Exclude with reason                                  |
| Full-text      | Include + Exclude                         | Conflict                                             |
| Full-text      | Exclude + Exclude, different reasons      | Reason conflict or require adjudication              |
| Full-text      | Report not retrieved                      | Count as report not retrieved                        |

Example service logic:

```ts
type DecisionValue = 'include' | 'exclude' | 'maybe' | 'not_retrieved';

function evaluateStage(
  stage: 'title_abstract' | 'full_text',
  decisions: DecisionValue[],
  requiredVotes: number,
  maybePolicy: 'advance_to_full_text' | 'conflict' | 'third_vote'
) {
  if (decisions.length < requiredVotes) {
    return { state: 'awaiting_votes' };
  }

  const hasInclude = decisions.includes('include');
  const hasExclude = decisions.includes('exclude');
  const hasMaybe = decisions.includes('maybe');

  if (hasInclude && hasExclude) {
    return { state: 'conflict' };
  }

  if (stage === 'title_abstract') {
    if (decisions.every(d => d === 'include')) {
      return { state: 'advance_full_text' };
    }

    if (decisions.every(d => d === 'exclude')) {
      return { state: 'excluded_abstract' };
    }

    if (hasMaybe) {
      if (maybePolicy === 'advance_to_full_text') {
        return { state: 'advance_full_text' };
      }
      if (maybePolicy === 'third_vote') {
        return { state: 'needs_third_vote' };
      }
      return { state: 'conflict' };
    }
  }

  if (stage === 'full_text') {
    if (decisions.every(d => d === 'include')) {
      return { state: 'advance_extraction' };
    }

    if (decisions.every(d => d === 'exclude')) {
      return { state: 'excluded_full_text' };
    }

    if (decisions.includes('not_retrieved')) {
      return { state: 'report_not_retrieved' };
    }
  }

  return { state: 'manual_review' };
}
```

The important part is that the state machine is configurable per project, but every transition should emit an event.

```sql
workflow_events (
  id uuid primary key,
  project_id uuid references projects(id),
  study_id uuid references studies(id),
  report_id uuid references reports(id),
  event_type text not null,
  payload jsonb not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
```

---

# 7. Blind-mode security rules

Blind mode is not just a frontend condition. It must be enforced server-side.

The reviewer-facing API should return:

```json
{
  "studyId": "...",
  "title": "...",
  "abstract": "...",
  "myDecision": "include",
  "otherReviewerDecision": null,
  "aggregateDecisionState": "awaiting_votes"
}
```

Only project owners, adjudicators, or reviewers after blind mode is disabled should see other reviewers’ decisions.

Be careful about side channels. Do not reveal hidden decisions through:

```text
sort order
filter counts
conflict badges
activity feeds
notifications
reviewer progress by individual paper
export previews
API response timing
```

A safe design is:

```text
Reviewer endpoint:
  shows paper metadata + current user's own decision only

Project admin endpoint:
  shows aggregate progress counts

Adjudication endpoint:
  shows all votes only when allowed by role and blind-mode state
```

---

# 8. Deduplication engine

Use a multi-pass candidate-generation and scoring system. Do not compare every record with every other record.

## Normalization

Create normalized forms:

```text
normalized_title:
  lowercase
  strip punctuation
  normalize unicode
  remove extra whitespace
  remove leading articles if useful
  normalize Greek letters and symbols where possible

normalized_doi:
  lowercase
  strip https://doi.org/
  strip doi:
  trim punctuation

normalized_author:
  lowercase
  remove punctuation
  normalize initials
  handle "van", "de", "di", "von", compound surnames carefully
```

## Matching passes

| Pass | Rule                                        | Action                                   |
| ---- | ------------------------------------------- | ---------------------------------------- |
| 1    | Exact DOI / PMID / PMCID                    | Auto-merge unless contradictory metadata |
| 2    | Exact normalized title + year               | Auto-merge or high-confidence candidate  |
| 3    | Title fingerprint + first author + year ± 1 | Score candidate                          |
| 4    | Fuzzy title + author similarity             | Manual review if borderline              |
| 5    | Same pages + journal + year + first author  | Candidate only                           |

Use blocking keys to avoid quadratic comparisons:

```text
doi key
pmid key
year + first 12 title chars
year + first_author
journal + volume + first_page
title trigram hash buckets
```

## Score example

```text
score =
  0.45 * title_similarity
+ 0.20 * first_author_similarity
+ 0.10 * author_list_overlap
+ 0.10 * year_similarity
+ 0.05 * journal_similarity
+ 0.10 * page_or_doi_support
```

Suggested thresholds:

| Score     | Action                 |
| --------- | ---------------------- |
| ≥ 0.97    | Auto-duplicate         |
| 0.90–0.97 | Manual dedup review    |
| 0.82–0.90 | Low-priority candidate |
| < 0.82    | Not duplicate          |

Store every candidate edge:

```sql
duplicate_candidates (
  id uuid primary key,
  project_id uuid references projects(id),
  record_a_id uuid references records(id),
  record_b_id uuid references records(id),
  score numeric(5,4) not null,
  method text not null,
  explanation jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','confirmed','rejected','auto_confirmed')),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz
);
```

The UI should show side-by-side metadata with highlighted differences:

```text
Title
Authors
Journal
Year
DOI
Abstract
Source database
Import batch
Match explanation
```

---

# 9. High-velocity title/abstract screening UI

The screening page should be optimized around one action loop:

```text
read title/abstract → press I/E/M → next citation appears immediately
```

Key features:

```text
I = Include
E = Exclude
M = Maybe
U = Undo
J/K or arrow keys = navigate
/ = focus search
? = shortcut help
```

Implementation details:

```text
Use virtualized lists for large queues.
Preload the next 5–10 records.
Use optimistic UI updates.
Persist decisions immediately.
Allow undo by inserting a new decision row that supersedes the prior one.
Do not reveal other users’ votes in blind mode.
```

Keyword highlighting should be implemented as project-level rules:

```sql
highlight_rules (
  id uuid primary key,
  project_id uuid references projects(id),
  term text not null,
  rule_type text not null check (rule_type in ('include','exclude','neutral')),
  match_mode text not null default 'word'
    check (match_mode in ('word','phrase','regex')),
  created_by uuid references users(id)
);
```

Render highlights client-side, but evaluate search/filter server-side.

---

# 10. Full-text review module

Full-text review needs a separate workflow because it has different PRISMA semantics.

Features:

```text
PDF upload
PDF viewer
retrieval status: sought / retrieved / not retrieved
full-text include/exclude vote
forced exclusion reason on exclude
full-text conflict dashboard
PDF notes and optional annotations
```

For exclusion reasons, use project-customizable controlled values:

```text
Wrong population
Wrong intervention/exposure
Wrong comparator
Wrong outcome
Wrong study design
Not empirical research
Duplicate publication
Conference abstract only
Full text unavailable
Non-English, if protocol excludes
Outside date range
```

Do not hard-code these globally. Different reviews need different reason taxonomies.

---

# 11. Data extraction system

Use versioned form schemas. Do not allow form changes to silently corrupt existing responses.

```sql
extraction_forms (
  id uuid primary key,
  project_id uuid references projects(id),
  name text not null,
  active_version_id uuid,
  created_at timestamptz not null default now()
);

extraction_form_versions (
  id uuid primary key,
  form_id uuid references extraction_forms(id),
  version int not null,
  schema jsonb not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (form_id, version)
);

extraction_assignments (
  id uuid primary key,
  project_id uuid references projects(id),
  study_id uuid references studies(id),
  form_version_id uuid references extraction_form_versions(id),
  user_id uuid references users(id),
  status text not null default 'assigned'
);

extraction_responses (
  id uuid primary key,
  assignment_id uuid references extraction_assignments(id),
  response jsonb not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

extraction_consensus (
  id uuid primary key,
  project_id uuid references projects(id),
  study_id uuid references studies(id),
  form_version_id uuid references extraction_form_versions(id),
  consensus_response jsonb not null,
  resolved_by uuid references users(id),
  created_at timestamptz not null default now()
);
```

Example form schema:

```json
{
  "sections": [
    {
      "id": "study_characteristics",
      "label": "Study characteristics",
      "fields": [
        {
          "id": "country",
          "label": "Country",
          "type": "text",
          "required": true
        },
        {
          "id": "sample_size",
          "label": "Sample size",
          "type": "number",
          "required": true,
          "min": 0
        },
        {
          "id": "study_design",
          "label": "Study design",
          "type": "select",
          "options": ["RCT", "cohort", "case-control", "cross-sectional"]
        }
      ]
    }
  ]
}
```

Consensus UI should display:

```text
Field name | Reviewer A value | Reviewer B value | Consensus value
```

For numeric fields, support tolerance rules. For example, `10.0` and `10` should not be flagged as a meaningful discrepancy.

---

# 12. Risk of bias / quality assessment

Implement risk of bias as another versioned template system, not as hard-coded pages.

```sql
quality_templates (
  id uuid primary key,
  project_id uuid references projects(id),
  name text not null,
  tool_type text not null, -- rob2, robins_i, custom
  schema jsonb not null,
  created_at timestamptz not null default now()
);

quality_assessments (
  id uuid primary key,
  project_id uuid references projects(id),
  study_id uuid references studies(id),
  template_id uuid references quality_templates(id),
  user_id uuid references users(id),
  responses jsonb not null,
  overall_judgement text,
  support_for_judgement text,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
```

Cochrane RoB 2 uses signalling questions within domains and produces judgements such as “Low risk,” “High risk,” or “Some concerns.” ([Cochrane Methods][7]) ROBINS-I is for non-randomized studies of interventions; Cochrane describes it as using signalling questions as the basis for risk-of-bias judgements, and notes that a first draft of ROBINS-I version 2 is available. ([Cochrane Methods][8])

I would ship:

```text
Custom quality assessment template
RoB 2-style template
ROBINS-I-style template
Consensus comparison UI
Export to CSV
```

Then later add algorithmic judgement support.

---

# 13. PRISMA export engine

Build the PRISMA export as a deterministic report generated from workflow events and final decisions.

Core counts:

```text
records_identified_by_database
records_identified_by_register
records_identified_by_other_source
duplicate_records_removed
records_marked_ineligible_by_automation
records_removed_for_other_reasons
records_screened
records_excluded
reports_sought_for_retrieval
reports_not_retrieved
reports_assessed_for_eligibility
reports_excluded_with_reasons
studies_included_in_review
studies_included_in_meta_analysis
```

The official PRISMA site provides multiple flow diagram templates and states that the PRISMA 2020 templates are distributed under CC BY 4.0, so you can build compatible exports as long as attribution is handled correctly. ([PRISMA statement][1])

Store generated exports:

```sql
exports (
  id uuid primary key,
  project_id uuid references projects(id),
  export_type text not null check (export_type in ('prisma_svg','prisma_png','csv','ris','bib','audit_log')),
  parameters jsonb not null,
  file_asset_id uuid references file_assets(id),
  generated_by uuid references users(id),
  generated_at timestamptz not null default now()
);
```

Validation rules before export:

```text
records_identified >= duplicate_records_removed + records_screened
records_screened = records_excluded + reports_sought_for_retrieval, adjusted for automation removals
reports_sought = reports_retrieved + reports_not_retrieved
reports_assessed = reports_excluded + studies_included, adjusted for multiple reports per study
every full-text exclusion has exactly one report-level exclusion reason
no unresolved conflicts remain in title/abstract or full-text stages
```

---

# 14. API shape

A clean REST API would look like this:

```text
POST   /projects
GET    /projects/:projectId
POST   /projects/:projectId/members

POST   /projects/:projectId/imports
GET    /projects/:projectId/imports/:importId
POST   /projects/:projectId/imports/:importId/commit

GET    /projects/:projectId/dedup/candidates
POST   /projects/:projectId/dedup/candidates/:candidateId/confirm
POST   /projects/:projectId/dedup/candidates/:candidateId/reject

GET    /projects/:projectId/screening/title-abstract/next
POST   /projects/:projectId/studies/:studyId/decisions

GET    /projects/:projectId/conflicts
POST   /projects/:projectId/conflicts/:conflictId/adjudicate

POST   /projects/:projectId/studies/:studyId/reports
POST   /projects/:projectId/reports/:reportId/pdf
GET    /projects/:projectId/full-text/next
POST   /projects/:projectId/reports/:reportId/decisions

POST   /projects/:projectId/extraction/forms
POST   /projects/:projectId/extraction/assignments
POST   /projects/:projectId/extraction/assignments/:assignmentId/responses
POST   /projects/:projectId/extraction/studies/:studyId/consensus

POST   /projects/:projectId/quality/templates
POST   /projects/:projectId/quality/assessments

GET    /projects/:projectId/exports/prisma
POST   /projects/:projectId/exports
```

For screening, I would also add a batch endpoint:

```text
POST /projects/:projectId/decisions/bulk
```

This is useful for mobile/offline-like behavior and rapid screening.

---

# 15. Frontend pages

```text
/project/:id/dashboard
/project/:id/imports
/project/:id/dedup
/project/:id/screen/title-abstract
/project/:id/conflicts/title-abstract
/project/:id/full-text
/project/:id/conflicts/full-text
/project/:id/extraction/forms
/project/:id/extraction/assigned
/project/:id/extraction/consensus
/project/:id/risk-of-bias
/project/:id/exports
/project/:id/settings
```

The title/abstract screening page should be extremely minimal:

```text
Progress bar
Title
Authors / journal / year
Abstract
Keyword highlights
Include / Maybe / Exclude buttons
Keyboard shortcut hints
My note
Undo
```

The full-text page should be split:

```text
Left: PDF viewer
Right: metadata, decision buttons, exclusion reason dropdown, notes
```

---

# 16. Permissions model

| Role        | Capabilities                                  |
| ----------- | --------------------------------------------- |
| Owner       | Everything, billing, delete project           |
| Admin       | Project settings, imports, dedup, exports     |
| Reviewer    | Assigned screening/extraction/quality tasks   |
| Adjudicator | View conflicts, resolve conflicts             |
| Viewer      | Read-only access after blind mode rules allow |

Blind-mode visibility should be separate from role. For example, a reviewer who is also an adjudicator may need an explicit “enter adjudication mode” permission to see other reviewers’ votes.

---

# 17. Audit and reproducibility

Create an audit log for every important event:

```sql
audit_logs (
  id uuid primary key,
  project_id uuid references projects(id),
  actor_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  before jsonb,
  after jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
```

Log:

```text
imports
parser warnings
dedup auto-merges
manual dedup decisions
votes
vote changes
conflict resolutions
full-text exclusion reasons
form schema changes
extraction responses
consensus decisions
risk-of-bias judgements
exports
project setting changes
blind-mode toggles
```

This is essential for trust.

---

# 18. MVP build order

I would build it in this order:

## MVP 1 — Import, deduplication, and project setup

```text
Project creation
Team invites
RIS parser
BibTeX parser
EndNote XML best-effort parser
Import batch history
Dedup candidate generation
Manual dedup UI
Canonical study creation
```

## MVP 2 — Title/abstract screening

```text
Blind dual screening
Include / exclude / maybe
Keyboard shortcuts
Reviewer assignment
Conflict detection
Conflict dashboard
Adjudication
Basic CSV export
```

## MVP 3 — Full-text screening

```text
PDF upload
PDF viewer
Report retrieval status
Full-text dual voting
Forced exclusion reasons
Full-text conflicts
PRISMA count preview
```

## MVP 4 — PRISMA export

```text
PRISMA count reconciliation
SVG export
PNG export
CSV audit export
Included/excluded citation export
```

## MVP 5 — Data extraction

```text
Form builder
Versioned schemas
Independent extraction
Discrepancy comparison
Consensus dataset
CSV export
```

## MVP 6 — Risk of bias

```text
Custom quality templates
RoB 2-style assessment
ROBINS-I-style assessment
Independent assessment
Consensus view
Export
```

---

# 19. Tests you need from day one

The hardest bugs will be workflow bugs, not UI bugs.

Write tests for:

```text
RIS parsing with repeated authors and multiline abstracts
BibTeX parsing with nested braces and LaTeX escaping
EndNote XML edge cases
DOI normalization
dedup auto-merge thresholds
manual dedup confirmation/rejection
blind-mode API leakage
one vote per reviewer per stage
vote replacement audit trail
include/include transition
exclude/exclude transition
include/exclude conflict
maybe policy behavior
full-text exclusion reason requirement
different full-text exclusion reasons
adjudication override
PRISMA count reconciliation
multiple reports per study
exports with unresolved conflicts blocked
```

Especially test blind mode at the API level. A frontend-only blind mode is not sufficient.

---

# 20. Common design mistakes to avoid

```text
Do not collapse records, reports, and studies into one table.
Do not overwrite reviewer votes without audit history.
Do not allow full-text exclusions without reasons.
Do not expose other reviewer votes through API side channels.
Do not hard-code exclusion reasons globally.
Do not use JSON extraction forms without schema versioning.
Do not run O(n²) deduplication on large imports.
Do not delete duplicate records after merging.
Do not make PRISMA export a manually filled form only.
Do not let projects move forward with unresolved conflicts unless explicitly configured.
```

The core product is not “a citation manager.” It is a **decision provenance system** whose UI happens to make screening fast. If you get the state machine, audit log, and PRISMA counting model right, the rest of the platform becomes much easier to evolve.

[1]: https://www.prisma-statement.org/prisma-2020-flow-diagram "PRISMA 2020 flow diagram — PRISMA statement"
[2]: https://www.sciencedirect.com/science/article/pii/S0895435621000731 "The PRISMA 2020 statement: An updated guideline for reporting systematic reviews - ScienceDirect"
[3]: https://gris.readthedocs.io/en/latest/specification.html?utm_source=chatgpt.com "RIS file format specification — gris 0.9.0 documentation"
[4]: https://support.clarivate.com/Endnote/s/article/EndNote-XML-Document-Type-Definition?language=en_US&utm_source=chatgpt.com "EndNote: XML Document Type Definition - Clarivate"
[5]: https://www.covidence.org/blog/full-text-screening/ "Full Text Screening - Covidence"
[6]: https://help.rayyan.ai/hc/en-us/articles/25316026225041-How-to-Resolve-Screening-Conflicts-in-Rayyan "How to Resolve Screening Conflicts in Rayyan – Rayyan Help Center"
[7]: https://methods.cochrane.org/bias/resources/rob-2-revised-cochrane-risk-bias-tool-randomized-trials?utm_source=chatgpt.com "RoB 2: A revised Cochrane risk-of-bias tool for randomized trials"
[8]: https://methods.cochrane.org/bias/risk-bias-non-randomized-studies-interventions?utm_source=chatgpt.com "ROBINS-I | Cochrane Bias"

