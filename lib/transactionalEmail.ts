// Server-side only. Credentials and message bodies must never reach client payloads or logs.
export type AccountEmailPurpose = "verification" | "password-reset";

export class EmailDeliveryError extends Error {
  constructor() {
    super("Email delivery is temporarily unavailable. Please try again later.");
  }
}

function emailConfiguration() {
  return {
    projectId: process.env.PRISMATICA_TEM_PROJECT_ID?.trim() ?? "",
    apiKey: process.env.PRISMATICA_TEM_API_KEY?.trim() ?? "",
    region: process.env.PRISMATICA_TEM_REGION?.trim() || "fr-par",
    from: process.env.PRISMATICA_EMAIL_FROM?.trim() ?? "",
    appUrl: process.env.PRISMATICA_PUBLIC_URL?.trim() ?? ""
  };
}

export function getEmailConfigurationStatus() {
  const config = emailConfiguration();
  const issues: string[] = [];
  if (!/^[0-9a-f-]{36}$/i.test(config.projectId)) issues.push("Set PRISMATICA_TEM_PROJECT_ID to your Scaleway project UUID.");
  if (!config.apiKey) issues.push("Set PRISMATICA_TEM_API_KEY to a secret key with TEM sending permission.");
  if (!/^[a-z]{2}-[a-z]{3}$/.test(config.region)) issues.push("Set PRISMATICA_TEM_REGION to a valid TEM region (for example fr-par).");
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(config.from)) issues.push("Set PRISMATICA_EMAIL_FROM to an address on your verified TEM domain.");
  try {
    const url = new URL(config.appUrl);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
  } catch {
    issues.push("Set PRISMATICA_PUBLIC_URL to the website HTTPS origin, without a path, query, or fragment.");
  }
  return { configured: issues.length === 0, issues };
}

export function assertEmailConfigured() {
  const status = getEmailConfigurationStatus();
  if (!status.configured) throw new EmailDeliveryError();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

export async function sendAccountEmail(input: { enabled: boolean; to: string; purpose: AccountEmailPurpose; token: string }) {
  if (!input.enabled) return { status: "disabled" as const };
  assertEmailConfigured();
  const config = emailConfiguration();
  const verification = input.purpose === "verification";
  const subject = verification ? "Confirm your PRISMATICA email address" : "Reset your PRISMATICA password";
  const action = verification ? "Confirm email address" : "Reset password";
  const expiry = verification ? "24 hours" : "30 minutes";
  const url = new URL(verification ? "/account/verify-email" : "/account/reset-password", config.appUrl);
  // Fragments are not transmitted in HTTP access logs or Referer headers.
  url.hash = new URLSearchParams({ token: input.token }).toString();
  const text = `${subject}\n\n${action}: ${url.href}\n\nThis single-use link expires in ${expiry}. If you did not request this email, you can ignore it.`;
  try {
    const response = await fetch(`https://api.scaleway.com/transactional-email/v1alpha1/regions/${config.region}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Token": config.apiKey },
      body: JSON.stringify({
        project_id: config.projectId,
        from: { email: config.from, name: "PRISMATICA" },
        to: [{ email: input.to }],
        subject,
        text,
        html: `<p>${escapeHtml(subject)}</p><p><a href="${escapeHtml(url.href)}">${action}</a></p><p>This single-use link expires in ${expiry}. If you did not request this email, you can ignore it.</p>`
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
      cache: "no-store"
    });
    if (!response.ok) throw new EmailDeliveryError();
    const result = await response.json() as { emails?: { id?: string }[] };
    if (!result.emails?.[0]?.id) throw new EmailDeliveryError();
    return { status: "accepted" as const };
  } catch {
    // Provider errors can echo recipients or message bodies. Never expose them.
    throw new EmailDeliveryError();
  }
}
