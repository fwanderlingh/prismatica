PRISMATICA
==========

## To DO:


1. Add a flow diagram generator: https://github.com/prisma-flowdiagram/PRISMA2020ok

2. Storage migration plan (two phases)

Current scope decision:

- Migrate only users and auth preferences from legacy JSON.
- Recreate review/project data from scratch in the new database.
- No additional migration phase is planned.
- Keep `PRISMATICA_USERS_SYNC_POSTGRES=true` only during JSON-primary transition mode.
- For full SQL cutover, set `PRISMATICA_STORAGE_MODE=postgres` so review workflow state persists in PostgreSQL relational tables.
- Optional future track: migrate PostgreSQL access to Prisma ORM after stabilization.

### Optional Prisma ORM Track

Goal: replace custom SQL/state-IO wiring with typed Prisma models and migrations.

Scope suggestion:

- Start with `users` and `auth_settings` models.
- Continue with normalized review workflow models.
- Retire legacy blob fallback once parity is verified.

Acceptance criteria:

- Prisma migrations are the source of truth for schema changes.
- API behavior remains unchanged from current PostgreSQL mode.
- Rollback path documented for schema or data migration issues.

### Phase 1: Relational DB migration (PostgreSQL), keep PDFs on local temp storage

Goal: move all structured state out of JSON into PostgreSQL while keeping current PDF disk behavior.

Deliverables:

- Add database infrastructure
- Add migration and seed workflow
- Add data access abstraction layer
- Move API mutations and reads to PostgreSQL
- Keep report PDF upload/read paths on filesystem
- Add parity tests and cutover checklist

Implementation checklist:

- Define DB provider and ORM/query layer (PostgreSQL).
- Add environment variables:
	- `DATABASE_URL`
	- `PRISMATICA_STORAGE_MODE=hybrid`
	- `PRISMATICA_DATA_FILE` stays only for one-time import fallback
- Create schema for current entities:
	- users
	- auth_settings
	- projects
	- imports
	- studies
	- reports
	- decisions
	- extraction_templates
	- extraction_responses
	- extraction_consensus
	- workflow_events
	- dedup_candidates
- Keep `reports.storage_path` + checksum metadata in DB, but keep file bytes on disk.
- Add one-time migration script: JSON (`data/prismatica-state.json`) -> PostgreSQL.
- Add startup guard:
	- fail fast if `PRISMATICA_STORAGE_MODE=hybrid` and DB is unavailable
	- optional read-only fallback mode for emergency only
- Refactor `lib/serverStore.ts` into repository-backed service functions.
- Verify API parity on key routes:
	- auth/login/logout/register
	- projects/members/imports/studies
	- reports + decisions + extraction
	- validate/export
- Keep PDF storage location under temp/sibling folder for now.
- Add backup procedures for PostgreSQL and temp PDF folder.

Cutover criteria (Phase 1 done):

- All non-PDF state reads/writes are PostgreSQL only.
- No JSON state mutations in normal runtime.
- Existing projects load with unchanged behavior.
- PDF upload/download/validate still works via filesystem.

### Phase 2: Move PDF object storage to MinIO

Goal: replace local PDF filesystem storage with S3-compatible object storage (MinIO).

Deliverables:

- MinIO client integration
- Bucket, key naming, and metadata strategy
- Backfill from local PDFs to MinIO
- Runtime switch and rollback plan

Implementation checklist:

- Add environment variables:
	- `PRISMATICA_OBJECT_STORAGE_PROVIDER=minio`
	- `PRISMATICA_S3_ENDPOINT`
	- `PRISMATICA_S3_REGION`
	- `PRISMATICA_S3_BUCKET`
	- `PRISMATICA_S3_ACCESS_KEY`
	- `PRISMATICA_S3_SECRET_KEY`
	- `PRISMATICA_S3_FORCE_PATH_STYLE=true`
- Add object storage adapter interface:
	- `putPdf(buffer, metadata)`
	- `getPdf(objectKey)`
	- `headPdf(objectKey)`
	- `deletePdf(objectKey)` (optional)
- Store object keys in DB (`reports.storage_path` can become object key, or add `storage_object_key`).
- Preserve checksum verification and validation notes behavior.
- Add migration job: filesystem PDFs -> MinIO bucket.
- Add dual-read during migration window:
	- first try MinIO
	- fallback to local file if not found
- After migration validation, disable local fallback and remove disk dependency.

Cutover criteria (Phase 2 done):

- All PDF reads/writes served from MinIO.
- All historical PDFs are addressable via object keys.
- Local PDF storage fallback disabled.
- Backup/restore drills documented for PostgreSQL + MinIO.

Operational notes:

- Rotate secrets for DB and MinIO through environment management.
- Keep strict access controls for MinIO credentials.
- Monitor failed storage operations and checksum mismatches.


