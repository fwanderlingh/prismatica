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

export type ReportPdfWriteMetadata = {
  checksum?: string;
  fileName?: string;
  projectId?: string;
  reportId?: string;
};

export type PdfStorageAdapter = {
  provider: PdfStorageProvider;
  buildStoragePath(input: ReportPdfLocationInput): string;
  writePdf(storagePath: string, buffer: Buffer, metadata?: ReportPdfWriteMetadata): Promise<void>;
  readPdf(input: ReportPdfReadInput): Promise<ReportPdfReadResult | null>;
  deletePdf(input: ReportPdfReadInput): Promise<void>;
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

function reportPdfObjectKey(projectId: string, reportId: string, checksum: string, fileName: string) {
  const safeProjectId = slugify(projectId) || "project";
  const safeReportId = slugify(reportId) || "report";
  const extension = path.extname(fileName).toLowerCase() || ".pdf";
  return `reports/${safeProjectId}/${safeReportId}-${checksum}${extension}`;
}

function minioLocalFallbackEnabled() {
  const value = process.env.PRISMATICA_PDF_LOCAL_FALLBACK ?? process.env.PRISMATICA_MINIO_LOCAL_FALLBACK ?? "true";
  return value.toLowerCase() !== "false";
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
    },
    async deletePdf(input) {
      const storagePath = resolveLocalStoragePath(options.dataFilePath, input.report, input.projectId, input.reportId);
      if (!storagePath) return;
      const directory = fs.realpathSync(reportPdfStorageDirectory(options.dataFilePath, input.projectId));
      const relativePath = path.relative(directory, fs.realpathSync(storagePath));
      if (relativePath.startsWith(`..${path.sep}`) || relativePath === ".." || path.isAbsolute(relativePath)) {
        throw new Error("PDF storage path is outside the project directory.");
      }
      fs.unlinkSync(/*turbopackIgnore: true*/ storagePath);
    }
  };
}

function createMinioPdfStorage(options: PdfStorageOptions): PdfStorageAdapter {
  const objectStorage = createObjectStorageFromEnv();
  const localStorage = createLocalPdfStorage(options);
  const localFallback = minioLocalFallbackEnabled() ? localStorage : null;

  return {
    provider: "minio",
    buildStoragePath(input) {
      return reportPdfObjectKey(input.projectId, input.reportId, input.checksum, input.fileName);
    },
    async writePdf(storagePath, buffer, metadata) {
      await objectStorage.putObject({
        key: storagePath,
        body: buffer,
        contentType: "application/pdf",
        checksum: metadata?.checksum,
        metadata: {
          "project-id": metadata?.projectId,
          "report-id": metadata?.reportId
        }
      });
    },
    async deletePdf(input) {
      const prefix = `reports/${slugify(input.projectId) || "project"}/${slugify(input.reportId) || "report"}-`;
      const keys = new Set<string>();
      if (input.report.storagePath && !path.isAbsolute(input.report.storagePath)) {
        if (!input.report.storagePath.startsWith(prefix)) {
          throw new Error("PDF object key does not belong to this report.");
        }
        keys.add(input.report.storagePath);
      }
      if (input.report.checksum) {
        keys.add(this.buildStoragePath({
          projectId: input.projectId,
          reportId: input.reportId,
          checksum: input.report.checksum,
          fileName: input.report.fileName || input.report.pdfName || "report.pdf"
        }));
      }
      for (const key of keys) await objectStorage.deleteObject(key);
      // Remove migration copies as well so enabling fallback cannot restore a deleted PDF.
      await localStorage.deletePdf(input);
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

      if (localFallback) {
        const localPdf = await localFallback.readPdf(input);
        if (localPdf) {
          return {
            buffer: localPdf.buffer,
            storagePath: input.report.storagePath || localPdf.storagePath
          };
        }
      }

      return null;
    }
  };
}

export function createPdfStorageAdapter(options: PdfStorageOptions): PdfStorageAdapter {
  const provider = process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER?.toLowerCase();
  if (provider === "minio") {
    return createMinioPdfStorage(options);
  }
  return createLocalPdfStorage(options);
}
