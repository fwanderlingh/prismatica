import crypto from "crypto";
import { getUserSessionState } from "./serverStore";
import { cookies } from "next/headers";

const sessionCookieName = "prismatica_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;

type SessionPayload = {
  userId: string;
  expiresAt: number;
  version?: string;
};

function getSessionSecret() {
  return process.env.PRISMATICA_SESSION_SECRET ?? "development-only-prismatica-session-secret";
}

function signValue(value: string) {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function encodeSession(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signValue(body)}`;
}

function decodeSession(token: string): SessionPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expectedSignature = signValue(body);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.userId || payload.expiresAt <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getSessionUserId() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(sessionCookieName);
  if (!sessionCookie?.value) {
    return null;
  }

  const session = decodeSession(sessionCookie.value);
  if (!session) return null;
  const state = getUserSessionState(session.userId);
  return state && state.version === (session.version ?? "") ? session.userId : null;
}

// Use a one-way key for presence; never store the authentication cookie itself.
export async function getSessionPresenceKey() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  return token && decodeSession(token) ? crypto.createHash("sha256").update(token).digest("hex") : null;
}

export async function setSessionCookie(userId: string) {
  const state = getUserSessionState(userId);
  if (!state) throw new Error("Cannot create a session for this account.");
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, encodeSession({ userId, version: state.version, expiresAt: Date.now() + sessionMaxAgeSeconds * 1000 }), {
    httpOnly: true,
    maxAge: sessionMaxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: process.env.PRISMATICA_SECURE_COOKIES === "true"
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.PRISMATICA_SECURE_COOKIES === "true"
  });
}
