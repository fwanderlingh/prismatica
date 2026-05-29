import { updateAuthSettingsForUser } from "@/lib/serverStore";
import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";

export async function PATCH(request: Request) {
  try {
    const adminUserId = await requireSessionUserId();
    const body = await readJsonBody(request);
    return jsonOk(updateAuthSettingsForUser(adminUserId, {
      registrationEnabled: Boolean(body.registrationEnabled)
    }));
  } catch (error) {
    return jsonError(error);
  }
}
