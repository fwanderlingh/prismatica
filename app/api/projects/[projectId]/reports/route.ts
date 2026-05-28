import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { getReportsForProjectForUser } from "@/lib/serverStore";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    return jsonOk({ reports: getReportsForProjectForUser(userId, projectId) });
  } catch (error) {
    return jsonError(error);
  }
}
