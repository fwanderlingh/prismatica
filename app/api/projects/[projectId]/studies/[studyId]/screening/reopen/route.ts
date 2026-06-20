import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { reopenTitleAbstractDecisionForUser } from "@/lib/serverStore";

export async function POST(_request: Request, context: { params: Promise<{ projectId: string; studyId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, studyId } = await context.params;
    return jsonOk(reopenTitleAbstractDecisionForUser(userId, projectId, studyId));
  } catch (error) {
    return jsonError(error);
  }
}
