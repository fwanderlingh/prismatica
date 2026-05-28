import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { updateProjectForUser } from "@/lib/serverStore";

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(updateProjectForUser(userId, projectId, body));
  } catch (error) {
    return jsonError(error);
  }
}
