import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { createImportBatchForUser } from "@/lib/serverStore";
import type { ImportBatch } from "@/lib/prismaData";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(
      await createImportBatchForUser(userId, projectId, {
        format: body.format as ImportBatch["format"],
        filename: String(body.filename ?? ""),
        byteSize: typeof body.byteSize === "number" ? body.byteSize : undefined,
        content: String(body.content ?? "")
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
