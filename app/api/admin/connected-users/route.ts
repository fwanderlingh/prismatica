import { NextResponse } from "next/server";
import { jsonError, requireSessionUserId } from "@/lib/serverRoute";
import { getConnectedUsersForAdmin } from "@/lib/userPresence";

export async function GET() {
  try {
    const userId = await requireSessionUserId();
    const snapshot = await getConnectedUsersForAdmin(userId);
    if (!snapshot) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
