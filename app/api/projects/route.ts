import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { createProjectForUser } from "@/lib/serverStore";

export async function POST(request: Request) {
  try {
    const userId = await requireSessionUserId();
    const body = await readJsonBody(request);
    return jsonOk(createProjectForUser(userId, body));
  } catch (error) {
    return jsonError(error);
  }
}
