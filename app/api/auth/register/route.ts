import { setSessionCookie } from "@/lib/serverAuth";
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
      password: String(body.password ?? "")
    });
    await setSessionCookie(payload.currentUser.id);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
