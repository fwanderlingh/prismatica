import crypto from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

function usage() {
  return [
    "Usage: node scripts/backfill-pdfs-to-minio.mjs [--dry-run] [--force] [--project-id=<id>]",
    "",
    "Copies locally stored report PDFs to the configured MinIO/S3 bucket and updates report storage_path values.",
    "Requires PRISMATICA_S3_ENDPOINT, PRISMATICA_S3_BUCKET, PRISMATICA_S3_ACCESS_KEY, and PRISMATICA_S3_SECRET_KEY."
  ].join("\n");
}

function parseArgs() {
  const options = {
    dryRun: false,
    force: false,
    projectId: ""
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg.startsWith("--project-id=")) {
      options.projectId = arg.slice("--project-id=".length).trim();
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }

  return options;
}

function dataFilePath() {
  if (process.env.PRISMATICA_DATA_FILE) {
    return path.resolve(process.env.PRISMATICA_DATA_FILE);
  }
  return path.join(projectRoot, "data", "prismatica-state.json");
}

function usePostgresStateStore() {
  return (process.env.PRISMATICA_STORAGE_MODE ?? "").toLowerCase() === "postgres";
}

function postgresStateIoScriptPath() {
  return path.join(projectRoot, "scripts", "postgres-state-io.mjs");
}

function readState() {
  if (usePostgresStateStore()) {
    const output = execFileSync(process.execPath, [postgresStateIoScriptPath(), "read"], {
      env: process.env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    }).trim();
    if (!output) {
      throw new Error("PostgreSQL state store returned no state.");
    }
    return JSON.parse(output);
  }

  const filePath = dataFilePath();
  if (!fs.existsSync(filePath)) {
    throw new Error(`State file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeState(state) {
  if (usePostgresStateStore()) {
    execFileSync(process.execPath, [postgresStateIoScriptPath(), "write"], {
      env: process.env,
      input: `${JSON.stringify(state)}\n`,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });
    return;
  }

  const filePath = dataFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readMinioConfig() {
  const endpoint = process.env.PRISMATICA_S3_ENDPOINT?.trim() ?? "";
  const region = process.env.PRISMATICA_S3_REGION?.trim() || "us-east-1";
  const bucket = process.env.PRISMATICA_S3_BUCKET?.trim() ?? "";
  const accessKeyId = process.env.PRISMATICA_S3_ACCESS_KEY?.trim() ?? "";
  const secretAccessKey = process.env.PRISMATICA_S3_SECRET_KEY?.trim() ?? "";
  const forcePathStyle = (process.env.PRISMATICA_S3_FORCE_PATH_STYLE ?? "true").toLowerCase() === "true";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing MinIO configuration. Set PRISMATICA_S3_ENDPOINT, PRISMATICA_S3_BUCKET, PRISMATICA_S3_ACCESS_KEY, and PRISMATICA_S3_SECRET_KEY.");
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle
  };
}

function createS3Client(config) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function reportPdfStorageDirectory(projectId) {
  const safeProjectId = slugify(projectId) || "project";
  return path.join(path.dirname(dataFilePath()), "pdfs", safeProjectId);
}

function reportPdfStoragePath(projectId, reportId, checksum, fileName) {
  const safeReportId = slugify(reportId) || "report";
  const extension = path.extname(fileName).toLowerCase() || ".pdf";
  return path.join(reportPdfStorageDirectory(projectId), `${safeReportId}-${checksum}${extension}`);
}

function reportPdfObjectKey(projectId, reportId, checksum, fileName) {
  const safeProjectId = slugify(projectId) || "project";
  const safeReportId = slugify(reportId) || "report";
  const extension = path.extname(fileName).toLowerCase() || ".pdf";
  return `reports/${safeProjectId}/${safeReportId}-${checksum}${extension}`;
}

function resolveLocalStoragePath(report) {
  const fileName = report.fileName || report.pdfName || "report.pdf";
  const candidates = [
    report.storagePath,
    report.checksum ? reportPdfStoragePath(report.projectId, report.id, report.checksum, fileName) : ""
  ];

  for (const candidate of candidates) {
    if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) {
      return candidate;
    }
    if (candidate && !candidate.startsWith("reports/") && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (!report.checksum) {
    return "";
  }

  const safeReportId = slugify(report.id) || "report";
  const prefix = `${safeReportId}-${report.checksum}.`;
  const directory = reportPdfStorageDirectory(report.projectId);
  if (!fs.existsSync(directory)) {
    return "";
  }

  const matchedFile = fs.readdirSync(directory).find((fileName) => fileName.startsWith(prefix));
  return matchedFile ? path.join(directory, matchedFile) : "";
}

function isObjectNotFoundError(error) {
  const errorName = error?.name ?? error?.Code ?? error?.code ?? "";
  if (errorName === "NoSuchBucket") {
    return false;
  }
  return errorName === "NoSuchKey" || errorName === "NotFound" || error?.$metadata?.httpStatusCode === 404;
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isObjectNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function metadataForReport(report, checksum) {
  return {
    checksum,
    "project-id": report.projectId,
    "report-id": report.id
  };
}

async function putPdf(client, bucket, key, buffer, report, checksum) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "application/pdf",
      Metadata: metadataForReport(report, checksum)
    })
  );
}

async function run() {
  const options = parseArgs();
  const config = readMinioConfig();
  const client = createS3Client(config);
  const state = readState();
  const reports = Array.isArray(state.reports) ? state.reports : [];
  const stats = {
    considered: 0,
    uploaded: 0,
    alreadyPresent: 0,
    updatedState: 0,
    skipped: 0
  };

  for (const report of reports) {
    if (options.projectId && report.projectId !== options.projectId) {
      continue;
    }

    stats.considered += 1;
    const fileName = report.fileName || report.pdfName || "";
    if (!report.id || !report.projectId || !report.checksum || !fileName) {
      stats.skipped += 1;
      console.log(`skip ${report.id || "(missing id)"}: missing report id, project id, checksum, or file name`);
      continue;
    }

    const localPath = resolveLocalStoragePath(report);
    if (!localPath) {
      stats.skipped += 1;
      console.log(`skip ${report.id}: local PDF not found`);
      continue;
    }

    const buffer = fs.readFileSync(localPath);
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    if (checksum !== report.checksum) {
      stats.skipped += 1;
      console.log(`skip ${report.id}: checksum mismatch (${checksum.slice(0, 12)} != ${String(report.checksum).slice(0, 12)})`);
      continue;
    }

    const objectKey = reportPdfObjectKey(report.projectId, report.id, checksum, fileName);
    const exists = !options.force && (await objectExists(client, config.bucket, objectKey));
    if (exists) {
      stats.alreadyPresent += 1;
    } else if (options.dryRun) {
      console.log(`dry-run upload ${report.id}: ${localPath} -> ${objectKey}`);
    } else {
      await putPdf(client, config.bucket, objectKey, buffer, report, checksum);
      stats.uploaded += 1;
      console.log(`uploaded ${report.id}: ${objectKey}`);
    }

    if (!options.dryRun && report.storagePath !== objectKey) {
      report.storagePath = objectKey;
      stats.updatedState += 1;
    }
  }

  if (!options.dryRun && stats.updatedState > 0) {
    writeState(state);
  }

  console.log(
    [
      "",
      "Backfill complete.",
      `considered: ${stats.considered}`,
      `uploaded: ${stats.uploaded}`,
      `already present: ${stats.alreadyPresent}`,
      `state updates: ${stats.updatedState}`,
      `skipped: ${stats.skipped}`
    ].join("\n")
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
