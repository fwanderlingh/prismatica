import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { inviteUserToProjectForUser } from "@/lib/serverStore";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(
      inviteUserToProjectForUser(userId, projectId, {
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
        title: String(body.title ?? "")
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
