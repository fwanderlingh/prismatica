// Invoked by the authenticated admin API. Archives and metadata stay outside the web root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const directory = process.argv[2];
const metadata = path.join(directory, 'job.json');
const root = path.dirname(directory);
const job = JSON.parse(fs.readFileSync(metadata, 'utf8'));
const partial = path.join(directory, 'database.part');
process.umask(0o077);

function save() {
  const temporary = `${metadata}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(job), { mode: 0o600 });
  fs.renameSync(temporary, metadata);
}

function run(command, args, env, timeout) {
  const result = spawnSync(command, args, { env, timeout, stdio: 'ignore' });
  if (result.error?.code === 'ENOENT') throw new Error('PostgreSQL backup tools are unavailable. Install pg_dump and pg_restore on the application server.');
  if (result.error?.code === 'ETIMEDOUT') throw new Error('Backup creation timed out. Try again or contact the server administrator.');
  if (result.status !== 0) throw new Error('The database backup could not be created or verified. Check database access and PostgreSQL client versions on the server.');
}

try {
  if (job.format === 'postgres') {
    const connection = process.env.DATABASE_URL;
    if (!connection) throw new Error('The PostgreSQL connection is not configured.');
    const url = new URL(connection);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('The PostgreSQL connection URL is invalid.');
    // libpq does not expand a URI in the PGDATABASE environment variable.
    // Use its individual variables so credentials never appear in process arguments.
    const env = {
      ...process.env, PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '10'
    };
    const parameters = {
      host: 'PGHOST', hostaddr: 'PGHOSTADDR', port: 'PGPORT', dbname: 'PGDATABASE', user: 'PGUSER', password: 'PGPASSWORD',
      sslmode: 'PGSSLMODE', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', sslrootcert: 'PGSSLROOTCERT', sslcrl: 'PGSSLCRL',
      sslcrldir: 'PGSSLCRLDIR', sslsni: 'PGSSLSNI', channel_binding: 'PGCHANNELBINDING',
      target_session_attrs: 'PGTARGETSESSIONATTRS', connect_timeout: 'PGCONNECT_TIMEOUT', application_name: 'PGAPPNAME',
      options: 'PGOPTIONS', client_encoding: 'PGCLIENTENCODING', gssencmode: 'PGGSSENCMODE'
    };
    for (const [key, value] of url.searchParams) {
      if (!parameters[key]) throw new Error('The PostgreSQL connection has an unsupported backup option. Check the server connection settings.');
      env[parameters[key]] = value;
    }
    env.PGOPTIONS = `${env.PGOPTIONS || ''} -c default_transaction_read_only=on`.trim();
    run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', partial], env, 10 * 60 * 1000);
    run('pg_restore', ['--list', partial], env, 60 * 1000);
    // Decode the full archive without connecting to or restoring any database.
    run('pg_restore', ['--file=/dev/null', partial], env, 2 * 60 * 1000);
  } else {
    // State writes use atomic renames, so this read captures a complete JSON snapshot.
    const contents = fs.readFileSync(process.env.PRISMATICA_BACKUP_SOURCE_FILE);
    JSON.parse(contents.toString('utf8'));
    fs.writeFileSync(partial, contents, { mode: 0o600 });
  }
  fs.chmodSync(partial, 0o600);
  fs.renameSync(partial, path.join(directory, job.format === 'postgres' ? 'database.dump' : 'database.json'));
  job.status = 'ready';
  job.completedAt = new Date().toISOString();
  job.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  job.sizeBytes = fs.statSync(path.join(directory, job.format === 'postgres' ? 'database.dump' : 'database.json')).size;
  save();
} catch (error) {
  fs.rmSync(partial, { force: true });
  job.status = 'failed';
  // Only controlled messages reach the API; filesystem and connection errors may contain secrets.
  job.error = error instanceof Error && /^(PostgreSQL backup tools|Backup creation timed out|The database backup|The PostgreSQL connection)/.test(error.message)
    ? error.message : 'The backup could not be saved. Check available disk space and server file permissions.';
  save();
} finally {
  const lock = path.join(root, 'running.json');
  try {
    if (JSON.parse(fs.readFileSync(lock, 'utf8')).id === job.id) fs.rmSync(lock, { force: true });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
