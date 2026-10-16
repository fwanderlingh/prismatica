import { useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { SectionTitle } from "@/components/prisma-review-ui";
import { ViewLink } from "@/components/navigation-link";
import type { StorageInfo } from "@/lib/storageInfo";
import type { ViewKey } from "@/lib/prismaData";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bytes / 1024 ** index)} ${units[index]}`;
}

export function StorageInfoSection({ openProject }: { openProject: (projectId: string, view?: ViewKey) => void }) {
  const [snapshot, setSnapshot] = useState<StorageInfo | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const response = await fetch("/api/admin/storage", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw new Error("Storage information unavailable");
        const result = await response.json() as StorageInfo;
        if (!controller.signal.aborted) setSnapshot(result);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [refresh]);

  const remote = snapshot?.provider === "minio";
  const disk = snapshot?.disk;
  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Storage Info</h1>
          <p className="subtle">PDF storage usage across all reviews and available disk space.</p>
        </div>
        <button className="ghostButton" disabled={loading} onClick={() => setRefresh(value => value + 1)}>
          {loading ? <span className="inlineSpinner" aria-hidden="true" /> : <RefreshCw size={17} />}
          {loading ? "Checking storage..." : "Refresh"}
        </button>
      </section>
      <p role="status">
        {error ? `Storage information could not be refreshed.${snapshot ? " The figures below are from the last successful check." : " Try again using Refresh."}`
          : loading ? "Measuring stored PDFs..."
          : snapshot ? `Last checked: ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.checkedAt))}.` : ""}
      </p>
      {snapshot ? <>
        <section className="metricGrid" aria-label="Storage totals">
          <div className="metricCard blue"><span>Total PDF storage</span><strong title={`${snapshot.total.bytes} bytes`}>{formatBytes(snapshot.total.bytes)}</strong><p>{snapshot.total.files.toLocaleString()} stored files{remote ? ", including local copies" : ""}</p></div>
          <div className="metricCard teal"><span>{remote ? "Application disk capacity" : "Total disk capacity"}</span><strong>{disk ? formatBytes(disk.totalBytes) : "Unavailable"}</strong><p>{remote ? "Application data filesystem" : "Filesystem containing the PDF folder"}</p></div>
          <div className="metricCard amber"><span>Disk used</span><strong>{disk ? formatBytes(disk.usedBytes) : "Unavailable"}</strong><p>All files on this filesystem</p></div>
          <div className="metricCard green"><span>Disk available</span><strong>{disk ? formatBytes(disk.availableBytes) : "Unavailable"}</strong><p>Space available to the application</p></div>
        </section>
        {remote ? <p className="subtle">MinIO PDFs: {formatBytes(snapshot.total.objectBytes)}. Local PDF copies: {formatBytes(snapshot.total.localBytes)}. Remote storage capacity is unavailable through the object storage API; disk figures describe the application server.</p> : null}
        <section className="panel">
          <SectionTitle icon={HardDrive} title="Storage by Review" action={`${snapshot.reviews.length} reviews`} />
          <p className="subtle">Sorted by storage usage. Totals include retained PDF files and copies, including files no longer linked to a report. Sizes exclude filesystem overhead, object storage replication, and noncurrent object versions.</p>
          <div className="tableWrap">
            <table>
              <thead><tr><th scope="col">Review</th><th scope="col">Stored files</th><th scope="col">PDF storage</th>{remote ? <><th scope="col">MinIO</th><th scope="col">Local copies</th></> : null}</tr></thead>
              <tbody>
                {snapshot.reviews.map(review => <tr key={review.id}>
                  <td><ViewLink view="projectDashboard" projectId={review.id} onNavigate={() => openProject(review.id)}>{review.title}</ViewLink></td>
                  <td>{review.files.toLocaleString()}</td><td title={`${review.bytes} bytes`}>{formatBytes(review.bytes)}</td>
                  {remote ? <><td>{formatBytes(review.objectBytes)}</td><td>{formatBytes(review.localBytes)}</td></> : null}
                </tr>)}
                {snapshot.unassigned.files > 0 ? <tr>
                  <td>Deleted or unassigned reviews</td><td>{snapshot.unassigned.files.toLocaleString()}</td><td>{formatBytes(snapshot.unassigned.bytes)}</td>
                  {remote ? <><td>{formatBytes(snapshot.unassigned.objectBytes)}</td><td>{formatBytes(snapshot.unassigned.localBytes)}</td></> : null}
                </tr> : null}
                {snapshot.reviews.length === 0 && snapshot.unassigned.files === 0 ? <tr><td colSpan={remote ? 5 : 3}>No reviews or stored PDFs yet.</td></tr> : null}
              </tbody>
              <tfoot><tr><th scope="row">Total</th><td>{snapshot.total.files.toLocaleString()}</td><td>{formatBytes(snapshot.total.bytes)}</td>{remote ? <><td>{formatBytes(snapshot.total.objectBytes)}</td><td>{formatBytes(snapshot.total.localBytes)}</td></> : null}</tr></tfoot>
            </table>
          </div>
        </section>
      </> : null}
    </div>
  );
}
