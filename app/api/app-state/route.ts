import { getAppStateForUser } from "@/lib/serverStore";
import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";

export async function GET() {
  try {
    const userId = await requireSessionUserId();
    return jsonOk(getAppStateForUser(userId));
  } catch (error) {
    return jsonError(error);
  }
}
