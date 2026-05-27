import { clearSessionCookie } from "@/lib/serverAuth";
import { jsonError, jsonOk } from "@/lib/serverRoute";

export async function POST() {
  try {
    await clearSessionCookie();
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
