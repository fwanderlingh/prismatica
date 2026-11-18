import { NextResponse } from "next/server";
import { jsonError, requireSessionUserId } from "@/lib/serverRoute";
import { createDatabaseBackupForAdmin, getDatabaseBackupForAdmin } from "@/lib/serverStore";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireSessionUserId();
    return NextResponse.json({ backup: getDatabaseBackupForAdmin(userId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST() {
  try {
    const userId = await requireSessionUserId();
    return NextResponse.json({ backup: createDatabaseBackupForAdmin(userId) }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
