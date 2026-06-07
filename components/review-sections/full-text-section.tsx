import { useEffect, useState, type ChangeEvent, type RefObject } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Upload,
  XCircle
} from "lucide-react";
import { type AppUser, type Decision, type Report, type ReviewProject, screeningStudies, type Study } from "@/lib/prismaData";
import { type DecisionValue, evaluateStage } from "@/lib/workflow";
import { EmptyState, SectionTitle, StatusRow, renderDoiLink } from "@/components/prisma-review-ui";

type FullTextUpdateInput = {
  decisionValue?: DecisionValue;
  exclusionReasonId?: string;
};

type ProjectPhaseProgress = {
  percent: number;
  label: string;
};

type FullTextSectionProps = {
  hasProjectSeedData: boolean;
  phaseProgress: ProjectPhaseProgress;
  projectReportQueue: Report[];
  totalFullTextReportCount: number;
  uploadedPdfCount: number;
  activeReport: Report;
  decisions: Decision[];
  selectedProject: ReviewProject;
  currentUser: AppUser;
  fullTextMessage: string;
  setActiveReportId: (reportId: string) => void;
  setFullTextMessage: (message: string) => void;
  pdfInputRef: RefObject<HTMLInputElement | null>;
  pendingFullTextAction: "upload" | "include" | "exclude" | null;
  uploadReportPdf: (event: ChangeEvent<HTMLInputElement>) => void;
  updateFullTextReport: (input: FullTextUpdateInput) => void;
  formatDecision: (value: DecisionValue) => string;
  formatConflictResolutionHint: (requiredVotes: number) => string;
  decisionTone: (value: DecisionValue) => "success" | "warning" | "danger" | "info" | "neutral";
  fullTextReason: string;
  setFullTextReason: (reason: string) => void;
  exclusionReasons: string[];
  studies: Study[];
};

type PdfLoadState = "idle" | "loading" | "ready" | "error";

const pdfViewerPreferences = "#page=1&view=FitH&pagemode=none&navpanes=0";

