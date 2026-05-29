import { getPublicAuthConfig } from "@/lib/serverStore";
import { jsonError, jsonOk } from "@/lib/serverRoute";

export async function GET() {
  try {
    return jsonOk(getPublicAuthConfig());
  } catch (error) {
    return jsonError(error);
  }
}
