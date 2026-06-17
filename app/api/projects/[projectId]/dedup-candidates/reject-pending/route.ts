import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { rejectPendingDedupCandidatesForUser } from "@/lib/serverStore";

export async function POST(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    return jsonOk(rejectPendingDedupCandidatesForUser(userId, projectId));
  } catch (error) {
    return jsonError(error);
  }
}
