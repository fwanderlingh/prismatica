import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { SectionTitle } from "./prisma-review-ui";

export function TransactionalEmailSettings({ enabled, pending, onChange }: { enabled: boolean; pending: boolean; onChange: (enabled: boolean) => void }) {
  const [status, setStatus] = useState<{ configured: boolean; issues: string[] } | null>(null);
  const [error, setError] = useState("");
  async function refresh() {
    setError("");
    try {
      const response = await fetch("/api/admin/auth-settings", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to check email configuration.");
      setStatus(payload);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to check email configuration.");
    }
  }
  useEffect(() => { void refresh(); }, []);

  return <div className="panel">
    <SectionTitle icon={Mail} title="Transactional Email" action={enabled ? "Enabled" : "Disabled"} />
    <p className="subtle">Send account confirmation and password-reset emails through Scaleway TEM. When disabled, users can register and sign in directly, and administrators can reset passwords.</p>
    <label className="toggleRow">
      <input type="checkbox" checked={enabled} disabled={pending || (!enabled && !status?.configured)} onChange={(event) => onChange(event.target.checked)} />
      <span /><strong>{pending ? "Saving..." : "Enable transactional email"}</strong>
    </label>
    <p className="subtle">Enabling email requires new public accounts to confirm their address. Existing accounts and administrator-created accounts remain usable.</p>
    {status ? <>
      <p role="status">{status.configured ? "Server configuration is present. Verify your sending domain and delivery in Scaleway before enabling." : "Complete the server configuration before enabling email."}</p>
      {status.issues.length ? <ul>{status.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
    </> : <p>Checking server configuration...</p>}
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" className="secondaryButton" onClick={() => void refresh()}>Refresh configuration status</button>
  </div>;
}
