import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { updateScreeningCheckoutForUser } from "@/lib/serverStore";

export async function POST(request: Request) {
  try {
    const userId = await requireSessionUserId();
    const body = await readJsonBody(request);
    return jsonOk(
      updateScreeningCheckoutForUser(userId, {
        projectId: String(body.projectId ?? ""),
        studyId: String(body.studyId ?? ""),
        reportId: String(body.reportId ?? ""),
        templateId: String(body.templateId ?? ""),
        checkoutId: String(body.checkoutId ?? ""),
        stage: typeof body.stage === "string" ? body.stage : undefined,
        action: typeof body.action === "string" ? body.action : undefined
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
