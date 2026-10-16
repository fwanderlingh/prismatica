import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { deleteUserByIdFromPostgres, syncUserByIdToPostgres } from "@/lib/postgresUsersSync";
import { adminDeleteUserForUser, adminSetUserRoleForUser } from "@/lib/serverStore";

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const adminUserId = await requireSessionUserId();
    const { userId } = await context.params;
    const body = await readJsonBody(request);
    const payload = adminSetUserRoleForUser(adminUserId, userId, body?.isAdmin);
    await syncUserByIdToPostgres(userId);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}

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
