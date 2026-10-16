import fs from "node:fs/promises";
import path from "node:path";
import { createObjectStorageFromEnv } from "./objectStorage";
import type { ReviewProject } from "./prismaData";

export type StorageUsage = { bytes: number; files: number; localBytes: number; objectBytes: number };
export type StorageInfo = {
  checkedAt: string;
  provider: "local" | "minio";
  total: StorageUsage;
  reviews: (StorageUsage & { id: string; title: string })[];
  unassigned: StorageUsage;
  disk: { totalBytes: number; usedBytes: number; availableBytes: number } | null;
};

const emptyUsage = (): StorageUsage => ({ bytes: 0, files: 0, localBytes: 0, objectBytes: 0 });

// Use the same directory/key convention as the PDF storage adapters.
function projectDirectory(id: string) {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

async function* localFiles(directory: string, prefix = ""): AsyncGenerator<{ key: string; size: number }> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const location = path.join(directory, entry.name);
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      yield* localFiles(location, `${key}/`);
    } else if (entry.isFile()) {
      try {
        const stat = await fs.lstat(location);
        if (stat.isFile()) yield { key, size: stat.size };
      } catch (error) {
        // A PDF can be removed while the snapshot is being collected.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    // Do not follow links outside the PDF storage tree.
  }
}

async function diskUsage(directory: string): Promise<StorageInfo["disk"]> {
  let current = directory;
  while (true) {
    try {
      const stat = await fs.statfs(current);
      return {
        totalBytes: stat.blocks * stat.bsize,
        usedBytes: (stat.blocks - stat.bfree) * stat.bsize,
        availableBytes: stat.bavail * stat.bsize
      };
    } catch (error) {
      // Before the first upload, inspect the nearest existing parent filesystem.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(current) === current) return null;
      current = path.dirname(current);
    }
  }
}

export async function collectStorageInfo(projects: Pick<ReviewProject, "id" | "title">[], dataFile: string): Promise<StorageInfo> {
  const provider = process.env.PRISMATICA_OBJECT_STORAGE_PROVIDER?.toLowerCase() === "minio" ? "minio" : "local";
  const reviews = projects.map(project => ({ id: project.id, title: project.title, ...emptyUsage() }));
  const byDirectory = new Map<string, (typeof reviews)[number] | null>();
  for (const review of reviews) {
    const directory = projectDirectory(review.id);
    // Ambiguous legacy names must not silently attribute files to the wrong review.
    byDirectory.set(directory, byDirectory.has(directory) ? null : review);
  }
  const total = emptyUsage();
  const unassigned = emptyUsage();
  const add = (key: string, size: number, source: "localBytes" | "objectBytes") => {
    const review = key.includes("/") ? byDirectory.get(key.split("/")[0]) : null;
    for (const usage of [total, review ?? unassigned]) {
      usage.bytes += size;
      usage.files += 1;
      usage[source] += size;
    }
  };
  const directory = path.join(path.dirname(dataFile), "pdfs");
  for await (const file of localFiles(directory)) add(file.key, file.size, "localBytes");
  if (provider === "minio") {
    for await (const object of createObjectStorageFromEnv().listObjects("reports/")) {
      add(object.key.slice("reports/".length), object.size, "objectBytes");
    }
  }
  reviews.sort((a, b) => b.bytes - a.bytes || a.title.localeCompare(b.title));
  return { checkedAt: new Date().toISOString(), provider, total, reviews, unassigned, disk: await diskUsage(directory) };
}
