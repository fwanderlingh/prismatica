import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { adminResetPasswordForUser } from "@/lib/serverStore";

export async function POST(
  _request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const adminUserId = await requireSessionUserId();
    const { userId } = await context.params;
    return jsonOk(adminResetPasswordForUser(adminUserId, userId));
  } catch (error) {
    return jsonError(error);
  }
}