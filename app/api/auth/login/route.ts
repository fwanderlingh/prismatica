import { setSessionCookie } from "@/lib/serverAuth";
import { enforceAuthRateLimit, jsonError, jsonOk, readJsonBody } from "@/lib/serverRoute";
import { loginUser } from "@/lib/serverStore";
import { getMaintenanceSettings } from "@/lib/serverMaintenance";
import { maintenanceRetryAfter } from "@/lib/maintenance";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const email = String(body.email ?? "");
    enforceAuthRateLimit(request, "login", email);
    const payload = loginUser(email, String(body.password ?? ""));
    const maintenance = await getMaintenanceSettings();
    if (maintenance.enabled && !payload.currentUser.isAdmin) {
      return NextResponse.json(
        { error: "The site is under maintenance. Only administrators can sign in until maintenance is stopped.", maintenance: true, endsAt: maintenance.endsAt },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": maintenanceRetryAfter(maintenance.endsAt) } }
      );
    }
    await setSessionCookie(payload.currentUser.id);
    return jsonOk(payload);
  } catch (error) {
    return jsonError(error);
  }
}
