import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { syncUserByIdToPostgres } from "@/lib/postgresUsersSync";
import { adminCreateUserForUser } from "@/lib/serverStore";

export async function POST(request: Request) {
  try {
    const adminUserId = await requireSessionUserId();
    const body = await readJsonBody(request);
    const payload = adminCreateUserForUser(adminUserId, body);
    if (payload.createdUserId) {
      await syncUserByIdToPostgres(payload.createdUserId);
    }
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
