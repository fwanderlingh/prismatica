import { getPublicAuthConfig } from "@/lib/serverStore";
import { jsonError, jsonOk } from "@/lib/serverRoute";
import { getMaintenanceSettings } from "@/lib/serverMaintenance";

export async function GET() {
  try {
    const config = getPublicAuthConfig();
    config.maintenanceEnabled = (await getMaintenanceSettings()).enabled;
    if (config.maintenanceEnabled) config.authSettings.registrationEnabled = false;
    const response = jsonOk(config);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
