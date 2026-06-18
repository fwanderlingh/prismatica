import { setSessionCookie } from "@/lib/serverAuth";
import { enforceAuthRateLimit, jsonError, jsonOk, readJsonBody } from "@/lib/serverRoute";
import { loginUser } from "@/lib/serverStore";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const email = String(body.email ?? "");
    enforceAuthRateLimit(request, "login", email);
    const payload = loginUser(email, String(body.password ?? ""));
    await setSessionCookie(payload.currentUser.id);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
