PRISMATICA
==========

## To DO:

1. The screening  navigation  is a bit chunky, when progressing in the files, the "pdfPane" remains for a couple of secs of the old pdf (even in the  title changes, the inside frame does not) and then  it loads. Even if pdf load can understably take time, the old one should be staying there, and a "loading pdf" should inform the user.

2. Add a flow diagram generator: https://github.com/prisma-flowdiagram/PRISMA2020ok


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
