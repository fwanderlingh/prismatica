PRISMATICA
==========

## To DO:


1. Add a flow diagram generator: https://github.com/prisma-flowdiagram/PRISMA2020ok




### Optional: Migrate To Prisma ORM

If desired, PostgreSQL access can later move from custom SQL/state-IO helpers to Prisma ORM.

Possible benefits:

- Typed schema and generated client
- Migration history tracking
- Easier per-entity evolution as the data model grows

Suggested staged approach:

1. Add Prisma schema and model `users`, `auth_settings`, then validate parity.
2. Expand to review entities (`projects`, `studies`, `reports`, `decisions`, extraction tables).
3. Replace `app_state_store` blob persistence with normalized Prisma-backed tables.
4. Keep existing API contracts stable during the swap.

This is optional and can be scheduled after the current PostgreSQL + MinIO stabilization.