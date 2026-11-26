# Move Prismatica to a new server

Keep the new server at its staging address until the restored website has been
checked. Release the final address on the old server before assigning it to the
new server.

This guide uses documentation addresses **192.0.2.20** (staging) and
**192.0.2.30** (final), the account `user`, database `prismatica` and database role
`app_role`. Replace these examples and `/home/user` paths with your private
configuration values before running any commands. They do not describe a live
deployment.

Start from [server-migration.example.json](server-migration.example.json)
or use your existing private migration configuration. Keep the filled
configuration and credentials out of version control.

The repository layout is:

```text
migration/
  README.md
  prepare-destination.py
  migrate-server.py
  server-migration.example.json
  server-migration.json          # private, ignored by Git
```

Commands with a `migration/` prefix assume the repository root as the working
directory. On a fresh destination, copy this folder outside the future app
directory, for example `/root/prismatica-migration-tools`, and run its scripts
from there. The private configuration may be stored elsewhere under `/root`.

IP address, username and credentials are sufficient to establish SSH access.
The script also checks the local hostname before export/restore to catch running
the command on the wrong PC. This is a local check against an operator mistake;
it does not replace SSH host-key verification or account authentication. SSH
connects to the staging IP without needing DNS resolution for the configured
target hostname.

## What is included

[`migrate-server.py`](migrate-server.py) creates a coordinated,
offline backup and restores it on the new PC. It preserves the same absolute
application and data paths on both machines.

| Item | Migration method |
| --- | --- |
| Website, uncommitted files, `.git`, application `.env*` files | Application archive |
| State JSON, local PDFs, maintenance sidecar and other local data | Separate data directory archive |
| Entire application PostgreSQL database, including users, reviews, settings, visits and presence | Custom-format `pg_dump`; transactional restore; table row-count comparison |
| Complete single-node/single-volume MinIO store, including `.minio.sys` | Archive made **after MinIO stops**, plus its existing server binary |
| Caddy storage, including internal CA private keys and certificates | Offline archive of Caddy's data directory |
| Explicitly listed environment files, service units, overrides, proxy and MinIO configuration | Archive restored into a private review directory |

[`prepare-destination.py`](prepare-destination.py) installs the destination's
system requirements separately. Both scripts default to a plan and require
`--execute` for changes.

`node_modules`, `.next`, TypeScript build cache, and workspace agent directories
`.agents`, `.codex`, `.aws` are excluded. Dependencies and the production build
are recreated on the new PC. Temporary admin-download backups in `/tmp` are not
included; this migration creates a new database backup instead. If the app uses
an external AWS credential profile, include that real credential file explicitly
in `host_config_paths` as well.

The backup contains credentials, private keys, password hashes and private review
data. Keep it outside the web root, in a private directory such as `/root`.
Transfer it over SSH and keep an additional offline copy. Checksums detect
transfer damage; they do not authenticate an untrusted backup.

## Scope and assumptions

This procedure is for Linux with systemd, GNU tar and Python 3.8+, a local
PostgreSQL database, and the **same CPU architecture** on both PCs. PostgreSQL
administration uses local Unix-socket peer authentication as the `postgres` OS
account. If your database uses another authentication scheme, adapt that part
before running it.

