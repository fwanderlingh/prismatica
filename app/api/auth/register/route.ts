import { setSessionCookie } from "@/lib/serverAuth";
import { syncUserByIdToPostgres } from "@/lib/postgresUsersSync";
import { enforceAuthRateLimit, jsonError, jsonOk, readJsonBody } from "@/lib/serverRoute";
import { registerUser, requestAccountEmail } from "@/lib/serverStore";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const email = String(body.email ?? "");
    enforceAuthRateLimit(request, "register", email);
    const payload = registerUser({
      name: String(body.name ?? ""),
      email,
      organization: String(body.organization ?? ""),
      title: String(body.title ?? ""),
      password: String(body.password ?? ""),
      captchaToken: String(body.captchaToken ?? ""),
      captchaAnswer: String(body.captchaAnswer ?? "")
    });
    if (payload.authSettings.transactionalEmailEnabled) {
      let message = "Account created. Check your email to confirm your address before signing in.";
      try {
        await requestAccountEmail(email, "verification");
      } catch {
        message = "Account created, but the confirmation email could not be sent. Use Resend confirmation to try again.";
      }
      await syncUserByIdToPostgres(payload.currentUser.id);
      return jsonOk({ verificationRequired: true, message });
    }
    await syncUserByIdToPostgres(payload.currentUser.id);
    await setSessionCookie(payload.currentUser.id);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
