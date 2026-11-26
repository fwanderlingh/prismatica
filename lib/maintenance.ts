export type MaintenanceSettings = {
  enabled: boolean;
  endsAt: string | null;
};

export type MaintenanceStatus = MaintenanceSettings & {
  canBypass: boolean;
};

export function maintenanceRetryAfter(endsAt: string | null) {
  return String(Math.max(60, Math.ceil(((endsAt ? Date.parse(endsAt) : 0) - Date.now()) / 1000)));
}

export function isMaintenanceExemptPath(pathname: string) {
  return pathname.startsWith("/_next/") || [
    "/maintenance", "/sign-in", "/api/maintenance", "/api/auth/config",
    "/api/auth/login", "/api/auth/logout", "/icon.svg", "/favicon.ico"
  ].includes(pathname);
}

export function formatMaintenanceEnd(endsAt: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full", timeStyle: "long", ...(timeZone ? { timeZone } : {})
  }).format(new Date(endsAt));
}

export function maintenanceDateInput(endsAt: string) {
  const date = new Date(endsAt);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
