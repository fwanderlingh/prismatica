import { NextResponse } from "next/server";
import { getSessionUserId } from "./serverAuth";
import { ApiError } from "./serverStore";

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

export function jsonOk<T>(payload: T) {
  return NextResponse.json(payload);
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(error);
  return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
}
