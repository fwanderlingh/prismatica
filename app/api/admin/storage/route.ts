import { NextResponse } from "next/server";
import { jsonError, requireSessionUserId } from "@/lib/serverRoute";
import { getStorageInfoForAdmin } from "@/lib/serverStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireSessionUserId();
    const snapshot = await getStorageInfoForAdmin(userId);
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
