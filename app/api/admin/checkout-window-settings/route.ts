import { updateCheckoutWindowSettingsForUser } from "@/lib/serverStore";
import { syncCheckoutWindowSettingsToPostgres } from "@/lib/postgresUsersSync";
import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";

export async function PATCH(request: Request) {
  try {
    const adminUserId = await requireSessionUserId();
    const body = await readJsonBody(request);
    const settings = {
      ...(Object.prototype.hasOwnProperty.call(body, "screeningCheckoutWindowMinutes")
        ? { screeningCheckoutWindowMinutes: Number(body.screeningCheckoutWindowMinutes) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "extractionCheckoutWindowMinutes")
        ? { extractionCheckoutWindowMinutes: Number(body.extractionCheckoutWindowMinutes) }
        : {})
    };
    const payload = updateCheckoutWindowSettingsForUser(adminUserId, settings);
    await syncCheckoutWindowSettingsToPostgres();
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
