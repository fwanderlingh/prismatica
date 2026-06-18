PRISMATICA
==========

## To DO:


1. Add a flow diagram generator: https://github.com/prisma-flowdiagram/PRISMA2020

## Security

API data is mostly protected from unauthenticated requests, but I would not call the website production-secure against attacks yet.

**What Looks Good**
Most sensitive API routes call `requireSessionUserId()` before returning app data or mutating state, and project/admin actions also go through member, owner, or admin checks. For example, [serverRoute.ts](/home/graal/public_html/prismatica/lib/serverRoute.ts:5) rejects missing sessions, and routes like project creation use it before touching data.

**Main Risks**
1. **Known fallback session secret**
   [serverAuth.ts](/home/graal/public_html/prismatica/lib/serverAuth.ts:12) falls back to a hardcoded signing secret. If `PRISMATICA_SESSION_SECRET` is missing in production, sessions can potentially be forged.

2. **Default admin password**
   [serverStore.ts](/home/graal/public_html/prismatica/lib/serverStore.ts:4162) defaults admin credentials to `admin@prismatica.local` / `change-me-admin` unless env vars are set.

3. **Unauthenticated project pages return shell HTML**
   [serverStore.ts](/home/graal/public_html/prismatica/lib/serverStore.ts:1099) returns `true` when no user is logged in. APIs still protect data, but `/projects/:id` can reveal that a project route exists before the client redirects.

4. **No visible CSRF/origin guard**
   Cookie auth is used, but mutations do not appear to validate `Origin`/`Referer` or use CSRF tokens. `SameSite=Lax` helps, but I would still harden this.

5. **No login/register rate limiting**
   [loginUser](/home/graal/public_html/prismatica/lib/serverStore.ts:1210) and registration have no throttling. That leaves password guessing and signup abuse too open.

6. **SSRF risk from imported PDF URLs**
   Imported citations can trigger server-side PDF fetches. [normalizeRemoteUrl](/home/graal/public_html/prismatica/lib/serverStore.ts:4765) only checks `http/https`, not private IPs, localhost, metadata IPs, or DNS rebinding.


**Verdict**
For casual unauthenticated API access: **mostly protected**.

For production security against real attacks: **not yet**. I’d prioritize: require strong env secrets at startup, block unauthenticated workspace/project SSR routes, add rate limiting, add CSRF/origin checks and restrict remote PDF fetching.

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