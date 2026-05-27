import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { undoScreeningDecisionForUser } from "@/lib/serverStore";

export async function POST(request: Request) {
  try {
    const userId = await requireSessionUserId();
    const body = await readJsonBody(request);
    return jsonOk(
      undoScreeningDecisionForUser(userId, {
        projectId: String(body.projectId ?? ""),
        studyId: String(body.studyId ?? ""),
        previousDecisionId: typeof body.previousDecisionId === "string" ? body.previousDecisionId : undefined
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
