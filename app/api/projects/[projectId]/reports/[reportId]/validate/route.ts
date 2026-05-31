import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { validateReportPdfForUser } from "@/lib/serverStore";

export async function POST(_request: Request, context: { params: Promise<{ projectId: string; reportId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, reportId } = await context.params;
    return jsonOk(await validateReportPdfForUser(userId, projectId, reportId));
  } catch (error) {
    return jsonError(error);
  }
}
