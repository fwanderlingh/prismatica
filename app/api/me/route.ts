import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { updateCurrentUserForUser } from "@/lib/serverStore";

export async function PATCH(request: Request) {
  try {
    const userId = await requireSessionUserId();
    const body = await readJsonBody(request);
    const organization = typeof body.organization === "string" ? body.organization : undefined;
    const title = typeof body.title === "string" ? body.title : undefined;
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : undefined;
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : undefined;
    const websiteTheme = typeof body.websiteTheme === "string" ? body.websiteTheme : undefined;
    return jsonOk(
      updateCurrentUserForUser(userId, {
        organization,
        title,
        currentPassword,
        newPassword,
        websiteTheme
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
