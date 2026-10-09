import { ViewLink } from "@/components/navigation-link";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, ArrowLeft, FileText, Upload, X } from "lucide-react";
import type { Report, Study } from "@/lib/prismaData";
import { Badge, EmptyState, SectionTitle, renderDoiLink } from "@/components/prisma-review-ui";

type QueuedPdf = {
  id: number;
  file: File;
  reportId: string;
  status: "ready" | "uploading" | "uploaded" | "failed";
  error?: string;
};

type PdfUploadSectionProps = {
  projectId: string;
  projectTitle: string;
  reports: Report[];
  studies: Study[];
  maxSizeMb: number;
  uploadPdf: (reportId: string, file: File) => Promise<void>;
  deletePdf: (reportId: string, checksum?: string) => Promise<void>;
  onBack: () => void;
};

const PAGE_SIZE = 25;

export function PdfUploadSection({ projectId, projectTitle, reports, studies, maxSizeMb, uploadPdf, deletePdf, onBack }: PdfUploadSectionProps) {
  const [queue, setQueue] = useState<QueuedPdf[]>([]);
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<{ success: boolean; message: string } | null>(null);
  const isBusy = isUploading || deletingReportId !== null;
  const batchInput = useRef<HTMLInputElement>(null);
  const singleInput = useRef<HTMLInputElement>(null);
  const targetReport = useRef("");
  const nextId = useRef(0);
  const uploadLock = useRef(false);
  const pendingFiles = queue.filter((item) => item.status === "ready" || item.status === "failed");
  const reportIds = new Set(reports.map((report) => report.id));
  const assignedIds = pendingFiles.map((item) => item.reportId);
  const canUpload = pendingFiles.length > 0 && pendingFiles.every((item) => reportIds.has(item.reportId)) && new Set(assignedIds).size === assignedIds.length;
  const uploadedCount = reports.filter((report) => report.fileName).length;
  const doiByStudyId = useMemo(() => new Map(studies.map((study) => [study.id, study.doi])), [studies]);
  const filteredReports = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reports.filter((report) => (!missingOnly || !report.fileName) && (!query || `${report.title} ${report.citation} ${report.fileName ?? ""}`.toLowerCase().includes(query)));
  }, [reports, search, missingOnly]);
  const pageCount = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleReports = filteredReports.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function chooseFiles(event: ChangeEvent<HTMLInputElement>, reportId = "") {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const errors: string[] = [];
    const additions: QueuedPdf[] = [];
    for (const file of files) {
      if (file.size === 0 || (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
        errors.push(`${file.name}: choose a non-empty PDF.`);
      } else if (file.size > maxSizeMb * 1024 * 1024) {
        errors.push(`${file.name}: exceeds the ${maxSizeMb} MB file limit.`);
      } else {
        additions.push({ id: nextId.current++, file, reportId, status: "ready" });
      }
    }
    setMessage(errors.join(" "));
    setQueue((previous) => [
      ...previous.filter((item) => additions.length === 0 || !reportId || item.reportId !== reportId || item.status === "uploaded"),
      ...additions
    ]);
  }

  async function uploadAll() {
    if (!canUpload || uploadLock.current) return;
    uploadLock.current = true;
    setIsUploading(true);
    setMessage("");
    try {
      // Send files individually and sequentially so a batch never exceeds the
      // per-request limit or races the server's project-state writes.
      for (const item of pendingFiles) {
        setQueue((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", error: undefined } : entry));
        try {
          await uploadPdf(item.reportId, item.file);
          setQueue((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, status: "uploaded" } : entry));
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Upload failed. Please try again.";
          setQueue((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: detail } : entry));
        }
      }
    } finally {
      uploadLock.current = false;
      setIsUploading(false);
    }
  }

  async function deleteReportPdf(report: Report) {
    if (uploadLock.current || !window.confirm(`Delete "${report.fileName}" from "${report.title}"? This permanently removes the attached PDF.`)) return;
    uploadLock.current = true;
    setDeletingReportId(report.id);
    setDeleteResult(null);
    try {
      await deletePdf(report.id, report.checksum);
      setDeleteResult({ success: true, message: `Deleted ${report.fileName}.` });
    } catch (error) {
      setDeleteResult({ success: false, message: error instanceof Error ? error.message : "Could not delete the PDF. Please try again." });
    } finally {
      uploadLock.current = false;
      setDeletingReportId(null);
    }
  }

  return (
    <div className="viewStack">
      <section className="overviewBand compactBand">
        <div>
          <p className="eyebrow">Full text · PDF files</p>
          <h1>PDFs Upload</h1>
          <p className="subtle">{projectTitle}</p>
          <p>Choose PDFs for the papers below, then upload them together. PDF upload is optional.</p>
        </div>
        <ViewLink view="fullText" className="ghostButton"  disabled={isBusy} onNavigate={onBack}>
          <ArrowLeft size={17} /> Back to full text
        </ViewLink>
      </section>

      <section className="panel">
        <SectionTitle icon={Upload} title="Upload files" action={`${uploadedCount} of ${reports.length} papers have PDFs`} />
        <p className="subtle bottomMargin">Maximum {maxSizeMb} MB per PDF. For a batch, select files and assign each to its paper. Uploading to a paper with an existing PDF replaces that file.</p>
        <input className="hiddenFileInput" ref={batchInput} type="file" accept="application/pdf,.pdf" multiple disabled={isBusy} onChange={(event) => chooseFiles(event)} />
        <input className="hiddenFileInput" ref={singleInput} type="file" accept="application/pdf,.pdf" disabled={isBusy} onChange={(event) => chooseFiles(event, targetReport.current)} />
        <div className="buttonRow">
          <button className="ghostButton" type="button" disabled={isBusy || reports.length === 0} onClick={() => batchInput.current?.click()}><Upload size={17} /> Select PDFs</button>
          <button className="primaryButton" type="button" disabled={isBusy || !canUpload} onClick={uploadAll}>
            {isUploading ? <span className="inlineSpinner" aria-hidden="true" /> : <Upload size={17} />}
            {isUploading ? "Uploading…" : `Upload ${pendingFiles.length} PDF${pendingFiles.length === 1 ? "" : "s"}`}
          </button>
          {queue.length > 0 ? <button className="ghostButton" type="button" disabled={isBusy} onClick={() => { setQueue([]); setMessage(""); }}>Clear list</button> : null}
        </div>
        {message ? <div className="validationItem blocked pdfBatchNotice" role="status"><AlertTriangle size={17} /><span>{message}</span></div> : null}
        {pendingFiles.length > 0 && !canUpload ? <p className="pdfBatchNotice" role="status">Choose a different paper for each pending PDF to enable upload.</p> : null}
        {queue.length > 0 ? (
          <>
            <p className="pdfBatchNotice" role="status" aria-live="polite">{queue.filter((item) => item.status === "uploaded").length} uploaded · {queue.filter((item) => item.status === "failed").length} failed · {queue.filter((item) => item.status === "ready" || item.status === "uploading").length} pending</p>
            <div className="tableWrap">
              <table className="pdfUploadTable">
                <thead><tr><th>PDF file</th><th>Paper</th><th>Result</th><th>Action</th></tr></thead>
                <tbody>
                  {queue.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.file.name}</strong><p className="subtle">{(item.file.size / 1024 / 1024).toFixed(1)} MB</p></td>
                      <td>
                        <select aria-label={`Paper for ${item.file.name}`} value={item.reportId} disabled={isBusy || item.status === "uploaded"} onChange={(event) => {
                          const reportId = event.target.value;
                          setQueue((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, reportId, status: "ready", error: undefined } : entry));
                        }}>
                          <option value="">Choose paper…</option>
                          {reports.map((report) => <option key={report.id} value={report.id} disabled={queue.some((other) => other.id !== item.id && other.status !== "uploaded" && other.reportId === report.id)}>{report.title}{report.fileName ? " (replace PDF)" : ""}</option>)}
                        </select>
                      </td>
                      <td>
                        <Badge label={item.status === "uploading" ? "Uploading…" : item.status === "uploaded" ? "Uploaded" : item.status === "failed" ? "Failed" : item.reportId ? "Ready" : "Choose paper"} tone={item.status === "uploaded" ? "success" : item.status === "failed" ? "danger" : "info"} />
                        {item.error ? <p className="pdfUploadError">{item.error}</p> : null}
                      </td>
                      <td><button className="ghostButton iconOnly" type="button" aria-label={`Remove ${item.file.name} from upload list`} disabled={isBusy} onClick={() => setQueue((previous) => previous.filter((entry) => entry.id !== item.id))}><X size={17} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="panel">
        <SectionTitle icon={FileText} title="Full-text papers" action={`${filteredReports.length} papers`} />
        {deleteResult ? <div className={deleteResult.success ? "validationItem ok pdfBatchNotice" : "validationItem blocked pdfBatchNotice"} role="status">{deleteResult.success ? <FileText size={17} /> : <AlertTriangle size={17} />}<span>{deleteResult.message}</span></div> : null}
        <div className="pdfUploadFilters">
          <label>Search papers<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Title, citation, or PDF filename" /></label>
          <label className="pdfMissingFilter"><input type="checkbox" checked={missingOnly} onChange={(event) => { setMissingOnly(event.target.checked); setPage(1); }} /> Only papers missing PDFs</label>
        </div>
        {visibleReports.length > 0 ? (
          <>
            <div className="tableWrap">
              <table className="pdfUploadTable pdfPapersTable">
                <colgroup>
                  <col style={{ width: "44%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "16%" }} />
                </colgroup>
                <thead><tr><th>Paper</th><th>DOI Link</th><th>PDF</th><th>Action</th></tr></thead>
                <tbody>
                  {visibleReports.map((report) => {
                    const queuedFile = queue.find((item) => item.reportId === report.id && item.status !== "uploaded");
                    const doi = doiByStudyId.get(report.studyId)?.trim() ?? "";
                    return (
                      <tr key={report.id}>
                        <td><strong>{report.title}</strong><p className="subtle">{report.citation}</p></td>
                        <td>{doi ? renderDoiLink(doi) : <Badge label="No DOI" tone="neutral" />}</td>
                        <td>
                          {report.fileName ? <a href={`/api/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(report.id)}/pdf`} target="_blank" rel="noreferrer">{report.fileName}</a> : <Badge label="No PDF" tone="neutral" />}
                          {queuedFile ? <p className="subtle">Selected: {queuedFile.file.name}</p> : null}
                        </td>
                        <td>
                          <div className="pdfPaperActions">
                            <button className="ghostButton" type="button" disabled={isBusy} aria-label={`${report.fileName ? "Replace" : "Choose"} PDF for ${report.title}`} onClick={() => { targetReport.current = report.id; singleInput.current?.click(); }}><Upload size={16} />{report.fileName ? "Replace" : "Choose PDF"}</button>
                            {report.fileName ? <button className="ghostButton iconOnly pdfDeleteButton" type="button" disabled={isBusy} title="Delete PDF" aria-label={`Delete PDF for ${report.title}`} onClick={() => deleteReportPdf(report)}>{deletingReportId === report.id ? <span className="inlineSpinner" aria-hidden="true" /> : <X size={18} />}</button> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="paginationBar">
              <button className="ghostButton" type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
              <span>Page {currentPage} of {pageCount}</span>
              <button className="ghostButton" type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
            </div>
          </>
        ) : <EmptyState icon={FileText} title={reports.length === 0 ? "No full-text papers yet" : "No matching papers"} description={reports.length === 0 ? "Papers appear here after passing title/abstract screening." : "Change the search or missing-PDF filter to see more papers."} />}
      </section>
    </div>
  );
}
