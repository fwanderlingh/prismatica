import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { saveExtractionConsensusForUser } from "@/lib/serverStore";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(saveExtractionConsensusForUser(userId, projectId, body));
  } catch (error) {
    return jsonError(error);
  }
}
