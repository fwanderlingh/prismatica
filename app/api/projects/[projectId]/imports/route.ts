import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { createImportBatchForUser } from "@/lib/serverStore";
import type { ImportProgressEvent } from "@/lib/loadProgress";
import type { AppMutationPayload } from "@/lib/apiTypes";
import type { ImportBatch } from "@/lib/prismaData";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    const body = await readJsonBody(request);
    const input = {
      format: body.format as ImportBatch["format"],
      filename: String(body.filename ?? ""),
      byteSize: typeof body.byteSize === "number" ? body.byteSize : undefined,
      content: String(body.content ?? "")
    };
    if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
      return jsonOk(await createImportBatchForUser(userId, projectId, input));
    }
    let disconnected = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: ImportProgressEvent<AppMutationPayload>) => {
          if (!disconnected) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          const payload = await createImportBatchForUser(userId, projectId, input, async (progress) => {
            send({ type: "progress", progress });
            // Flush the stage message before synchronous parsing or duplicate detection.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          });
          send({ type: "complete", payload });
        } catch (error) {
          const failure = await jsonError(error).json();
          send({ type: "error", message: failure.error });
        } finally {
          if (!disconnected) controller.close();
        }
      },
      cancel() { disconnected = true; }
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" }
    });
  } catch (error) {
    return jsonError(error);
  }
}
