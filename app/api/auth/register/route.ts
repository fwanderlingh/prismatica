import { setSessionCookie } from "@/lib/serverAuth";
import { syncUserByIdToPostgres } from "@/lib/postgresUsersSync";
import { jsonError, jsonOk, readJsonBody } from "@/lib/serverRoute";
import { registerUser } from "@/lib/serverStore";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const payload = registerUser({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      organization: String(body.organization ?? ""),
      title: String(body.title ?? ""),
      password: String(body.password ?? ""),
      captchaToken: String(body.captchaToken ?? ""),
      captchaAnswer: String(body.captchaAnswer ?? "")
    });
    await syncUserByIdToPostgres(payload.currentUser.id);
    await setSessionCookie(payload.currentUser.id);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
