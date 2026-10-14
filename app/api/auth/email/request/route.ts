import { requestAccountEmail, ApiError } from "@/lib/serverStore";
import { EmailDeliveryError } from "@/lib/transactionalEmail";
import { syncUserByIdToPostgres } from "@/lib/postgresUsersSync";
import { enforceAuthRateLimit, jsonError, jsonOk, readJsonBody } from "@/lib/serverRoute";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const email = String(body.email ?? "").trim();
    enforceAuthRateLimit(request, "email-request", email);
    if (body.purpose !== "verification" && body.purpose !== "password-reset") throw new ApiError("Invalid email request.");
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("Enter a valid email address.");
    try {
      const userId = await requestAccountEmail(email, body.purpose);
      if (userId) await syncUserByIdToPostgres(userId);
    } catch (error) {
      // Keep the same response for unknown addresses and delivery failures.
      if (!(error instanceof EmailDeliveryError)) throw error;
      console.error("Account email delivery unavailable.");
    }
    return jsonOk({ message: "If this address is eligible, an email will arrive shortly. Check your spam folder, or try again in a minute." });
  } catch (error) {
    return jsonError(error);
  }
}
