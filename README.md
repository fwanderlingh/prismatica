# Prismatica

Open source PRISMA review platform built with Next.js, React, and TypeScript from `prisma_website_specifications.md`.

![Dashboard](images/dashboard_1.png "Dashboard")

## What Is Included

- Project dashboard with PRISMA counts and audit trail
- Sign-in and registration screens with persisted browser sessions
- Multi-review dashboard showing each user's accessible review projects
- Project-specific sidebar navigation after opening a review
- Profile page with account details, project membership, and user switching
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

Registered users, newly created reviews, and the active session are stored in browser `localStorage`, so they survive refreshes in the same browser.

## System Dependencies

Prismatica requires Node.js 20.9 or newer, npm, and Python 3 for the optional static preview command.

On Ubuntu/Debian, install the required system dependencies with:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg python3

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify the installation:

```bash
node --version
npm --version
python3 --version
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

## Subnetwork Development Access

For access from another machine on the same subnet, bind the dev server to all interfaces:

```bash
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Then open `http://130.251.6.42:3000` from another machine. If the LAN IP changes, add the new IP to `allowedDevOrigins` in `next.config.mjs` and restart the dev server.

## Network-Enabled Public Access

For access from outside the local subnet, run the app bound to all interfaces:

```bash
npm run dev -- --hostname 0.0.0.0 --port 3000
```

Then open `http://130.251.6.30:3000`.

If public clients cannot connect:

- Ensure inbound TCP `3000` is allowed by the host firewall and any upstream network firewall.
- Ensure `130.251.6.30` is included in `allowedDevOrigins` in `next.config.mjs`.
- Restart the dev server after changing `allowedDevOrigins`.

## Type Check

```bash
npm run check
```

## Production Build

```bash
npm run build
```

The static site is exported to `out/`.

## Preview Static Build

```bash
npm run preview
```

Open `http://127.0.0.1:4173`.

## Verification Run

These commands have been run successfully:

```bash
npm audit --audit-level=moderate
npm run check
npm run build
```
