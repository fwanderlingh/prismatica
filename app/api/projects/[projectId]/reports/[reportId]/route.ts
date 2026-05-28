import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { updateReportForUser } from "@/lib/serverStore";
import type { Report } from "@/lib/prismaData";
import type { DecisionValue } from "@/lib/workflow";

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; reportId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, reportId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(
      updateReportForUser(userId, projectId, reportId, {
        retrievalStatus: body.retrievalStatus as Report["retrievalStatus"],
        decisionValue: body.decisionValue as DecisionValue,
        exclusionReasonId: typeof body.exclusionReasonId === "string" ? body.exclusionReasonId : undefined,
        note: typeof body.note === "string" ? body.note : undefined
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
