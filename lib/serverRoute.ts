import { NextResponse } from "next/server";
import { getSessionUserId } from "./serverAuth";
import { ApiError } from "./serverStore";

const authRateLimitMaxAttempts = 10;
const authRateLimitWindowMs = 60 * 1000;
const authRateLimitBuckets = getAuthRateLimitBuckets();

type AuthRateLimitAction = "login" | "register";
type AuthRateLimitBucket = {
  count: number;
  resetAt: number;
};

function getAuthRateLimitBuckets() {
  const globalStore = globalThis as typeof globalThis & {
    __prismaticaAuthRateLimitBuckets?: Map<string, AuthRateLimitBucket>;
  };

  globalStore.__prismaticaAuthRateLimitBuckets ??= new Map<string, AuthRateLimitBucket>();
  return globalStore.__prismaticaAuthRateLimitBuckets;
}

export async function requireSessionUserId() {
  const userId = await getSessionUserId();
  if (!userId) {
    throw new ApiError("Sign in to continue.", 401);
  }
  return userId;
}

export async function readJsonBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError("Request body must be valid JSON.");
  }
}

export function enforceAuthRateLimit(request: Request, action: AuthRateLimitAction, identifier: string) {
  const now = Date.now();
  pruneExpiredAuthRateLimitBuckets(now);

  const normalizedIdentifier = normalizeAuthRateLimitPart(identifier) || "missing";
  const clientIp = getClientIp(request);
  const keys = [
    `auth:${action}:ip:${clientIp}`,
    `auth:${action}:identifier:${normalizedIdentifier}`
  ];

  for (const key of keys) {
    const bucket = getAuthRateLimitBucket(key, now);
    if (bucket.count >= authRateLimitMaxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      throw new ApiError(`Too many ${action} attempts. Try again in ${retryAfterSeconds} seconds.`, 429);
    }
  }

  for (const key of keys) {
    const bucket = getAuthRateLimitBucket(key, now);
    bucket.count += 1;
  }
}

function getAuthRateLimitBucket(key: string, now: number) {
  const existing = authRateLimitBuckets.get(key);
  if (existing && existing.resetAt > now) {
    return existing;
  }

  const bucket = { count: 0, resetAt: now + authRateLimitWindowMs };
  authRateLimitBuckets.set(key, bucket);
  return bucket;
}

function pruneExpiredAuthRateLimitBuckets(now: number) {
  if (authRateLimitBuckets.size < 1000) {
    return;
  }

  for (const [key, bucket] of authRateLimitBuckets) {
    if (bucket.resetAt <= now) {
      authRateLimitBuckets.delete(key);
    }
  }
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate =
    forwardedFor ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("true-client-ip")?.trim() ||
    "";
  return normalizeAuthRateLimitPart(candidate) || "unknown";
}

function normalizeAuthRateLimitPart(value: string) {
  return value.trim().toLowerCase();
}

export function jsonOk<T>(payload: T) {
  return NextResponse.json(payload);
}

export function pdfFileResponse(file: { buffer: Uint8Array; fileName: string; mimeType: string }) {
  const fileName = file.fileName.replace(/["\r\n]/g, "_") || "report.pdf";
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Content-Length": String(file.buffer.byteLength),
      "Content-Type": file.mimeType || "application/pdf",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(error);
  return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
}
