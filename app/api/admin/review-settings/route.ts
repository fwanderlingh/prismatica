import { updateReviewSettingsForUser } from "@/lib/serverStore";
import { syncReviewSettingsToPostgres } from "@/lib/postgresUsersSync";
import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";

export async function PATCH(request: Request) {
  try {
    const adminUserId = await requireSessionUserId();
    const body = await readJsonBody(request);
    const settings = {
      ...(Object.prototype.hasOwnProperty.call(body, "auditHistoryLimit")
        ? { auditHistoryLimit: Number(body.auditHistoryLimit) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "screeningCheckoutWindowMinutes")
        ? { screeningCheckoutWindowMinutes: Number(body.screeningCheckoutWindowMinutes) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "extractionCheckoutWindowMinutes")
        ? { extractionCheckoutWindowMinutes: Number(body.extractionCheckoutWindowMinutes) }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "pdfUploadMaxSizeMb")
        ? { pdfUploadMaxSizeMb: Number(body.pdfUploadMaxSizeMb) }
        : {})
    };
    const payload = updateReviewSettingsForUser(adminUserId, settings);
    await syncReviewSettingsToPostgres();
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
