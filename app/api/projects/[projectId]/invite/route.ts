import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { syncUserByIdToPostgres } from "@/lib/postgresUsersSync";
import { inviteUserToProjectForUser } from "@/lib/serverStore";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    const body = await readJsonBody(request);
    const payload = inviteUserToProjectForUser(userId, projectId, {
        name: String(body.name ?? ""),
        email: String(body.email ?? ""),
        title: String(body.title ?? "")
      });
    if (payload.message?.includes("invited") || payload.message?.includes("Temporary password")) {
      const invitedUser = payload.users.find((candidate) => candidate.email.toLowerCase() === String(body.email ?? "").toLowerCase());
      if (invitedUser) {
        await syncUserByIdToPostgres(invitedUser.id);
      }
    }
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
