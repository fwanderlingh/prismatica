import { NextResponse } from "next/server";
import { recordWebsiteVisit } from "@/lib/websiteVisits";

const visitCookieName = "prismatica_visit_session";
const visitCookieMaxAgeSeconds = 30 * 60;

export async function POST(request: Request) {
  try {
    const requestCookies = request.headers.get("cookie") ?? "";
    const alreadyCounted = requestCookies.split(";").some((cookie) => cookie.trim().startsWith(`${visitCookieName}=`));
    if (alreadyCounted) {
      return new NextResponse(null, { status: 204 });
    }

    await recordWebsiteVisit();
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(visitCookieName, "1", {
      httpOnly: true,
      maxAge: visitCookieMaxAgeSeconds,
      path: "/",
      sameSite: "lax",
      secure: process.env.PRISMATICA_SECURE_COOKIES === "true"
    });
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Website visit could not be recorded." }, { status: 503 });
  }
}