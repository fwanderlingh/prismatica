import { jsonError, jsonOk, pdfFileResponse, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { ApiError, getReportPdfForUser, updateReportForUser } from "@/lib/serverStore";
import type { DecisionValue } from "@/lib/workflow";

export async function GET(request: Request, context: { params: Promise<{ projectId: string; reportId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, reportId } = await context.params;
    const url = new URL(request.url);
    if (url.searchParams.get("pdf") !== "1") {
      throw new ApiError("Add ?pdf=1 to stream this report PDF.");
    }
    const pdf = await getReportPdfForUser(userId, projectId, reportId);
    return pdfFileResponse(pdf);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string; reportId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, reportId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(
      updateReportForUser(userId, projectId, reportId, {
        decisionValue: body.decisionValue as DecisionValue,
        exclusionReasonId: typeof body.exclusionReasonId === "string" ? body.exclusionReasonId : undefined,
        note: typeof body.note === "string" ? body.note : undefined
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