For MinIO this is a complete offline clone of **one node with one local data
volume**, using the same server binary and volume path. Preserve the entire
volume, including hidden metadata. Do not combine this migration with a MinIO
upgrade or topology change. Distributed/multiple-volume MinIO, remote storage,
remote key managers, external tiers and network-mounted data require their own
migration procedure. If using encryption, preserve every external decryption
key/configuration too. AIStor licensing may also need updating for the new PC.
MinIO's maintainers caution against copying a running store; an offline clone
requires downtime ([maintainer discussion](https://github.com/minio/minio/discussions/20669)).

This moves Prismatica, rather than cloning the operating system. The preparation
script installs system packages and creates missing named accounts on Ubuntu.
PostgreSQL roles/passwords, custom grants, other databases, firewall rules,
cron jobs, SSH host keys and network settings are not migrated by these scripts.
Recreate the application's database login and any custom grants explicitly.
Symlinks are preserved; include their external targets separately where needed.

Plan downtime from the final backup until the new PC is verified. The source
services remain stopped after export, including on failure. The backup/restore
script does not restart services, install packages, delete data or change IPs.
An export/restore without `--execute` only prints a plan. `verify` reads backup
files and checks hashes.

## 1. Prepare the private configuration

Read the source deployment's effective settings and populate the configuration
privately. Do not paste secret-bearing service output or shell files into public
documentation.

| Configuration | Where to check |
| --- | --- |
| `source_hostname`, `target_hostname` | `hostname` on each server |
| `staging_ip`, `final_ip` | Destination network configuration and cutover plan |
| `app_dir`, `app_user`, `app_group`, `app_units` | App process, systemd unit or process manager |
| `data_dir` | Parent of `PRISMATICA_DATA_FILE`; defaults to `APP_DIR/data` |
| `database` | `DATABASE_URL` and local PostgreSQL configuration; use the actual database name and port |
| `minio` | Object storage settings, MinIO unit and its volume/binary paths |
| `caddy` | Proxy unit, service account and persistent storage directory |
| `host_config_paths` | Every external environment file, service unit, override, shell startup file and required certificate/key configuration |

The migration config's `database.owner` specifies the **destination** owner:
restore strips the original ownership/ACLs and restores as that role. If custom
roles or grants are required, recreate them explicitly.

Confirm the database and PDF provider under **Administration → Infrastructure**.
Record PDF count/bytes from **Administration → Storage Info** for comparison.

If the application runs in tmux, PM2 or another unmanaged session, set `app_units`
to `[]` and **stop the application yourself before export**. The script's
`--writers-stopped` flag acknowledges that step; it does not stop or detect
unmanaged application processes. It controls only the listed system services.

Application secrets may live in a protected environment file or shell startup
files. List those paths in `host_config_paths` without putting their contents in
the migration JSON. Include `.bashrc` and `.profile` if they supply app settings,
plus any MinIO client configuration, service overrides, certificates or external
encryption keys required by the deployment. PostgreSQL configuration can also be
archived for comparison; retain target-specific data paths and version settings
when installing it.

Prepare the migration configuration:

```bash
sudo install -m 600 migration/server-migration.example.json /root/prismatica-migration.json
sudoedit /root/prismatica-migration.json
```

Fill every `REPLACE_` value and check the example defaults. Use distinct source
and target hostnames. Keep the source's absolute application/data paths and named
service accounts on the target. Include only existing paths in `host_config_paths`;
missing configured paths abort export before any service is stopped.

Preview without changing anything:

```bash
sudo python3 migration/migrate-server.py plan --config /root/prismatica-migration.json
```

## 2. Prepare the new server at the staging address

Install Ubuntu and configure its hostname, staging IP and administrative login.
The automated preparation supports Ubuntu 22.04 or newer with systemd on amd64
or arm64. Python 3 must already be available to run the script; on a minimal
installation without it, install `python3` first. The staging IP check also needs
`iproute2`, normally included in Ubuntu.

Copy the migration tools and your filled private configuration to the new
server, outside the future application directory. Preview from the tools folder:

```bash
sudo python3 prepare-destination.py --config /root/prismatica-migration.json
```

Install after reviewing the plan:

```bash
sudo python3 prepare-destination.py \
  --config /root/prismatica-migration.json \
  --execute
```

The installer checks the configured destination hostname and staging IP before
making changes. It refuses active configured app/MinIO/Caddy services and
nonempty destination app/data/storage directories. It installs:

| Requirement | Preparation behavior |
| --- | --- |
| Node.js and npm | Default Node.js major 24, with bundled npm, from the [NodeSource APT repository](https://github.com/nodesource/distributions/blob/master/scripts/deb/setup_24.x) |
| PostgreSQL | Default major 18 server and client tools from the [PostgreSQL PGDG repository](https://www.postgresql.org/download/linux/ubuntu/), when enabled in config |
| Caddy | Stable package from the [official Caddy APT repository](https://caddyserver.com/docs/install#debian-ubuntu-raspbian), when enabled in config |
| Supporting tools | SSH server, Git, rsync, tmux, Python, GNU tar, ACL/xattr tools, curl, GPG, build tools and PostgreSQL development libraries |
| Accounts/storage | Missing named app, MinIO and Caddy accounts; empty storage roots and required parent directories |
| Services | Enables SSH; creates/starts the selected PostgreSQL `main` cluster; leaves Caddy stopped and disabled |

The repositories are scoped to their signing keys. Repository configuration is
written directly; no downloaded setup script is piped into a shell. Existing
service-start policy is temporarily preserved while package starts are blocked,
then restored. Initial Caddy files created during package installation/account
setup are preserved under `/root/prismatica-preparation-state` so the restore
destination stays empty. Existing nonempty Caddy storage is refused before
installation. MinIO's account/storage are prepared, but its **matching binary and
unit come from the source backup**; the preparation script does not download a
different MinIO release.

Choose different package majors when matching or upgrading the source requires
it, for example:

```bash
sudo python3 prepare-destination.py \
  --config /root/prismatica-migration.json \
  --node-major 24 --postgres-major 18 \
  --execute
```

Use the source Node.js major when possible. If a completed backup is already
available, pass `--bundle /root/prismatica-migration-final`: the installer checks
the inventory checksum and architecture, defaults to the source's Node.js major,
and chooses a PostgreSQL major at least as new as both the source server and
`pg_dump` (with 18 as its default minimum). Explicit version flags override these
defaults; an older PostgreSQL major than the inventory requires is refused.
Node.js majors must be even and at least 22, and the selected releases must be
available in the package repositories for the installed Ubuntu version. This
inventory check does not replace the full backup verification before restore.

PostgreSQL logical dumps support migration to newer versions; restoring into
older majors is not guaranteed ([PostgreSQL documentation](https://www.postgresql.org/docs/current/app-pgdump.html)).
The destination's `pg_restore` must also be at least as new as the source
`pg_dump` major. Test application compatibility when selecting newer software.

Preparation does **not** create the app's database role/password or database,
transfer/restore files, install archived secrets or MinIO configuration, run
`npm ci`/the app build, start the website, change firewall/network settings or
assign the final IP. Continue with the remaining steps below. Newly created
login accounts have no password; existing account credentials are preserved.
Recreate SSH access for a new account separately when needed.

Numeric UIDs/GIDs may differ: restore resets ownership of the
app/data/MinIO/Caddy trees to the configured named accounts. Review ownership of
staged configuration files and any ACLs referencing old numeric IDs separately.

Create the configured database role and an **empty** database owned by that role.
Using the documentation example names:

```bash
sudo -u postgres createuser --pwprompt app_role
sudo -u postgres createdb --template=template0 --owner=app_role prismatica
```

Use the database password from the source's private environment when prompted,
or update the target's `DATABASE_URL` and any variable it references to match a
new password. Ensure the restored app can authenticate using the target's
`pg_hba.conf`. The migration script itself uses the local `postgres`
account and does not put database passwords on the command line.

Keep destination app/MinIO/Caddy services stopped. Stop/disable any timers,
scheduled tasks or process-manager startup hooks that could start another writer.
Prepare the same storage mounts and filesystem capacity before restoring. Allow
space for both the transferred archives and extracted data, plus dependencies
and the build. Mounts and `/etc/fstab` are configured manually.

All destination data directories must be absent or empty. If packages were
installed manually, inspect and move aside any initial Caddy or MinIO state
before restoring.
The script refuses to overwrite nonempty directories or an existing database.
Copy the migration script to `/root/migrate-server.py` on the new PC, outside the
future application directory, so that directory can remain empty.

## 3. Freeze writes and export on the old PC

Announce the outage. Maintenance mode can notify users, but **stopping all app
writers is required** for a matching database/PDF snapshot. Stop unmanaged app
processes, workers, timers and cron jobs, including anything that can restart
them. Freeze code/configuration edits. Confirm MinIO is dedicated to this
deployment; stopping it affects every client that uses it.

For a tmux launch, log in as the app account, inspect `tmux list-panes -a`,
attach to the app's session, select its pane and press **Ctrl+C**.
Confirm npm/Next.js has exited before exporting. Recheck the pane rather than
relying on a PID saved in advance. Do not kill the entire tmux server, which may
host unrelated sessions.

The flag `--writers-stopped` acknowledges those manual steps. The script then
stops the configured system services itself, with the app first, followed by
MinIO and Caddy. PostgreSQL stays running so `pg_dump` can export the database.

Choose a new, private backup directory for each attempt:

```bash
sudo python3 migration/migrate-server.py export \
  --config /root/prismatica-migration.json \
  --bundle /root/prismatica-migration-final \
  --execute --writers-stopped
```

Do not restart the source or reboot it during the migration. A failure after
stopping begins leaves services stopped and any partial bundle in place for
inspection. A complete export ends with `Backup complete` and a verified
`manifest.json`. Fix the issue and use a **new** bundle directory if another
export is necessary.

For large stores, this full offline copy determines much of the downtime. A
rehearsal is useful, but any subsequent source writes require a new final export.
Do not cut over using an earlier rehearsal snapshot.

## 4. Transfer the complete bundle to the staging server and restore

After the OS and SSH server are installed on the destination, transfer using its
SSH account and credentials. No password is embedded in the migration files;
SSH and sudo prompt as needed. From the application directory on the old server,
using the documentation account and staging address:

```bash
sudo scp -rp /root/prismatica-migration-final migration/migrate-server.py \
  user@192.0.2.20:/home/user/
```

The backup directory retains its private permissions. Check the new PC's SSH
fingerprint through its console when first connecting. On the new PC, log in as
the destination account, then place the files under `/root`. Use a fresh
destination path for each migration attempt; `mv -T` below refuses to merge into
an existing nonempty backup directory.

```bash
sudo mv -T /home/user/prismatica-migration-final /root/prismatica-migration-final
sudo chown -R root:root /root/prismatica-migration-final
sudo chmod 700 /root/prismatica-migration-final
sudo install -o root -g root -m 700 /home/user/migrate-server.py /root/migrate-server.py
```

This procedure works with password-based SSH and ordinary interactive sudo;
root SSH access and passwordless sudo are not required.

On the new PC, validate the transfer:

```bash
sudo python3 /root/migrate-server.py verify \
  --bundle /root/prismatica-migration-final
```

Restore using the exact reviewed configuration included in the bundle:

```bash
sudo python3 /root/migrate-server.py restore \
  --config /root/prismatica-migration-final/migration-config.json \
  --bundle /root/prismatica-migration-final \
  --config-stage /root/prismatica-restored-config \
  --execute --writers-stopped
```

The script checks the target hostname, presence of the configured staging IP,
architecture, checksums, account existence and empty destinations. It restores
files, remaps ownership, restores PostgreSQL in a transaction and compares all
application table row counts. Host configuration goes under
`/root/prismatica-restored-config` with its original path structure. Services
remain stopped.

## 5. Install configuration and rebuild on the new PC

Privately compare the staged configuration with the destination. Install the
reviewed files at their original paths, preserving restrictive permissions on
secrets. For example, after inspection:

```bash
sudo install -o root -g root -m 600 \
  /root/prismatica-restored-config/etc/default/minio /etc/default/minio
sudo install -o root -g root -m 755 \
  /root/prismatica-restored-config/minio-server /usr/local/bin/minio
```

Install the MinIO unit and `/etc/minio` contents, and review/install the archived
Caddy configuration. Do not blindly copy a whole archived `/etc` tree over the
target. For Caddy's vendor unit, compare the archived copy with the installed
package rather than overwriting it automatically. Compare the PostgreSQL config
and authentication rules, retaining target-specific paths and version settings.
Recreate any extra custom PostgreSQL permissions/extensions and verify any
MinIO license or external key-manager access.

Restore the application's protected environment files at their configured paths.
If app settings come from `.bashrc` and `.profile`, include those files in
`host_config_paths` before export. Back up the new PC's existing shell files,
review the archived copies privately, then install them for the configured
account. For the documentation example:

```bash
sudo install -o user -g user -m 600 \
  /root/prismatica-restored-config/home/user/.bashrc /home/user/.bashrc
sudo install -o user -g user -m 600 \
  /root/prismatica-restored-config/home/user/.profile /home/user/.profile
```

Restore any archived MinIO client configuration if needed for administration,
with the intended account ownership and restrictive permissions. Its credentials
are private. Preserve the existing `PRISMATICA_SESSION_SECRET`, database
credentials and MinIO keys. The MinIO endpoint and database hostname should
remain local (`127.0.0.1` for this procedure); they do not change when the server's
public IP changes.

Review `inventory.json` and `services.txt` against installed software. Validate
the reviewed Caddy configuration and start the dependencies:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl daemon-reload
sudo systemctl start minio.service
sudo systemctl start caddy.service
```

Reinstall dependencies, build and use the source deployment's startup method.
For a manual tmux launch using settings from shell files, enter the application
account's login shell in an **interactive terminal**, which loads the restored
`.profile` and `.bashrc`. Using the documentation account and application path:

```bash
sudo -iu user
cd /home/user/public_html/prismatica
npm ci
npm run build
tmux new-session -s prismatica
```

Inside the new tmux session, start the app:

```bash
cd /home/user/public_html/prismatica
npm run start -- --hostname 0.0.0.0 --port 3000
```

Detach with **Ctrl+B**, then **D**, and leave the session running during
validation. Reattach with `tmux attach-session -t prismatica` as the app account.
Tmux preserves the process after SSH disconnects; it does not restart the app
after reboot. A noninteractive Bash invocation may return from `.bashrc` before
its exports, so do not substitute
`bash -c 'source ~/.bashrc; ...'` and assume the environment loaded. Do not run
npm as root. For a systemd-managed app, install/review its unit and start that
service instead of creating a tmux session. Supply app settings using a protected
`EnvironmentFile`; systemd will not load the interactive `.bashrc` automatically.

Validate using the same access method as the source deployment. For direct HTTP
on port 3000, the documentation staging URL is **http://192.0.2.20:3000**; restrict
testing access to the migration team. If the app uses a reverse proxy, restore
and check its configuration and use its staging URL instead.

HTTPS can be configured separately using the [main README's Caddy deployment](../README.md#recommended-production-tls-caddy-reverse-proxy)
guide. With HTTPS, set secure cookies, the allowed origins and any canonical
email URL consistently. The `allowedDevOrigins` setting in `next.config.mjs`
only affects development and is not needed for this production startup command.

## 6. Verify the staging server before changing the network

Restrict access to the new PC to the migration team while testing. Check:

- Expected database row counts matched during restore; the app uses that restored
  database rather than an empty database or stale JSON bootstrap.
- Existing users can log in and see their projects, decisions, extraction,
  comments, settings and audit history.
- Representative PDFs open, including old uploads and MinIO-backed files. Check
  **Storage Info** object count/bytes against the source's recorded figures.
- A temporary test review and PDF can be created, changed, downloaded and deleted.
- Login/session cookies and allowed-origin checks work with the migrated access
  URL. If using HTTPS with `tls internal`, clients trust the restored Caddy root
  CA. Preserve its key material;
  see [Caddy's data directory documentation](https://caddyserver.com/docs/conventions#data-directory).
- App, PostgreSQL, MinIO and proxy logs have no storage/permission errors. No
  endpoint still sends traffic to the old PC.

Keep normal users off the target until the cutover decision. Source writes must
remain frozen. If a rehearsal requires reopening the source, take a fresh final
backup and restore into newly prepared empty destinations before the real move.

## 7. Move the final address to the new server

Do this through the local console or another reliable management connection.
The script deliberately does not edit Netplan, NetworkManager or interface
configuration: interface name, subnet prefix, gateway and network policy are
machine-specific. Use the actual addresses from your private configuration.

1. Keep all source app/MinIO/proxy services stopped and disable their automatic
   startup. Stop any remaining process-manager hooks. Power off or disconnect
   the old PC, or give it a different management address. **It must release
   the final IP before the new PC claims it.**
2. Change the new PC from its staging IP to its final IP using the correct subnet,
   gateway and DNS settings. Ensure firewall, switch port, DHCP reservation, NAT,
   monitoring and institutional network registration follow the new PC/MAC.
   Do not leave duplicate final addresses. Refresh neighbor/ARP caches if needed.
3. If the public address/domain stays the same, its DNS record generally stays
   the same. Update any records that explicitly reference the staging IP or
   changed IPv6 addresses. Verify any upstream routing/port forwarding.
4. If temporary proxy addresses or allowed origins were introduced for testing,
   update them to the final address and restart/reload the affected app or proxy.
5. Test login, projects and PDF reads/uploads from a different computer using
   the final application URL, for example `http://192.0.2.30:3000`, or the verified
   proxy URL if one is configured.
   Check email links too if transactional email is enabled. The new PC has a
   different SSH host key; verify its fingerprint before updating `known_hosts`.
6. Enable the validated target services for boot, recreate necessary timers and
   scheduled backups, and take a new matching database/PDF backup. Retain the old
   PC and migration bundle until the migration has been accepted.

## Rollback and interrupted attempts

Before real users write to the new PC, rollback is straightforward: stop all
target writers, remove the final IP from the target, restore it to the old PC if
needed, then start the old MinIO service, app and proxy in that order. Re-enable
the original timers/startup hooks as appropriate. Source data was read without
being modified by the backup process.

After users have written to the new database or uploaded PDFs, restarting the old
snapshot loses those changes. Freeze target writes and migrate the new database
and matching files back, or reconcile them, before reopening the old PC. Never
run both copies as writable production servers.

For an interrupted export, keep the partial directory for diagnosis and choose
a new backup path. For an interrupted restore, inspect the target and move its
partial restored directories aside; prepare a fresh empty target database and
empty config staging directory before retrying. The script does not drop a
database, delete data directories or clean up a failed restore. A transactional
restore error rolls back its database transaction, but a later verification
failure can leave a fully restored database requiring inspection.
