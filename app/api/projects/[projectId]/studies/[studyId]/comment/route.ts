import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { updateStudyCommentForUser } from "@/lib/serverStore";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; studyId: string }> }
) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, studyId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(updateStudyCommentForUser(userId, projectId, studyId, { comment: body?.comment as string }));
  } catch (error) {
    return jsonError(error);
  }
}