export function FullTextSection({
  hasProjectSeedData,
  phaseProgress,
  projectReportQueue,
  totalFullTextReportCount,
  uploadedPdfCount,
  activeReport,
  decisions,
  selectedProject,
  currentUser,
  fullTextMessage,
  setActiveReportId,
  setFullTextMessage,
  pdfInputRef,
  pendingFullTextAction,
  uploadReportPdf,
  updateFullTextReport,
  formatDecision,
  formatConflictResolutionHint,
  decisionTone,
  fullTextReason,
  setFullTextReason,
  exclusionReasons,
  studies
}: FullTextSectionProps) {
  const pdfViewerUrl = activeReport.fileName
    ? `/api/projects/${selectedProject.id}/reports/${activeReport.id}?pdf=1&checksum=${encodeURIComponent(activeReport.checksum ?? "")}&file=${encodeURIComponent(activeReport.fileName)}${pdfViewerPreferences}`
    : "";
  const pdfFrameKey = [
    selectedProject.id,
    activeReport.id,
    activeReport.checksum ?? "",
    activeReport.fileName ?? ""
  ].join(":");
  const [pdfLoadState, setPdfLoadState] = useState<PdfLoadState>(pdfViewerUrl ? "loading" : "idle");

  useEffect(() => {
    setPdfLoadState(pdfViewerUrl ? "loading" : "idle");
  }, [pdfFrameKey, pdfViewerUrl]);

  if (projectReportQueue.length === 0) {
    return (
      <div className="viewStack">
        <section className="overviewBand compactBand">
          <div>
            <p className="eyebrow">Full-text screening</p>
            <h1>Report Review</h1>
            <p className="subtle">Reports appear here after title/abstract decisions advance studies to full text.</p>
          </div>
        </section>
        <section className="panel">
          <EmptyState
            icon={BookOpen}
            title={totalFullTextReportCount > 0 ? "No active full-text reports" : "No full-text reports"}
            description={
              totalFullTextReportCount > 0
                ? "All available reports have enough votes, are waiting on checked-out reviewers, or need owner resolution."
                : "No reports are available for full-text review yet."
            }
          />
        </section>
      </div>
    );
  }

  const currentReportStudy = (hasProjectSeedData ? screeningStudies : studies).find((study) => study.id === activeReport.studyId) ?? screeningStudies[0];
  const activeFullTextDecision = decisions.find(
    (decision) =>
      decision.projectId === selectedProject.id &&
      decision.reportId === activeReport.id &&
      decision.userId === currentUser.id &&
      decision.stage === "full_text" &&
      decision.isCurrent
  );
  const visibleFullTextDecisions = decisions.filter(
    (decision) =>
      decision.projectId === selectedProject.id &&
      decision.reportId === activeReport.id &&
      decision.stage === "full_text" &&
      decision.isCurrent
  );
  const visibleFullTextEvaluation = evaluateStage(
    "full_text",
    visibleFullTextDecisions.map((decision) => decision.decisionValue),
    activeReport.fullTextRequiredVotes ?? selectedProject.fullTextRequiredVotes,
    selectedProject.maybePolicy
  );
  const selectedDecision = activeFullTextDecision?.decisionValue;
  const canExclude = selectedDecision === "exclude";
  const pdfDisplayName = activeReport.fileName || activeReport.pdfName || "No PDF uploaded";
  const hasUploadedPdf = Boolean(activeReport.fileName);
  const uploadedPdfPercent = totalFullTextReportCount > 0 ? Math.round((uploadedPdfCount / totalFullTextReportCount) * 100) : 0;
  const pdfStatus = hasUploadedPdf ? "Uploaded" : "Missing PDF";
  const hasConfiguredExclusionReasons = exclusionReasons.length > 0;
  const hasFullTextCheckout = Boolean(activeReport.fullTextCheckedOutByCurrentUser);
  const canRecordFullTextDecision = hasFullTextCheckout || Boolean(activeFullTextDecision);
  const fullTextVoteCount = activeReport.fullTextVoteCount ?? visibleFullTextDecisions.length;
  const fullTextRequiredVotes = activeReport.fullTextRequiredVotes ?? selectedProject.fullTextRequiredVotes;
  const fullTextStatus = activeReport.fullTextStatus ?? visibleFullTextEvaluation.state;
  const fullTextStatusLabel = activeReport.fullTextStatusLabel ?? visibleFullTextEvaluation.label;
  const hasFullTextConflict = fullTextStatus === "conflict" || fullTextStatus === "needs_third_vote";
  const messageIsSuccess = /updated|saved|uploaded|completed/i.test(fullTextMessage);
  const messageIsError = /error|failed|invalid|cannot|unable|missing|required|not found|forbidden|unauthorized|denied/i.test(fullTextMessage);
  const fullTextMessageClassName = messageIsSuccess
    ? "validationItem ok"
    : messageIsError
      ? "validationItem blocked"
      : "validationItem muted";
  const messageIsUploadRelated = pendingFullTextAction === "upload" || /upload|pdf/i.test(fullTextMessage);
  const showUploadMessage = Boolean(fullTextMessage) && messageIsUploadRelated;
  const showDecisionMessage = Boolean(fullTextMessage) && !messageIsUploadRelated;
  const activeReportIndex = projectReportQueue.findIndex((report) => report.id === activeReport.id);
  const canGoPreviousReport = activeReportIndex > 0;
  const canGoNextReport = activeReportIndex >= 0 && activeReportIndex < projectReportQueue.length - 1;
  const isFullTextActionPending = pendingFullTextAction !== null;
  const isPdfLoading = pdfLoadState === "loading";
  const hasPdfLoadError = pdfLoadState === "error";

  function selectReport(reportId: string) {
    setPdfLoadState("loading");
    setActiveReportId(reportId);
    setFullTextMessage("");
  }

  return (
    <div className="viewStack">
      <section className="overviewBand compactBand">
        <div>
          <p className="eyebrow">Full-text screening</p>
          <h1>Report Review</h1>
          <p className="subtle">Record include/exclude decisions and report-level exclusion reasons.</p>
        </div>
        <div className="progressStack">
          <div className="progressBlock">
            <span>{phaseProgress.label}</span>
            <div className="progressTrack">
              <i style={{ width: `${phaseProgress.percent}%` }} />
            </div>
          </div>
          <div className="progressBlock">
            <span>{uploadedPdfPercent}% PDFs uploaded · {uploadedPdfCount} of {totalFullTextReportCount} reports</span>
            <div className="progressTrack">
              <i style={{ width: `${uploadedPdfPercent}%` }} />
            </div>
          </div>
        </div>
        <div className="reportPicker">
          <div>
            <p className="eyebrow">Report queue</p>
            <strong>
              {projectReportQueue.length} active of {totalFullTextReportCount} report{totalFullTextReportCount === 1 ? "" : "s"}
            </strong>
            <p className="subtle">Active report: #{currentReportStudy.importItemId ?? activeReportIndex + 1} · {activeReport.title}</p>
          </div>
          <label className="fieldLabel" htmlFor="full-text-report-picker">
            Jump to report
          </label>
          <select
            id="full-text-report-picker"
            value={activeReport.id}
            onChange={(event) => selectReport(event.target.value)}
          >
            {projectReportQueue.map((report) => (
              <option key={report.id} value={report.id}>
                #{(hasProjectSeedData ? screeningStudies : studies).find((study) => study.id === report.studyId)?.importItemId ?? projectReportQueue.findIndex((candidate) => candidate.id === report.id) + 1} · {report.title}
              </option>
            ))}
          </select>
          <div className="buttonRow" aria-label="Report navigation">
            <button
              className="ghostButton iconOnly"
              type="button"
              title="Previous report"
              disabled={!canGoPreviousReport}
              onClick={() => {
                if (!canGoPreviousReport) {
                  return;
                }
                selectReport(projectReportQueue[activeReportIndex - 1].id);
              }}
            >
              <ArrowLeft size={17} />
            </button>
            <span>
              {activeReportIndex + 1} of {projectReportQueue.length}
            </span>
            <button
              className="ghostButton iconOnly"
              type="button"
              title="Next report"
              disabled={!canGoNextReport}
              onClick={() => {
                if (!canGoNextReport) {
                  return;
                }
                selectReport(projectReportQueue[activeReportIndex + 1].id);
              }}
            >
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>

      <section className="fullTextLayout">
        <div className="pdfPane">
          <div className="pdfToolbar">
            <strong className="pdfTitle" title={pdfDisplayName}>
              {pdfDisplayName}
            </strong>
            <div className="toolbarCluster">
              <input className="hiddenFileInput" ref={pdfInputRef} type="file" accept="application/pdf,.pdf" onChange={uploadReportPdf} />
              <button
                className={hasUploadedPdf ? "ghostButton" : "primaryButton missingPdfUploadButton"}
                type="button"
                title={hasUploadedPdf ? "Replace PDF" : "Upload PDF"}
                disabled={isFullTextActionPending}
                onClick={() => pdfInputRef.current?.click()}
              >
                {pendingFullTextAction === "upload" ? <span className="inlineSpinner" aria-hidden="true" /> : <Upload size={16} />}
                {pendingFullTextAction === "upload" ? "Uploading..." : hasUploadedPdf ? "Replace PDF" : "Upload PDF"}
              </button>
            </div>
          </div>
          {showUploadMessage ? (
            <div className={fullTextMessageClassName}>
              {messageIsSuccess ? <Check size={17} /> : messageIsError ? <AlertTriangle size={17} /> : <Upload size={17} />}
              <span>{fullTextMessage}</span>
            </div>
          ) : null}
          <div className={pdfViewerUrl ? "pdfCanvas pdfCanvasViewer" : "pdfCanvas"} aria-label="PDF review pane">
            {pdfViewerUrl ? (
              <div className="pdfFrameWrap" aria-busy={isPdfLoading}>
                {isPdfLoading || hasPdfLoadError ? (
                  <div className={hasPdfLoadError ? "pdfLoadingOverlay pdfLoadingOverlayError" : "pdfLoadingOverlay"} role="status" aria-live="polite">
                    <div className="pdfLoadingStatus">
                      {hasPdfLoadError ? <AlertTriangle size={18} /> : <span className="inlineSpinner" aria-hidden="true" />}
                      <span className="pdfLoadingText">{hasPdfLoadError ? "PDF failed to load." : "Loading PDF..."}</span>
                    </div>
                  </div>
                ) : null}
                <iframe
                  key={pdfFrameKey}
                  className={isPdfLoading ? "pdfViewer pdfViewerLoading" : "pdfViewer"}
                  src={pdfViewerUrl}
                  title={`${activeReport.title} PDF`}
                  onLoad={() => setPdfLoadState("ready")}
                  onError={() => setPdfLoadState("error")}
                />
              </div>
            ) : (
              <div className="paperPage emptyPdfPage">
                <p className="paperEyebrow">{pdfStatus}</p>
                <h2>{currentReportStudy.title}</h2>
                {activeReport.validationNotes.length > 0 ? (
                  <div className="pdfValidationNotes">
                    {activeReport.validationNotes.slice(0, 4).map((note) => (
                      <span key={note}>{note}</span>
                    ))}
                  </div>
                ) : null}
                <div className="paperLine wide" />
                <div className="paperLine" />
                <div className="paperLine short" />
              </div>
            )}
          </div>
        </div>

        <aside className="panel fullTextPanel">
          <SectionTitle icon={BookOpen} title="Report Metadata" action={`${activeReport.notes} notes`} />
          <h2>{activeReport.title}</h2>
          <p className="subtle">{activeReport.citation}</p>
          <div className="metaStrip">
            <span>
              DOI {renderDoiLink(currentReportStudy.doi, currentReportStudy.doi || "Missing")}
            </span>
          </div>

          <div className="pdfStatusGrid">
            <StatusRow label="PDF" value={pdfStatus} tone={hasUploadedPdf ? "secure" : "danger"} />
            <StatusRow
              label="Full-text status"
              value={fullTextStatusLabel}
              tone={
                hasFullTextConflict || fullTextStatus === "excluded_full_text"
                  ? "danger"
                  : fullTextStatus === "advance_extraction"
                    ? "secure"
                    : "warning"
              }
            />
            <StatusRow label="Full-text votes" value={`${fullTextVoteCount}/${fullTextRequiredVotes}`} tone={fullTextVoteCount >= fullTextRequiredVotes ? "secure" : "warning"} />
            <StatusRow
              label="Reviewer slot"
              value={hasFullTextCheckout || activeFullTextDecision ? "Checked out" : "Waiting"}
              tone={hasFullTextCheckout || activeFullTextDecision ? "secure" : "warning"}
            />
            <StatusRow label="Checksum" value={activeReport.checksum ? activeReport.checksum.slice(0, 12) : "Not available"} tone="info" />
          </div>

          <div className="decisionState">
            <span>My current full-text vote</span>
            <strong>{selectedDecision ? formatDecision(selectedDecision) : "No vote"}</strong>
          </div>
          {hasFullTextConflict ? (
            <div className="conflictVotesBox">
              <strong>{fullTextStatusLabel}</strong>
              <p>{formatConflictResolutionHint(fullTextRequiredVotes)}</p>
              <div className="voteStrip">
                {visibleFullTextDecisions.map((decision) => (
                  <span className={`votePill ${decisionTone(decision.decisionValue)}`} key={decision.id}>
                    <strong>{decision.userName}</strong>
                    {formatDecision(decision.decisionValue)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="decisionButtons compactButtons">
            <button
              className={selectedDecision === "include" ? "includeButton active" : "includeButton"}
              type="button"
              disabled={!canRecordFullTextDecision || isFullTextActionPending}
              onClick={() => updateFullTextReport({ decisionValue: "include" })}
            >
              {pendingFullTextAction === "include" ? <span className="inlineSpinner" aria-hidden="true" /> : <CheckCircle2 size={18} />}
              {pendingFullTextAction === "include" ? "Saving..." : "Include"}
            </button>
            <button
              className={selectedDecision === "exclude" ? "excludeButton active" : "excludeButton"}
              type="button"
              disabled={!canRecordFullTextDecision || !hasConfiguredExclusionReasons || isFullTextActionPending}
              onClick={() => updateFullTextReport({ decisionValue: "exclude", exclusionReasonId: fullTextReason })}
            >
              {pendingFullTextAction === "exclude" ? <span className="inlineSpinner" aria-hidden="true" /> : <XCircle size={18} />}
              {pendingFullTextAction === "exclude" ? "Saving..." : "Exclude"}
            </button>
          </div>
          {showDecisionMessage ? (
            <div className={fullTextMessageClassName}>
              {messageIsSuccess ? <Check size={17} /> : messageIsError ? <AlertTriangle size={17} /> : <Upload size={17} />}
              <span>{fullTextMessage}</span>
            </div>
          ) : null}

          <label className="fieldLabel" htmlFor="exclusion-reason">
            Exclusion reason
          </label>
          <select
            id="exclusion-reason"
            value={fullTextReason}
            disabled={!canRecordFullTextDecision || !hasConfiguredExclusionReasons || isFullTextActionPending}
            onChange={(event) => setFullTextReason(event.target.value)}
          >
            {exclusionReasons.map((reason) => (
              <option value={reason} key={reason}>
                {reason}
              </option>
            ))}
          </select>
          {!hasConfiguredExclusionReasons ? <p className="subtle">No reasons set.</p> : null}

          <div className={canRecordFullTextDecision && !hasFullTextConflict ? "validationBox ok" : "validationBox"}>
            {canRecordFullTextDecision && !hasFullTextConflict ? <Check size={17} /> : <AlertTriangle size={17} />}
            <span>
              {!hasUploadedPdf
                ? "PDF upload is optional for full-text decisions."
                : !hasConfiguredExclusionReasons
                ? "Set project exclusion reasons before recording an exclusion."
                : hasFullTextConflict
                ? "This report is in resolve-conflict state and cannot advance to extraction until the votes are reconciled."
                : "Include and Exclude are available while this report is checked out to you."}
            </span>
          </div>
          {canExclude ? (
            <div className="validationBox ok">
              <Check size={17} />
              <span>{`Current exclusion reason: ${activeFullTextDecision?.exclusionReasonId ?? fullTextReason}.`}</span>
            </div>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
