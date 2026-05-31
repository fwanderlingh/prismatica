<p align="center">
  <img src="./app/icon.svg" alt="Prismatica logo" style="max-width:150px">
</p>

# PRISMATICA

An open source review platform,following the PRISMA (Preferred Reporting Items for Systematic reviews and Meta-Analyses) protocol, built with Next.js, React, and TypeScript.

Full information about the PRISMA guidelines can be found at [https://www.prisma-statement.org/](https://www.prisma-statement.org/).

![Dashboard](images/dashboard_1.png "Dashboard")

## Why Prismatica

Prismatica is designed for teams running evidence reviews that need both speed and auditability:

- Structured PRISMA workflow from import to export
- Multi-user collaboration with role-aware controls
- Server-side state and signed HTTP-only sessions
- Full-text PDF handling with validation and provenance
- Configurable review thresholds and conflict handling
- Audit trail and project-level traceability

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Run locally (HTTP)

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`.

### 3) Run locally (HTTPS)

```bash
npm run dev:https -- --hostname 127.0.0.1 --port 3000
```

This uses Next.js experimental local HTTPS support.

## Features

- Dashboard with PRISMA counts, audit trail, and progress indicators
- Sign-in, optional captcha-protected registration, and server-managed sessions
- Admin controls for password reset, account deletion, and registration policy
- Multi-project workspace with per-project navigation
- Team membership management with owner safeguards
- RIS and BibTeX import with provenance and review flow
- Dedup candidate review with side-by-side comparisons
- Title/abstract screening with append-only decisions and undo route support
- Full-text review with PDF upload, validation, streaming, and DOI linking
- Conflict handling in full-text and extraction phases
- Extraction templates (text, single-choice, multi-choice)
- Extraction submissions, consensus routes, and configurable extraction voting
- Export and report validation endpoints
- Theme preferences (light, dark, system)
- Path-based routing and refined UI components


## Workflow Overview

1. Create an account, sign in, and create a review project.
2. Import records from RIS or BibTeX with batch provenance.
3. Review deduplication candidates (when present).
4. Screen title/abstract decisions (include/maybe/exclude).
5. Advance studies to full-text, upload/validate PDFs, and review outcomes.
6. Resolve conflicts and advance eligible studies to extraction.
7. Define extraction templates and collect reviewer submissions.
8. Build extraction consensus and validate/export reporting output.

## Architecture Snapshot

- Frontend: Next.js App Router + React UI
- Backend: Next API routes under `app/api`
- State: Server-side JSON store with atomic writes
- Auth: Signed HTTP-only cookies and session checks in server routes
- Files: Uploaded PDFs stored on disk alongside the configured data store

Core modules:

- `lib/serverStore.ts`: persistence, business logic, and workflow mutations
- `lib/serverAuth.ts`: session and cookie handling
- `lib/serverRoute.ts`: route helpers (auth, JSON, file responses)
- `lib/workflow.ts`: stage and decision-state progression logic
- `components/prisma-review-app.tsx`: main application shell and view orchestration
- `components/prisma-review-ui.tsx`: reusable UI presentation components

## System Requirements

- Node.js 20.9 or newer
- npm

Ubuntu/Debian install example:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify:

```bash
node --version
npm --version
```

## Scripts

```bash
npm run dev          # Next.js development server
npm run dev:https    # Dev server with experimental HTTPS
npm run build        # Production build
npm run start        # Production server (defaults)
npm run start:prod   # Production server bound to 127.0.0.1:3000
npm run check        # TypeScript type-check
```

## Accounts and Access

No demo reviewer accounts are pre-created.

- Register the first reviewer from the sign-in page.
- Create projects and invite members from project settings.

A separate administrator account is seeded on startup by default:

- Email: `admin@prismatica.local`
- Password: `change-me-admin`

For non-local environments, set `PRISMATICA_ADMIN_PASSWORD` explicitly.

## Server Storage and Sessions

For production, set a stable session secret and move data outside the repo:

Default behavior when `PRISMATICA_DATA_FILE` is not set:

- State file: `./data/prismatica-state.json` (relative to the project root)
- PDF folder: `./data/pdfs/`

Production example:

```bash
export PRISMATICA_SESSION_SECRET="replace-with-a-long-random-string"
export PRISMATICA_DATA_FILE="/var/lib/prismatica/prismatica-state.json"
npm run build
npm run start -- --hostname 0.0.0.0 --port 3000
```

Optional environment variables:

```bash
export PRISMATICA_INVITE_PASSWORD="temporary-password-for-invited-users"
export PRISMATICA_ADMIN_EMAIL="admin@example.com"
export PRISMATICA_ADMIN_PASSWORD="replace-this-default-admin-password"
export PRISMATICA_REGISTRATION_ENABLED="false"
export PRISMATICA_CAPTCHA_SECRET="replace-with-a-long-random-string"
export PRISMATICA_SECURE_COOKIES="true"
```

### Session Secret Management

- `PRISMATICA_SESSION_SECRET` signs session cookies; keep it private and high-entropy.
- Use a long random value (at least 32 bytes of entropy).
- Store it in environment variables or a secrets manager, not in git.
- Use a different secret per environment (development, staging, production).
- Rotating the secret invalidates all active sessions and requires users to sign in again.

Generate a strong secret:

```bash
openssl rand -base64 48
```

or

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Notes:

- Use `PRISMATICA_SECURE_COOKIES=true` only when serving over HTTPS.
- `PRISMATICA_REGISTRATION_ENABLED=false` disables public registration for new data files.
- Uploaded PDFs are stored under a sibling `pdfs/` folder near `PRISMATICA_DATA_FILE`.

## Network Access Patterns

### Local subnet development

```bash
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Then open `http://<server-lan-ip>:3000`.

If the LAN IP changes, add it in `next.config.mjs` under `allowedDevOrigins` and restart the dev server.

### Public HTTP access (not recommended for production)

```bash
npm run build
npm run start -- --hostname 0.0.0.0 --port 3000
```

Then open `http://<server-hostname-or-ip>:3000`.

## Recommended Production TLS: Caddy Reverse Proxy

Prismatica is intended to run behind Caddy with Next.js bound to localhost (`127.0.0.1:3000`).

Deployment assets:

- `deploy/caddy/Caddyfile`: IP mode with `tls internal`
- `deploy/caddy/Caddyfile.letsencrypt`: domain mode with public certificates
- `deploy/caddy/prismatica.service`: systemd service for the Next.js app

### Mode A: IP-only HTTPS (Caddy Internal CA)

Use this when no domain is available.

1. Edit `deploy/caddy/Caddyfile` and replace `203.0.113.10` with your server IP.
2. Activate config:

```bash
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

3. Install and start app service:

```bash
sudo cp deploy/caddy/prismatica.service /etc/systemd/system/prismatica.service
sudo systemctl daemon-reload
sudo systemctl enable --now prismatica
```

4. Trust Caddy local root certificate on each client:

```bash
# On server
sudo cp /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt /tmp/caddy-local-root.crt
```

Debian/Ubuntu client trust:

```bash
sudo cp caddy-local-root.crt /usr/local/share/ca-certificates/caddy-local-root.crt
sudo update-ca-certificates
```

Fedora/RHEL client trust:

```bash
sudo cp caddy-local-root.crt /etc/pki/ca-trust/source/anchors/caddy-local-root.crt
sudo update-ca-trust
```

### Mode B: Domain HTTPS (Let's Encrypt)

Use this for browser-trusted public certificates.

1. Point DNS A/AAAA records to your server.
2. Edit `deploy/caddy/Caddyfile.letsencrypt` and set your domain.
3. Activate config:

```bash
sudo cp deploy/caddy/Caddyfile.letsencrypt /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will automatically request and renew certificates.

### Switching TLS modes

```bash
# IP-only mode (internal CA)
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile

# Domain mode (Let's Encrypt)
sudo cp deploy/caddy/Caddyfile.letsencrypt /etc/caddy/Caddyfile

sudo systemctl reload caddy
```

## Production Hardening Checklist

- Set a strong `PRISMATICA_SESSION_SECRET`
- Set a strong `PRISMATICA_ADMIN_PASSWORD`
- Enable `PRISMATICA_SECURE_COOKIES=true` when using HTTPS
- Keep Next.js behind localhost and reverse proxy through Caddy
- Restrict filesystem permissions on data and PDF storage
- Open only required firewall ports (`443`; optionally `80` for ACME HTTP challenge)
- Keep Caddy internal CA materials restricted to trusted admins (if using internal CA mode)

## Validation and Quality

Run type checks:

```bash
npm run check
```

Create production build:

```bash
npm run build
```

Start production server directly (without reverse proxy):

```bash
npm run start -- --hostname 0.0.0.0 --port 3000
```

For production deployments, prefer the Caddy reverse-proxy pattern above.
