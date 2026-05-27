import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { updateProjectMembersForUser } from "@/lib/serverStore";

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    const body = await readJsonBody(request);
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds.map(String) : [];
    const eventLabel = String(body.eventLabel ?? "Updated project team");
    return jsonOk(updateProjectMembersForUser(userId, projectId, memberIds, eventLabel));
  } catch (error) {
    return jsonError(error);
  }
}
