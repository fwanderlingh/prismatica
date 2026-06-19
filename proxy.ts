import { NextResponse, type NextRequest } from "next/server";

const sessionCookieName = "prismatica_session";
const unsafeMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/") && unsafeMethods.has(request.method.toUpperCase())) {
    const response = enforceSameOriginMutation(request);
    if (response) {
      return response;
    }
  }

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

function enforceSameOriginMutation(request: NextRequest) {
  const sourceOrigin = getSourceOrigin(request);
  if (!sourceOrigin || !getAllowedOrigins(request).has(sourceOrigin)) {
    return NextResponse.json(
      { error: "Cross-site request blocked." },
      {
        status: 403,
        headers: {
          "X-Content-Type-Options": "nosniff"
        }
      }
    );
  }

  return null;
}

function getSourceOrigin(request: NextRequest) {
  const origin = normalizeOrigin(request.headers.get("origin") ?? "");
  if (origin) {
    return origin;
  }

  return normalizeOrigin(request.headers.get("referer") ?? "");
}

function getAllowedOrigins(request: NextRequest) {
  const origins = new Set<string>();
  addOrigin(origins, request.nextUrl.origin);
  addOriginFromParts(origins, request.nextUrl.protocol.replace(/:$/, ""), request.headers.get("host") ?? "");

  const forwardedProto = firstForwardedHeaderValue(request.headers.get("x-forwarded-proto")) || request.nextUrl.protocol.replace(/:$/, "");
  const forwardedHost = firstForwardedHeaderValue(request.headers.get("x-forwarded-host"));
  if (forwardedHost) {
    addOriginFromParts(origins, forwardedProto, forwardedHost);
  }

  for (const configuredOrigin of (process.env.PRISMATICA_ALLOWED_ORIGINS ?? "").split(",")) {
    addOrigin(origins, configuredOrigin);
  }

  return origins;
}

function addOrigin(origins: Set<string>, value: string) {
  const origin = normalizeOrigin(value);
  if (origin) {
    origins.add(origin);
  }
}

function addOriginFromParts(origins: Set<string>, protocol: string, host: string) {
  const normalizedProtocol = protocol.trim().replace(/:$/, "") || "https";
  const normalizedHost = firstForwardedHeaderValue(host);
  if (!normalizedHost) {
    return;
  }

  addOrigin(origins, `${normalizedProtocol}://${normalizedHost}`);
}

function normalizeOrigin(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return "";
  }
}

function firstForwardedHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() ?? "";
}

export const config = {
  matcher: ["/api/:path*", "/projects/:path*"]
};
