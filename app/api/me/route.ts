import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { updateCurrentUserForUser } from "@/lib/serverStore";

export async function PATCH(request: Request) {
  try {
    const userId = await requireSessionUserId();
    const body = await readJsonBody(request);
    return jsonOk(
      updateCurrentUserForUser(userId, {
        organization: String(body.organization ?? ""),
        title: String(body.title ?? ""),
        currentPassword: String(body.currentPassword ?? ""),
        newPassword: String(body.newPassword ?? "")
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
