PRISMATICA
==========

## To DO:

1. Add a flow diagram generator: https://github.com/prisma-flowdiagram/PRISMA2020

2. Something strange happens on page reload: a completely different review is presented

## Security

All sensitive API routes call `requireSessionUserId()` before returning app data or mutating state, and project/admin actions also go through member, owner, or admin checks. For example, [serverRoute.ts](/home/graal/public_html/prismatica/lib/serverRoute.ts:5) rejects missing sessions, and routes like project creation use it before touching data.

**Main Risks**

1. **SSRF risk from imported PDF URLs**
   Imported citations can trigger server-side PDF fetches. [normalizeRemoteUrl](/home/graal/public_html/prismatica/lib/serverStore.ts:4765) only checks `http/https`, not private IPs, localhost, metadata IPs, or DNS rebinding.


**Verdict**
For casual unauthenticated API access: **mostly protected**.

## Optional

### Migrate To Prisma ORM

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
