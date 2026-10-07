import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "prismatica-progress-"));
const previousFileReader = globalThis.FileReader;
try {
  const config = path.join(temp, "tsconfig.json");
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: { target: "ES2020", module: "Node16", moduleResolution: "Node16", rootDir: path.join(root, "lib"), outDir: temp, noEmitOnError: true, skipLibCheck: true, types: [] },
    files: [path.join(root, "lib/loadProgress.ts")]
  }));
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config], { stdio: "inherit" });
  const { readImportProgress, readFileWithProgress } = createRequire(import.meta.url)(path.join(temp, "loadProgress.js"));
  function streamed(text, chunkSize = 7) {
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
        controller.close();
      }
    }), { headers: { "content-type": "application/x-ndjson" } });
  }
  const events = [
    { type: "progress", progress: { label: "Reading café.bib", percent: 50 } },
    { type: "progress", progress: { label: "Saving import" } },
    { type: "complete", payload: { message: "Imported café.bib", records: 12 } }
  ];
  for (const chunkSize of [1, 7, 1000]) {
    const progress = [];
    const payload = await readImportProgress(streamed(events.map(JSON.stringify).join("\n"), chunkSize), step => progress.push(step));
    assert.deepEqual(payload, events[2].payload);
    assert.deepEqual(progress, events.slice(0, 2).map(event => event.progress));
  }
  await assert.rejects(readImportProgress(streamed(JSON.stringify({ type: "error", message: "Import failed" }) + "\n"), () => {}), /Import failed/);
  await assert.rejects(readImportProgress(streamed(JSON.stringify(events[0]) + "\n"), () => {}), /before the import was confirmed/);
  await assert.rejects(readImportProgress(Response.json({ error: "Sign in to continue" }, { status: 401 }), () => {}), /Sign in/);
  assert.deepEqual(await readImportProgress(Response.json({ records: 3 }), () => {}), { records: 3 });
  globalThis.FileReader = class {
    readAsText() {
      this.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
      this.result = "@article{test}";
      this.onload();
    }
  };
  const fileProgress = [];
  assert.equal(await readFileWithProgress({ name: "test.bib" }, step => fileProgress.push(step)), "@article{test}");
  assert.deepEqual(fileProgress.map(step => step.percent), [0, 50, 100]);
  globalThis.FileReader = class { readAsText() { this.onerror(); } };
  await assert.rejects(readFileWithProgress({ name: "bad.bib" }, () => {}), /Could not read/);
  console.log("Progress checks passed: chunked UTF-8, step updates, completion, server errors, interrupted streams, JSON fallback, and file-reading percentages.");
} finally {
  if (previousFileReader === undefined) delete globalThis.FileReader;
  else globalThis.FileReader = previousFileReader;
  fs.rmSync(temp, { recursive: true, force: true });
}
