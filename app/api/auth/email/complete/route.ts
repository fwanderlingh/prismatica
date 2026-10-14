import { completeAccountEmail, ApiError } from "@/lib/serverStore";
import { syncUserByIdToPostgres } from "@/lib/postgresUsersSync";
import { enforceAuthRateLimit, jsonError, jsonOk, readJsonBody } from "@/lib/serverRoute";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    // Do not retain bearer tokens in rate-limit identifiers.
    enforceAuthRateLimit(request, "email-confirm", "account-links");
    if (body.purpose !== "verification" && body.purpose !== "password-reset") throw new ApiError("Invalid email request.");
    const userId = completeAccountEmail(body.purpose, String(body.token ?? ""), String(body.password ?? ""));
    await syncUserByIdToPostgres(userId);
    return jsonOk({ message: body.purpose === "verification" ? "Email confirmed. You can now sign in." : "Password updated. Sign in with your new password." });
  } catch (error) {
    return jsonError(error);
  }
}
