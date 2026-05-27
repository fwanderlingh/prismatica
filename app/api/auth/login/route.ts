import { setSessionCookie } from "@/lib/serverAuth";
import { jsonError, jsonOk, readJsonBody } from "@/lib/serverRoute";
import { loginUser } from "@/lib/serverStore";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const payload = loginUser(String(body.email ?? ""), String(body.password ?? ""));
    await setSessionCookie(payload.currentUser.id);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
