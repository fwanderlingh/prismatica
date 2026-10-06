import { NextResponse } from "next/server";
import { getWebsiteVisitCountForAdmin } from "@/lib/websiteVisits";
import { jsonError, requireSessionUserId } from "@/lib/serverRoute";

export async function GET() {
  try {
    const userId = await requireSessionUserId();
    const visits = await getWebsiteVisitCountForAdmin(userId);
    if (visits === null) {
      return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
    }
    return NextResponse.json({ visits });
  } catch (error) {
    return jsonError(error);
  }
}