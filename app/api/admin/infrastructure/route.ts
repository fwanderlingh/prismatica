import { NextResponse } from "next/server";
import { jsonError, requireSessionUserId } from "@/lib/serverRoute";
import { getInfrastructureInfoForAdmin } from "@/lib/serverStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireSessionUserId();
    return NextResponse.json(getInfrastructureInfoForAdmin(userId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
