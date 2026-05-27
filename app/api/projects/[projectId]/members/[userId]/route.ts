import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { removeProjectMemberForUser } from "@/lib/serverStore";

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string; userId: string }> }) {
  try {
    const sessionUserId = await requireSessionUserId();
    const { projectId, userId } = await context.params;
    return jsonOk(removeProjectMemberForUser(sessionUserId, projectId, userId));
  } catch (error) {
    return jsonError(error);
  }
}
