export type LoadProgress = {
  label: string;
  detail?: string;
  percent?: number;
};

export type ImportProgressEvent<T> =
  | { type: "progress"; progress: LoadProgress }
  | { type: "complete"; payload: T }
  | { type: "error"; message: string };

export function readFileWithProgress(file: File, onProgress: (progress: LoadProgress) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const report = (percent?: number) => onProgress({ label: `Reading ${file.name}`, detail: "Reading the citation file from your device.", percent });
    report(0);
    reader.onprogress = (event) => report(event.lengthComputable && event.total > 0 ? Math.round(event.loaded / event.total * 100) : undefined);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error("File reading was cancelled."));
    reader.onload = () => { report(100); resolve(String(reader.result ?? "")); };
    reader.readAsText(file);
  });
}

export async function readImportProgress<T>(response: Response, onProgress: (progress: LoadProgress) => void): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "The import request failed.");
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    return await response.json() as T;
  }
  if (!response.body) throw new Error("The import response was empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  function parse(line: string): { payload: T } | undefined {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ImportProgressEvent<T>;
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "progress") onProgress(event.progress);
    if (event.type === "complete") return { payload: event.payload };
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const result = parse(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
        if (result) return result.payload;
      }
      if (done) {
        const result = parse(buffer);
        if (result) return result.payload;
        throw new Error("The connection ended before the import was confirmed. Check Import Batches before trying again.");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
