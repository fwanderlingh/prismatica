import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export function databaseBackupDirectory() {
  const instance = crypto.createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `prismatica-backups-${instance}`);
}

function publicEndpoint(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "Not configured";
  }
}

export function getInfrastructureInfo(dataFile: string) {
  const postgres = process.env.PRISMATICA_STORAGE_MODE?.toLowerCase() === "postgres";
  const minio = process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER?.toLowerCase() === "minio";
  let databaseUrl: URL | undefined;
  try { databaseUrl = new URL(process.env.DATABASE_URL ?? ""); } catch { /* Report missing configuration below. */ }
  return {
    database: {
      provider: postgres ? "postgres" as const : "json" as const,
      configured: !postgres || Boolean(databaseUrl && ["postgres:", "postgresql:"].includes(databaseUrl.protocol)),
      host: postgres ? databaseUrl?.hostname ?? "Not configured" : null,
      port: postgres ? databaseUrl?.port || "5432" : null,
      name: postgres ? decodeURIComponent(databaseUrl?.pathname.slice(1) ?? "") : null,
      file: postgres ? null : path.resolve(dataFile)
    },
    pdfStorage: {
      provider: minio ? "minio" as const : "local" as const,
      configured: !minio || Boolean(process.env.PRISMATICA_S3_ENDPOINT && process.env.PRISMATICA_S3_BUCKET &&
        process.env.PRISMATICA_S3_ACCESS_KEY && process.env.PRISMATICA_S3_SECRET_KEY),
      endpoint: minio ? publicEndpoint(process.env.PRISMATICA_S3_ENDPOINT) : null,
      bucket: minio ? process.env.PRISMATICA_S3_BUCKET || "Not configured" : null,
      region: minio ? process.env.PRISMATICA_S3_REGION || "us-east-1" : null,
      pathStyle: minio && process.env.PRISMATICA_S3_FORCE_PATH_STYLE?.toLowerCase() !== "false",
      localFallback: minio && process.env.PRISMATICA_PDF_LOCAL_FALLBACK?.toLowerCase() !== "false",
      localDirectory: path.join(path.dirname(path.resolve(dataFile)), "pdfs")
    },
    backups: { directory: databaseBackupDirectory(), retentionHours: 24 }
  };
}

export type InfrastructureInfo = ReturnType<typeof getInfrastructureInfo>;
