import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { databaseBackupDirectory } from "./infrastructure";

export type DatabaseBackupJob = {
  id: string;
  status: "running" | "ready" | "failed";
  format: "postgres" | "json";
  fileName: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  sizeBytes?: number;
  error?: string;
};

export class DatabaseBackupError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const retentionMs = 24 * 60 * 60 * 1000;
const staleMs = 30 * 60 * 1000;

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

function writeJson(file: string, value: unknown) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function releaseLock(root: string, id: string) {
  const lock = readJson<{ id: string }>(path.join(root, "running.json"));
  if (lock?.id === id) fs.rmSync(path.join(root, "running.json"), { force: true });
}

function prepareDirectory() {
  const root = databaseBackupDirectory();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(root).isDirectory()) throw new DatabaseBackupError("The backup directory is unavailable.", 503);
  fs.chmodSync(root, 0o700);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !jobIdPattern.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    const job = readJson<DatabaseBackupJob>(path.join(directory, "job.json"));
    if (job && Date.parse(job.expiresAt) <= Date.now()) fs.rmSync(directory, { recursive: true, force: true });
  }
  return root;
}

function readJob(root: string, id: string): DatabaseBackupJob | null {
  if (!jobIdPattern.test(id)) throw new DatabaseBackupError("Backup not found.", 404);
  const file = path.join(root, id, "job.json");
  const job = readJson<DatabaseBackupJob>(file);
  if (!job || Date.parse(job.expiresAt) <= Date.now()) return null;
  if (job.status === "running" && Date.parse(job.createdAt) + staleMs <= Date.now()) {
    job.status = "failed";
    job.error = "Backup creation was interrupted. Create a new backup to try again.";
    writeJson(file, job);
    fs.rmSync(path.join(root, id, "database.part"), { force: true });
    releaseLock(root, id);
  }
  return job;
}

export function getLatestDatabaseBackup(): DatabaseBackupJob | null {
  const root = prepareDirectory();
  const latest = readJson<{ id: string }>(path.join(root, "latest.json"));
  return latest ? readJob(root, latest.id) : null;
}

export function startDatabaseBackup(dataFile: string): DatabaseBackupJob {
  const root = prepareDirectory();
  const lockFile = path.join(root, "running.json");
  const existing = readJson<{ id: string; createdAt: string }>(lockFile);
  if (existing) {
    const job = readJob(root, existing.id);
    if (job?.status === "running") return job;
    if (!job && Date.parse(existing.createdAt) + staleMs > Date.now()) {
      throw new DatabaseBackupError("A backup is starting. Check its status in a moment.", 409);
    }
    releaseLock(root, existing.id);
  }
  const id = crypto.randomUUID();
  const now = new Date();
  const format = process.env.PRISMATICA_STORAGE_MODE?.toLowerCase() === "postgres" ? "postgres" : "json";
  const job: DatabaseBackupJob = {
    id, format, status: "running", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + retentionMs).toISOString(),
    fileName: `prismatica-${now.toISOString().replace(/[:.]/g, "-")}.${format === "postgres" ? "dump" : "json"}`
  };
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ id, createdAt: job.createdAt }), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const current = getLatestDatabaseBackup();
      if (current?.status === "running") return current;
      throw new DatabaseBackupError("A backup is starting. Check its status in a moment.", 409);
    }
    throw error;
  }
  const directory = path.join(root, id);
  const fail = () => {
    const current = readJson<DatabaseBackupJob>(path.join(directory, "job.json"));
    if (current?.status === "running") {
      writeJson(path.join(directory, "job.json"), { ...current, status: "failed", error: "The backup worker could not finish. Try again or contact the server administrator." });
    }
    releaseLock(root, id);
  };
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
    writeJson(path.join(directory, "job.json"), job);
    writeJson(path.join(root, "latest.json"), { id });
    // A separate process can finish after navigation or a Next.js restart.
    const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", "create-database-backup.mjs"), directory], {
      cwd: process.cwd(), detached: true, stdio: "ignore",
      env: { ...process.env, PRISMATICA_BACKUP_SOURCE_FILE: path.resolve(dataFile) }
    });
    child.once("error", fail);
    child.once("exit", (code) => { if (code !== 0) fail(); });
    child.unref();
    return job;
  } catch (error) {
    fail();
    throw error;
  }
}

export function openDatabaseBackup(id: string) {
  const root = prepareDirectory();
  const job = readJob(root, id);
  if (!job) throw new DatabaseBackupError("Backup not found or expired. Create a new backup.", 404);
  if (job.status !== "ready") throw new DatabaseBackupError("This backup is not ready to download.", 409);
  const archive = path.join(root, id, job.format === "postgres" ? "database.dump" : "database.json");
  let fd: number;
  try { fd = fs.openSync(archive, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DatabaseBackupError("The backup file is no longer available. Create a new backup.", 404);
    throw error;
  }
  const stat = fs.fstatSync(fd);
  return { stream: fs.createReadStream(archive, { fd, autoClose: true }), fileName: job.fileName, sizeBytes: stat.size };
}
