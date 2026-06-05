import { updateAuthSettingsForUser } from "@/lib/serverStore";
import { syncAuthSettingsToPostgres } from "@/lib/postgresUsersSync";
import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";

export async function PATCH(request: Request) {
  try {
    const adminUserId = await requireSessionUserId();
    const body = await readJsonBody(request);
    const settings = {
      registrationEnabled: Boolean(body.registrationEnabled)
    };
    const payload = updateAuthSettingsForUser(adminUserId, settings);
    await syncAuthSettingsToPostgres();
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
