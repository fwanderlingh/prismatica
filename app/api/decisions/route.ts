import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { addScreeningDecisionForUser } from "@/lib/serverStore";
import type { DecisionValue } from "@/lib/workflow";

export async function POST(request: Request) {
  try {
    const userId = await requireSessionUserId();
    const body = await readJsonBody(request);
    return jsonOk(
      addScreeningDecisionForUser(userId, {
        projectId: String(body.projectId ?? ""),
        studyId: String(body.studyId ?? ""),
        decisionValue: body.decisionValue as DecisionValue,
        note: String(body.note ?? "")
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
