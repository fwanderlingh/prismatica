import { useEffect, useState } from "react";
import { Database, Download, Server } from "lucide-react";
import { SectionTitle } from "@/components/prisma-review-ui";
import type { InfrastructureInfo } from "@/lib/infrastructure";
import type { DatabaseBackupJob } from "@/lib/databaseBackup";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function DatabaseBackupPanel() {
  const [backup, setBackup] = useState<DatabaseBackupJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (creating) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const response = await fetch("/api/admin/backups", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Backup status is unavailable.");
        if (controller.signal.aborted) return;
        setBackup(result.backup);
        setError("");
        // Also recheck ready backups so an open page notices expiration.
        timer = setTimeout(() => setRefresh(value => value + 1), result.backup?.status === "running" ? 3000 : 60000);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Backup status is unavailable.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [creating, refresh]);

  async function createBackup() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/backups", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Backup creation could not start.");
      setBackup(result.backup);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Backup creation could not start.");
    } finally { setCreating(false); }
  }

  const running = creating || backup?.status === "running";
  return <section className="panel databaseBackupPanel">
    <SectionTitle icon={Database} title="Database backup" action="Administrator access" />
    <p className="subtle">Create a snapshot of all reviews, accounts, decisions, and settings. PDFs require a separate backup of the configured PDF storage. Download files are kept for 24 hours and contain private account data.</p>
    <div className="buttonRow">
      <button className="primaryButton" type="button" disabled={loading || running} onClick={() => void createBackup()}>
        {running ? <span className="inlineSpinner" aria-hidden="true" /> : <Database size={17} />}
        {running ? "Creating backup..." : "Create database backup"}
      </button>
      {backup?.status === "ready" ? <a className="ghostButton" href={`/api/admin/backups/${backup.id}/download`} download={backup.fileName}>
        <Download size={17} />Download backup
      </a> : null}
      {error ? <button className="ghostButton" type="button" onClick={() => setRefresh(value => value + 1)}>Check status</button> : null}
    </div>
    <p role="status" aria-live="polite">
      {error || (loading ? "Checking for an existing backup..."
        : running ? "The backup is being created. You can leave this page and return to download it."
        : backup?.status === "failed" ? backup.error
        : backup?.status === "ready" ? `Ready: ${backup.fileName} (${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format((backup.sizeBytes ?? 0) / 1024 ** 2)} MiB). Created ${dateLabel(backup.completedAt ?? backup.createdAt)}. Available until ${dateLabel(backup.expiresAt)}.`
        : "No backup is currently available. Create one to download a copy.")}
    </p>
  </section>;
}

export function InfrastructureSection() {
  const [info, setInfo] = useState<InfrastructureInfo | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/infrastructure", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Infrastructure configuration is unavailable.");
        if (!controller.signal.aborted) { setInfo(result); setError(""); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Infrastructure configuration is unavailable.");
      }
    })();
    return () => controller.abort();
  }, [refresh]);

  const database = info?.database;
  const pdf = info?.pdfStorage;
  const rows = info && database && pdf ? [
    ["Database", database.provider === "postgres" ? "PostgreSQL" : "JSON file"],
    ["Database configuration", database.configured ? "Configured" : "Incomplete"],
    ...(database.provider === "postgres" ? [
      ["Database host", database.host], ["Database port", database.port], ["Database name", database.name || "Not configured"]
    ] : [["State file", database.file]]),
    ["PDF storage", pdf.provider === "minio" ? "MinIO / S3-compatible" : "Local filesystem"],
    ["PDF storage configuration", pdf.configured ? "Configured" : "Incomplete"],
    ...(pdf.provider === "minio" ? [
      ["Object storage endpoint", pdf.endpoint], ["Bucket", pdf.bucket], ["Region", pdf.region],
      ["Path-style requests", pdf.pathStyle ? "Enabled" : "Disabled"], ["Local PDF fallback", pdf.localFallback ? "Enabled" : "Disabled"]
    ] : []),
    ["Local PDF directory", pdf.localDirectory],
    ["Temporary backup directory", info.backups.directory], ["Backup availability", `${info.backups.retentionHours} hours`]
  ] : [];

  return <div className="viewStack">
    <section className="overviewBand">
      <div>
        <p className="eyebrow">Administration</p>
        <h1>Infrastructure</h1>
        <p className="subtle">Active database, PDF storage, and backup configuration.</p>
      </div>
    </section>
    <section className="panel">
      <SectionTitle icon={Server} title="Infrastructure configuration" action="Active server configuration" />
      {info ? <div className="tableWrap"><table>
        <thead><tr><th scope="col">Setting</th><th scope="col">Value</th></tr></thead>
        <tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td></tr>)}</tbody>
      </table></div> : <p role="status">{error || "Loading infrastructure configuration..."}</p>}
      {error ? <button className="ghostButton" type="button" onClick={() => setRefresh(value => value + 1)}>Retry configuration</button> : null}
    </section>
  </div>;
}
