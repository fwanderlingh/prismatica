import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Clock, Power, RefreshCw, Wrench } from "lucide-react";
import { SectionTitle, StatusRow } from "@/components/prisma-review-ui";
import { MaintenanceNotice } from "@/components/maintenance-notice";
import { formatMaintenanceEnd, maintenanceDateInput, type MaintenanceSettings } from "@/lib/maintenance";

export function MaintenanceSection() {
  const [settings, setSettings] = useState<MaintenanceSettings | null>(null);
  const [endsAt, setEndsAt] = useState(() => maintenanceDateInput(new Date(Date.now() + 60 * 60_000).toISOString()));
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"save" | "stop" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const response = await fetch("/api/admin/maintenance", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Maintenance settings could not be loaded.");
        if (controller.signal.aborted) return;
        const snapshot = result as MaintenanceSettings;
        setSettings(snapshot);
        if (snapshot.endsAt && (snapshot.enabled || Date.parse(snapshot.endsAt) > Date.now())) setEndsAt(maintenanceDateInput(snapshot.endsAt));
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Maintenance settings could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [refresh]);

  async function update(enabled: boolean) {
    setError("");
    setMessage("");
    const date = new Date(endsAt);
    if (enabled && (!endsAt || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now())) {
      setError("Choose an expected end date and time in the future.");
      return;
    }
    setPending(enabled ? "save" : "stop");
    try {
      const response = await fetch("/api/admin/maintenance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, ...(enabled ? { endsAt: date.toISOString() } : {}) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Maintenance settings could not be saved.");
      setSettings(result as MaintenanceSettings);
      setMessage(enabled ? "Maintenance is active. Visitors will see the maintenance page and expected end date." : "Maintenance stopped. The site is available to users again.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Maintenance settings could not be saved.");
    } finally {
      setPending(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void update(true);
  }

  const previewDate = endsAt && Number.isFinite(new Date(endsAt).getTime()) ? new Date(endsAt).toISOString() : null;
  const disabled = loading || Boolean(pending) || !settings;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div><p className="eyebrow">Administration</p><h1>Maintenance Mode</h1><p className="subtle">Temporarily close the site and display an expected return date.</p></div>
        <button type="button" className="ghostButton" disabled={loading || Boolean(pending)} onClick={() => setRefresh(value => value + 1)}>
          {loading ? <span className="inlineSpinner" aria-hidden="true" /> : <RefreshCw size={17} />}Refresh
        </button>
      </section>
      {error ? <div className="validationItem blocked" role="alert"><AlertTriangle size={17} /><span>{error}</span></div> : null}
      {message ? <div className="validationItem ok" role="status"><Check size={17} /><span>{message}</span></div> : null}
      <div className="settingsGrid">
        <section className="panel maintenanceSettings" aria-busy={loading || Boolean(pending)}>
          <SectionTitle icon={Wrench} title="Maintenance controls" action={loading ? "Loading…" : settings?.enabled ? "Active" : settings ? "Off" : "Unavailable"} />
          <div className="stateRows">
            <StatusRow label="Site status" value={loading ? "Loading…" : settings?.enabled ? "Under maintenance" : settings ? "Available" : "Unavailable"} tone={settings?.enabled ? "warning" : "info"} />
            {settings?.enabled && settings.endsAt ? <StatusRow label="Expected return" value={formatMaintenanceEnd(settings.endsAt)} tone="info" /> : null}
          </div>
          <p>During maintenance, visitors and regular users see the information page. Administrators can still sign in and use the site.</p>
          <form className="inviteForm" onSubmit={submit}>
            <label htmlFor="maintenance-ends-at">
              <span>Expected end date and time</span>
              <input id="maintenance-ends-at" type="datetime-local" required value={endsAt} disabled={disabled} onChange={event => { setEndsAt(event.target.value); setMessage(""); }} aria-describedby="maintenance-timezone" />
              <small id="maintenance-timezone">Your timezone: {timeZone}. Visitors see this time in their own timezone.</small>
            </label>
            <div className="buttonRow">
              <button type="submit" className="primaryButton" disabled={disabled}>
                {pending === "save" ? <span className="inlineSpinner" aria-hidden="true" /> : <Clock size={17} />}
                {pending === "save" ? "Saving…" : settings?.enabled ? "Update end date" : "Start maintenance"}
              </button>
              {settings?.enabled ? <button type="button" className="ghostButton" disabled={disabled} onClick={() => void update(false)}>
                {pending === "stop" ? <span className="inlineSpinner" aria-hidden="true" /> : <Power size={17} />}
                {pending === "stop" ? "Stopping…" : "Stop maintenance"}
              </button> : null}
            </div>
          </form>
          <p className="subtle">Maintenance begins immediately when you start it. The end date is an estimate; use Stop maintenance to reopen the site.</p>
          {settings?.enabled ? <a href="/maintenance" target="_blank" rel="noreferrer">Open visitor information page</a> : null}
        </section>
        <section className="panel maintenancePreview" aria-label="Visitor page preview">
          <SectionTitle icon={Clock} title="Visitor preview" action="Unsaved preview" />
          <MaintenanceNotice endsAt={previewDate} />
        </section>
      </div>
    </div>
  );
}
