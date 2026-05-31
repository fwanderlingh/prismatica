import { updateAuthSettingsForUser } from "@/lib/serverStore";
import { syncAuthSettingsToPostgres } from "@/lib/postgresUsersSync";
import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";

export async function PATCH(request: Request) {
  try {
    const adminUserId = await requireSessionUserId();
    const body = await readJsonBody(request);
    const payload = updateAuthSettingsForUser(adminUserId, {
      registrationEnabled: Boolean(body.registrationEnabled)
    });
    await syncAuthSettingsToPostgres();
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
