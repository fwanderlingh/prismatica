import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { syncUserByIdToPostgres } from "@/lib/postgresUsersSync";
import { adminResetPasswordForUser } from "@/lib/serverStore";

export async function POST(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const adminUserId = await requireSessionUserId();
    const { userId } = await context.params;
    const payload = adminResetPasswordForUser(adminUserId, userId);
    await syncUserByIdToPostgres(userId);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}