# Prismatica

Open source PRISMA review platform built with Next.js, React, and TypeScript from `prisma_website_specifications.md`.

![Dashboard](images/dashboard_1.png "Dashboard")

## What Is Included

- Project dashboard with PRISMA counts and audit trail
- Sign-in and registration screens with HTTP-only server sessions
- Multi-review dashboard showing each user's accessible review projects
- Project-specific sidebar navigation after opening a review
- Profile page with account details, project membership, and team directory
- New review project form with team membership, EU-format due date (`dd-mm-yyyy`), and screening policy controls
- Project settings team management for adding existing users, inviting new users, and removing non-owner members
- Empty/waiting states for newly created reviews before imports, deduplication, screening, and full-text work begin
- Import batch/provenance view for RIS, BibTeX, EndNote XML, and CSV sources
- Deduplication candidate review with side-by-side metadata and scoring
- High-velocity title/abstract screening with append-only decision state
- Full-text review workspace with PDF viewer mock, retrieval status, and exclusion reasons
- Extraction consensus and risk-of-bias workspaces
- PRISMA export preview with validation checks
- Role, blind-mode, and state-machine settings views

Registered users, newly created reviews, team membership, screening decisions, duplicate-candidate statuses, and workflow events are stored server-side. By default the Node server writes a JSON data file at `data/prismatica-state.json`; set `PRISMATICA_DATA_FILE` to place it somewhere durable.

This is the Node storage adapter for the current Next.js app. The API routes keep project, user, decision, and audit mutations behind server boundaries so a PostgreSQL/NestJS adapter from `prisma_website_specifications.md` can replace the JSON file later.

## System Dependencies

Prismatica requires Node.js 20.9 or newer and npm.

On Ubuntu/Debian, install the required system dependencies with:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify the installation:

```bash
node --version
npm --version
```

## Install

```bash
npm install
```

## Development Server

```bash
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`.

No demo accounts are pre-created. Register the first account from the sign-in screen, then create review projects and invite team members from project settings.

## Server Storage And Sessions

For production, set a stable session secret and keep the data file outside the repo:

```bash
export PRISMATICA_SESSION_SECRET="replace-with-a-long-random-string"
export PRISMATICA_DATA_FILE="/var/lib/prismatica/prismatica-state.json"
npm run build
npm run start -- --hostname 0.0.0.0 --port 3000
```

Optional environment variables:

```bash
export PRISMATICA_INVITE_PASSWORD="temporary-password-for-invited-users"
export PRISMATICA_SECURE_COOKIES="true"
```

Use `PRISMATICA_SECURE_COOKIES=true` only when the app is served over HTTPS.

## Subnetwork Development Access

For access from another machine on the same subnet, bind the dev server to all interfaces:

```bash
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Then open `http://130.251.6.42:3000` from another machine. If the LAN IP changes, add the new IP to `allowedDevOrigins` in `next.config.mjs` and restart the dev server.

## Network-Enabled Public Access

For access from outside the local subnet, build the app and run the production server bound to all interfaces:

```bash
npm run build
npm run start -- --hostname 0.0.0.0 --port 3000
```

Then open `http://130.251.6.30:3000`.

If public clients cannot connect:

- Ensure inbound TCP `3000` is allowed by the host firewall and any upstream network firewall.
- Ensure the server process is still running and listening on `0.0.0.0:3000`.

## Type Check

```bash
npm run check
```

## Production Build

```bash
npm run build
```

Run the production server with `npm run start -- --hostname 0.0.0.0 --port 3000`.

## Verification Run

These commands have been run successfully:

```bash
npm audit --audit-level=moderate
npm run check
npm run build
```
