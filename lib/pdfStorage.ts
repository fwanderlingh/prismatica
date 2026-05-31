import fs from "fs";
import path from "path";
import { createObjectStorageFromEnv } from "./objectStorage";
import type { Report } from "./prismaData";

export type PdfStorageProvider = "local" | "minio";

export type ReportPdfLocationInput = {
  projectId: string;
  reportId: string;
  checksum: string;
  fileName: string;
};

export type ReportPdfReadInput = {
  report: Report;
  projectId: string;
  reportId: string;
};

export type ReportPdfReadResult = {
  buffer: Buffer;
  storagePath: string;
};

export type PdfStorageAdapter = {
  provider: PdfStorageProvider;
  buildStoragePath(input: ReportPdfLocationInput): string;
  writePdf(storagePath: string, buffer: Buffer): Promise<void>;
  readPdf(input: ReportPdfReadInput): Promise<ReportPdfReadResult | null>;
};

type PdfStorageOptions = {
  dataFilePath: () => string;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function reportPdfStorageDirectory(dataFileResolver: () => string, projectId: string) {
  const safeProjectId = slugify(projectId) || "project";
  return path.join(path.dirname(dataFileResolver()), "pdfs", safeProjectId);
}

function reportPdfStoragePath(dataFileResolver: () => string, projectId: string, reportId: string, checksum: string, fileName: string) {
  const safeReportId = slugify(reportId) || "report";
  const extension = path.extname(fileName).toLowerCase() || ".pdf";
  return path.join(reportPdfStorageDirectory(dataFileResolver, projectId), `${safeReportId}-${checksum}${extension}`);
}

function resolveLocalStoragePath(dataFileResolver: () => string, report: Report, projectId: string, reportId: string) {
  const candidates = [
    report.storagePath,
    report.checksum
      ? reportPdfStoragePath(dataFileResolver, projectId, reportId, report.checksum, report.fileName || report.pdfName || "report.pdf")
      : ""
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
        return candidate;
      }
    }
  }

  if (!report.checksum) {
    return "";
  }

  const safeReportId = slugify(reportId) || "report";
  const prefix = `${safeReportId}-${report.checksum}.`;
  const directory = reportPdfStorageDirectory(dataFileResolver, projectId);
  if (!fs.existsSync(/*turbopackIgnore: true*/ directory)) {
    return "";
  }

  const matchedFile = fs.readdirSync(/*turbopackIgnore: true*/ directory).find((fileName) => fileName.startsWith(prefix));
  return matchedFile ? path.join(directory, matchedFile) : "";
}

function createLocalPdfStorage(options: PdfStorageOptions): PdfStorageAdapter {
  return {
    provider: "local",
    buildStoragePath(input) {
      return reportPdfStoragePath(options.dataFilePath, input.projectId, input.reportId, input.checksum, input.fileName);
    },
    async writePdf(storagePath, buffer) {
      fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(/*turbopackIgnore: true*/ storagePath, buffer);
    },
    async readPdf(input) {
      const storagePath = resolveLocalStoragePath(options.dataFilePath, input.report, input.projectId, input.reportId);
      if (!storagePath) {
        return null;
      }

      return {
        buffer: fs.readFileSync(/*turbopackIgnore: true*/ storagePath),
        storagePath
      };
    }
  };
}

function createMinioPdfStorage(): PdfStorageAdapter {
  const objectStorage = createObjectStorageFromEnv();
  return {
    provider: "minio",
    buildStoragePath(input) {
      const safeProjectId = slugify(input.projectId) || "project";
      const safeReportId = slugify(input.reportId) || "report";
      const extension = path.extname(input.fileName).toLowerCase() || ".pdf";
      return `reports/${safeProjectId}/${safeReportId}-${input.checksum}${extension}`;
    },
    async writePdf(storagePath, buffer) {
      await objectStorage.putObject({
        key: storagePath,
        body: buffer,
        contentType: "application/pdf"
      });
    },
    async readPdf(input) {
      const candidates = [
        input.report.storagePath,
        input.report.checksum
          ? this.buildStoragePath({
              projectId: input.projectId,
              reportId: input.reportId,
              checksum: input.report.checksum,
              fileName: input.report.fileName || input.report.pdfName || "report.pdf"
            })
          : ""
      ].filter(Boolean) as string[];

      for (const key of candidates) {
        const exists = await objectStorage.hasObject(key);
        if (!exists) {
          continue;
        }
        const bytes = await objectStorage.getObject(key);
        if (!bytes) {
          continue;
        }
        return {
          buffer: Buffer.from(bytes),
          storagePath: key
        };
      }

      return null;
    }
  };
}

export function createPdfStorageAdapter(options: PdfStorageOptions): PdfStorageAdapter {
  const provider = process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER?.toLowerCase();
  if (provider === "minio") {
    return createMinioPdfStorage();
  }
  return createLocalPdfStorage(options);
}