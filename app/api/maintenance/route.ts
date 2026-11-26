import { NextResponse, type NextRequest } from "next/server";
import { getSessionUserFromToken } from "@/lib/serverAuth";
import { getMaintenanceSettings } from "@/lib/serverMaintenance";
import { jsonError } from "@/lib/serverRoute";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const settings = await getMaintenanceSettings();
    const canBypass = settings.enabled && Boolean(getSessionUserFromToken(request.cookies.get("prismatica_session")?.value)?.isAdmin);
    return NextResponse.json({ ...settings, canBypass }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
