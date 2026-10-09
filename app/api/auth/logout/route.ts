import { clearSessionCookie, getSessionPresenceKey } from "@/lib/serverAuth";
import { clearUserPresence } from "@/lib/userPresence";
import { jsonError, jsonOk } from "@/lib/serverRoute";

export async function POST() {
  try {
    const sessionKey = await getSessionPresenceKey();
    if (sessionKey) {
      // Presence storage must not prevent signing out during a database outage.
      await clearUserPresence(sessionKey).catch(error => console.error("Could not clear user presence", error));
    }
    await clearSessionCookie();
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
