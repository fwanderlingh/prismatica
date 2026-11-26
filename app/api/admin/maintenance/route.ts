import { NextResponse } from "next/server";
import { jsonError, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { getMaintenanceSettingsForAdmin, updateMaintenanceSettingsForAdmin } from "@/lib/serverMaintenance";

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getMaintenanceSettingsForAdmin(await requireSessionUserId());
    return NextResponse.json(settings, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireSessionUserId();
    const settings = await updateMaintenanceSettingsForAdmin(userId, await readJsonBody(request));
    return NextResponse.json(settings, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
