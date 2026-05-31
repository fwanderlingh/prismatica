import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { deleteUserByIdFromPostgres } from "@/lib/postgresUsersSync";
import { adminDeleteUserForUser } from "@/lib/serverStore";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const adminUserId = await requireSessionUserId();
    const { userId } = await context.params;
    const payload = adminDeleteUserForUser(adminUserId, userId);
    await deleteUserByIdFromPostgres(userId);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}