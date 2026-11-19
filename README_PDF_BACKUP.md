# PDF storage backup with MinIO

Prismatica's database backup does not include uploaded PDFs. Back up the PDF
bucket separately and keep that copy together with the matching database backup.

Run the commands below on the website server using Bash. The current deployment
uses MinIO at `http://127.0.0.1:9000`, with the bucket `prismatica-pdfs`. Check
**Administration → Infrastructure** for the active configuration.

For a matching database and PDF backup, pause PDF uploads, replacements, and
deletions while creating both copies. Create and download the database backup
from **Administration → Storage Info**.

## 1. Install MinIO Client

The server's existing `mc` command is GNU Midnight Commander. Install MinIO Client
under the separate name `mcli` to keep the commands distinct.

For the current Linux x86-64 server:

```bash
mkdir -p "$HOME/.local/bin"
curl -fL https://dl.min.io/aistor/mc/release/linux-amd64/mc \
  -o "$HOME/.local/bin/mcli" &&
  chmod 700 "$HOME/.local/bin/mcli"

"$HOME/.local/bin/mcli" --version
```

For other operating systems or architectures, use the appropriate download from
the [official client installation guide](https://docs.min.io/aistor/reference/cli/).

## 2. Configure the connection

Load these variables from the website's private server configuration into your
shell. A new SSH session does not automatically inherit the website service's
environment variables.

- `PRISMATICA_S3_ENDPOINT`: the MinIO API endpoint.
- `PRISMATICA_S3_ACCESS_KEY`: the website's MinIO access key.
- `PRISMATICA_S3_SECRET_KEY`: the corresponding secret key.
- `PRISMATICA_S3_BUCKET`: the PDF bucket name.

The credentials must allow listing the bucket and reading its objects. Keep
their values private; the Infrastructure page intentionally omits credentials.

```bash
: "${PRISMATICA_S3_ENDPOINT:?Load the MinIO endpoint first}"
: "${PRISMATICA_S3_ACCESS_KEY:?Load the MinIO access key first}"
: "${PRISMATICA_S3_SECRET_KEY:?Load the MinIO secret key first}"
: "${PRISMATICA_S3_BUCKET:?Load the PDF bucket name first}"

"$HOME/.local/bin/mcli" alias set prismatica \
  "$PRISMATICA_S3_ENDPOINT" \
  "$PRISMATICA_S3_ACCESS_KEY" \
  "$PRISMATICA_S3_SECRET_KEY" --path on
```

The `prismatica` alias stores the connection for subsequent commands. See the
[alias documentation](https://docs.min.io/aistor/reference/cli/mc-alias/mc-alias-set/).

## 3. Copy the PDFs and create an archive

This creates a private, dated backup directory in your home directory, outside
the website source tree. It copies the whole PDF bucket, preserving the
`reports/` paths used by Prismatica, then creates a `.tar` archive.

```bash
umask 077
pdf_backup_dir="$HOME/prismatica-backups/pdfs-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$pdf_backup_dir"

"$HOME/.local/bin/mcli" mirror \
  "prismatica/$PRISMATICA_S3_BUCKET" "$pdf_backup_dir" &&
  tar -cf "${pdf_backup_dir}.tar" -C "$pdf_backup_dir" . &&
  printf 'Backup archive: %s\n' "${pdf_backup_dir}.tar"
```

The archive is created only after the copy succeeds. If the command reports an
error, resolve it and rerun the backup. The source bucket is read without
modifying its objects.

`mirror` copies current object files. Object version history, bucket policies,
and other MinIO configuration require separate backups. See the
[mirror documentation](https://docs.min.io/aistor/reference/cli/mc-mirror/).

## 4. Download the archive

Use SFTP to download the `.tar` file printed by the previous command. Alternatively,
run this on your own computer, replacing the SSH account, server, and timestamp:

```bash
scp YOUR_SSH_USER@YOUR_SERVER:prismatica-backups/pdfs-YYYYMMDD-HHMMSS.tar .
```

Keep the downloaded archive and database backup together on a separate machine
or backup storage. The PDF archive contains the files; the database backup
contains their report associations and storage paths.
