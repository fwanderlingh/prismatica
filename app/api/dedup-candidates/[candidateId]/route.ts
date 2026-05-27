import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { updateDedupCandidateForUser } from "@/lib/serverStore";
import type { DedupCandidate } from "@/lib/prismaData";

export async function PATCH(request: Request, context: { params: Promise<{ candidateId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { candidateId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(updateDedupCandidateForUser(userId, candidateId, body.status as DedupCandidate["status"]));
  } catch (error) {
    return jsonError(error);
  }
}
