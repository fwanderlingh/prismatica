import { getEmailStatusForAdmin, updateAuthSettingsForUser } from "@/lib/serverStore";
import { syncAuthSettingsToPostgres } from "@/lib/postgresUsersSync";
import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";

export async function PATCH(request: Request) {
  try {
    const adminUserId = await requireSessionUserId();
    const body = await readJsonBody(request);
    const settings = {
      ...(typeof body.registrationEnabled === "boolean" ? { registrationEnabled: body.registrationEnabled } : {}),
      ...(typeof body.transactionalEmailEnabled === "boolean" ? { transactionalEmailEnabled: body.transactionalEmailEnabled } : {})
    };
    const payload = updateAuthSettingsForUser(adminUserId, settings);
    await syncAuthSettingsToPostgres();
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET() {
  try {
    return jsonOk(getEmailStatusForAdmin(await requireSessionUserId()));
  } catch (error) {
    return jsonError(error);
  }
}
