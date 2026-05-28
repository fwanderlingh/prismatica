import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { adminDeleteUserForUser } from "@/lib/serverStore";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const adminUserId = await requireSessionUserId();
    const { userId } = await context.params;
    return jsonOk(adminDeleteUserForUser(adminUserId, userId));
  } catch (error) {
    return jsonError(error);
  }
}