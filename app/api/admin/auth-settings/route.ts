import { updateAuthSettingsForUser } from "@/lib/serverStore";
import { syncAuthSettingsToPostgres } from "@/lib/postgresUsersSync";
import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";

export async function PATCH(request: Request) {
  try {
    const adminUserId = await requireSessionUserId();
    const body = await readJsonBody(request);
    const settings = {
      registrationEnabled: Boolean(body.registrationEnabled),
      ...(Object.prototype.hasOwnProperty.call(body, "screeningCheckoutWindowMinutes")
        ? { screeningCheckoutWindowMinutes: Number(body.screeningCheckoutWindowMinutes) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "extractionCheckoutWindowMinutes")
        ? { extractionCheckoutWindowMinutes: Number(body.extractionCheckoutWindowMinutes) }
        : {})
    };
    const payload = updateAuthSettingsForUser(adminUserId, settings);
    await syncAuthSettingsToPostgres();
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
