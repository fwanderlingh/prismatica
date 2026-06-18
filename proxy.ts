import { NextResponse, type NextRequest } from "next/server";

const sessionCookieName = "prismatica_session";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/projects/new" || !pathname.startsWith("/projects/")) {
    return NextResponse.next();
  }

  if (request.cookies.has(sessionCookieName)) {
    return NextResponse.next();
  }

  const signInUrl = request.nextUrl.clone();
  signInUrl.pathname = "/sign-in";
  signInUrl.search = "";
  signInUrl.searchParams.set("redirect", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/projects/:path*"]
};
