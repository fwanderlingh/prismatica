import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { markImportBatchReviewedForUser } from "@/lib/serverStore";

export async function POST(_request: Request, context: { params: Promise<{ projectId: string; importId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, importId } = await context.params;
    return jsonOk(markImportBatchReviewedForUser(userId, projectId, importId));
  } catch (error) {
    return jsonError(error);
  }
}
