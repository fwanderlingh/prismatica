import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { deleteImportBatchForUser, updateImportBatchForUser } from "@/lib/serverStore";

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; importId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, importId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(
      updateImportBatchForUser(userId, projectId, importId, {
        sourceName: String(body.sourceName ?? ""),
        filename: String(body.filename ?? "")
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string; importId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, importId } = await context.params;
    return jsonOk(deleteImportBatchForUser(userId, projectId, importId));
  } catch (error) {
    return jsonError(error);
  }
}
