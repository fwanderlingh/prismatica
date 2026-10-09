import { NextResponse } from "next/server";
import { getSessionPresenceKey } from "@/lib/serverAuth";
import { jsonError, requireSessionUserId } from "@/lib/serverRoute";
import { recordUserPresence } from "@/lib/userPresence";

export async function POST() {
  try {
    const userId = await requireSessionUserId();
    const sessionKey = await getSessionPresenceKey();
    if (!sessionKey || !await recordUserPresence(userId, sessionKey)) {
      return NextResponse.json({ error: "Your session is no longer valid." }, { status: 401 });
    }
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
