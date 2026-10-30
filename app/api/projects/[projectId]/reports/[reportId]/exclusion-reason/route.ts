import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { correctFullTextExclusionReasonForUser } from "@/lib/serverStore";

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; reportId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, reportId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(correctFullTextExclusionReasonForUser(
      userId, projectId, reportId,
      typeof body.exclusionReasonId === "string" ? body.exclusionReasonId : ""
    ));
  } catch (error) {
    return jsonError(error);
  }
}
