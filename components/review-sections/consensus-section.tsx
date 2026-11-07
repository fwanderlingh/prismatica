import { ViewLink } from "@/components/navigation-link";
import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, ClipboardCheck, GitMerge } from "lucide-react";
import {
  type AppUser,
  type ExtractionConsensus,
  type ExtractionResponse,
  type ExtractionResponseValue,
  type ExtractionTemplate,
  type PrismaCounts,
  type Report,
  type ReviewProject,
  type Study,
  type ViewKey
} from "@/lib/prismaData";
import { Badge, EmptyState, SectionTitle, renderDoiLink } from "@/components/prisma-review-ui";
import { formatReportQueueOption } from "@/lib/reviewDisplay";
import { getExtractionConflictFieldIds, getExtractionConsensusQueue } from "@/lib/consensusQueue";

type FormSubmitEvent = {
  preventDefault: () => void;
};

type ConsensusQueueItem = ReturnType<typeof getExtractionConsensusQueue>[number];
type ConsensusReportFilter = "all" | ConsensusQueueItem["status"];

function ConsensusReportOverview({
  items,
  renderItems,
  children
}: {
  items: ConsensusQueueItem[];
  renderItems: (items: ConsensusQueueItem[]) => ReactNode;
  children?: ReactNode;
}) {
  const [statusFilter, setStatusFilter] = useState<ConsensusReportFilter>(() =>
    items.some((item) => item.status === "pending") ? "pending" : "all"
  );
  const visibleItems = statusFilter === "all" ? items : items.filter((item) => item.status === statusFilter);

  return (
    <section className="panel" aria-labelledby="consensus-reports-title">
      <h2 id="consensus-reports-title">Consensus reports</h2>
      <div className="reviewedItemsFilters">
        <label>
          <span>Consensus status</span>
          <select
            value={statusFilter}
            aria-controls="consensus-report-list"
            onChange={(event) => setStatusFilter(event.target.value as ConsensusReportFilter)}
          >
            <option value="all">All ({items.length})</option>
            <option value="pending">Pending consensus ({items.filter((item) => item.status === "pending").length})</option>
            <option value="collecting">Collecting extractions ({items.filter((item) => item.status === "collecting").length})</option>
            <option value="finalized">Finalized ({items.filter((item) => item.status === "finalized").length})</option>
          </select>
        </label>
        <span className="subtle" role="status">Showing {visibleItems.length} of {items.length}</span>
      </div>
      {statusFilter === "pending" && children ? children : (
        <div id="consensus-report-list">
          {visibleItems.length > 0 ? renderItems(visibleItems) : (
            <EmptyState
              icon={GitMerge}
              title="No matching consensus reports"
              description="Choose another status or All to view the other reports."
            />
          )}
        </div>
      )}
    </section>
  );
}

type ConsensusSectionProps = {
  activeCounts: PrismaCounts;
  selectedProject: ReviewProject;
  currentUser: AppUser;
  consensusMessage: string;
  activeExtractionTemplate?: ExtractionTemplate;
  projectExtractionReports: Report[];
  extractionResponses: ExtractionResponse[];
  extractionConsensus: ExtractionConsensus[];
  activeExtractionReport?: Report;
  projectScreeningStudies: Study[];
  activeExtractionConsensus?: ExtractionConsensus;
  setActiveView: (view: ViewKey) => void;
  setActiveExtractionReportId: (reportId: string) => void;
  formatExtractionResponseValue: (value: ExtractionResponseValue | undefined) => string;
  formatAuditTime: (value: string) => string;
  finalizeExtractionConsensus: (event: FormSubmitEvent) => void;
  isFinalizingExtractionConsensus: boolean;
  consensusFormValues: Record<string, ExtractionResponseValue | undefined>;
  updateConsensusValue: (fieldId: string, value: ExtractionResponseValue) => void;
  toggleConsensusChoice: (fieldId: string, option: string, checked: boolean) => void;
};

export function ConsensusSection({
  activeCounts,
  selectedProject,
  currentUser,
  consensusMessage,
  activeExtractionTemplate,
  projectExtractionReports,
  extractionResponses,
  extractionConsensus,
  activeExtractionReport,
  projectScreeningStudies,
  activeExtractionConsensus,
  setActiveView,
  setActiveExtractionReportId,
  formatExtractionResponseValue,
  formatAuditTime,
  finalizeExtractionConsensus,
  isFinalizingExtractionConsensus,
  consensusFormValues,
  updateConsensusValue,
  toggleConsensusChoice
}: ConsensusSectionProps) {
  const canArbitrate =
    currentUser.isAdmin ||
    selectedProject.memberIds.includes(currentUser.id) ||
    selectedProject.ownerIds.includes(currentUser.id) ||
    selectedProject.ownerId === currentUser.id;
  const consensusMessageIsSuccess = /finalized|saved|resolved/i.test(consensusMessage);

  if (activeCounts.studiesIncluded === 0 || projectExtractionReports.length === 0) {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Consensus arbitration</p>
            <h1>Conflict Flagging and Arbitration</h1>
            <p className="subtle">This workspace opens after dual extraction submissions are collected for included studies.</p>
          </div>
        </section>
        <section className="panel">
          <EmptyState
            icon={GitMerge}
            title="No reports in extraction"
            description="Complete inclusion and independent extraction before running discrepancy arbitration."
          />
        </section>
      </div>
    );
  }

  if (!activeExtractionTemplate) {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Consensus arbitration</p>
            <h1>Conflict Flagging and Arbitration</h1>
            <p className="subtle">Create an extraction template first, then collect dual extraction responses.</p>
          </div>
        </section>
        <section className="panel">
          <EmptyState
            icon={ClipboardCheck}
            title="No active extraction template"
            description="A project owner must define the extraction template before conflict flagging and arbitration can begin."
          />
        </section>
      </div>
    );
  }

  const requiredVotes = selectedProject.extractionRequiredVotes;
  const consensusQueue = getExtractionConsensusQueue(
    selectedProject, projectExtractionReports, extractionResponses, extractionConsensus, activeExtractionTemplate.id
  );
  const pendingItems = consensusQueue.filter((item) => item.status === "pending");
  const collectingItems = consensusQueue.filter((item) => item.status === "collecting");
  const finalizedItems = consensusQueue.filter((item) => item.status === "finalized");
  const activeReportForConsensus = activeExtractionReport ?? pendingItems[0]?.report ?? projectExtractionReports[0];
  const activeQueueItem = consensusQueue.find((item) => item.report.id === activeReportForConsensus?.id);
  const activeRecord = activeQueueItem?.record ?? (
    activeExtractionConsensus?.reportId === activeReportForConsensus?.id && activeExtractionConsensus?.templateId === activeExtractionTemplate.id
      ? activeExtractionConsensus : undefined
  );
  const activePendingIndex = pendingItems.findIndex((item) => item.report.id === activeReportForConsensus?.id);
  const nextPendingItem = pendingItems.length > 0 ? pendingItems[(activePendingIndex + 1) % pendingItems.length] : undefined;
  const activeStudyForConsensus = activeReportForConsensus
    ? projectScreeningStudies.find((study) => study.id === activeReportForConsensus.studyId)
    : undefined;
  const submittedResponsesForActiveReport = activeQueueItem?.submittedResponses ?? [];
  const hasRequiredVotes = submittedResponsesForActiveReport.length >= requiredVotes;
  const flaggedFieldIdSet = new Set(activeRecord?.flaggedFieldIds ?? getExtractionConflictFieldIds(activeExtractionTemplate.fields, submittedResponsesForActiveReport));
  const conflictedFields = activeExtractionTemplate.fields.filter((field) => flaggedFieldIdSet.has(field.id));
  const detailsLabel = `Consensus details for ${activeReportForConsensus.title}`;

  function selectConsensusReport(reportId: string) {
    setActiveExtractionReportId(reportId);
    window.requestAnimationFrame(() => {
      const details = document.getElementById("consensus-report-details");
      if (!details) return;
      details.focus({ preventScroll: true });
      details.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "start"
      });
    });
  }

  const renderReportItems = (items: ConsensusQueueItem[]) => (
    <div className="exportReviewItems consensusPendingItems">
      <ul>
        {items.map(({ report, index, record, submittedResponses, status }) => {
          const isSelected = report.id === activeReportForConsensus?.id;
          const study = projectScreeningStudies.find((item) => item.id === report.studyId);
          const reportLabel = formatReportQueueOption(report, projectScreeningStudies, index + 1);
          const conflictCount = (record?.flaggedFieldIds ?? getExtractionConflictFieldIds(activeExtractionTemplate.fields, submittedResponses)).length;
          const statusLabel = status === "pending" ? "Pending consensus" : status === "collecting" ? "Collecting extractions" : "Finalized";
          return (
            <li key={report.id} aria-current={isSelected ? "true" : undefined}>
              <strong>{reportLabel}</strong>
              {study ? <div className="reviewedItemDoi">{renderDoiLink(study.doi, `DOI ${study.doi || "Missing"}`, study)}</div> : null}
              <Badge label={statusLabel} tone={status === "finalized" ? "success" : status === "pending" ? "warning" : "info"} />
              <small>
                {status === "pending"
                  ? conflictCount > 0 ? `${conflictCount} field conflict${conflictCount === 1 ? "" : "s"} to resolve` : "Ready for finalization"
                  : status === "collecting"
                    ? `${submittedResponses.length}/${requiredVotes} extraction votes submitted`
                    : `Finalized by ${record?.finalizedByUserName || "System"} at ${formatAuditTime(record?.finalizedAt || record?.updatedAt || "")}`}
              </small>
              <button
                className={isSelected ? "primaryButton" : "ghostButton"}
                type="button"
                disabled={isFinalizingExtractionConsensus}
                aria-controls="consensus-report-details"
                aria-label={`${status === "pending" ? "Review consensus" : "View consensus"}: ${reportLabel}`}
                onClick={() => selectConsensusReport(report.id)}
              >
                <GitMerge size={16} />
                {isSelected ? "Reviewing this report" : status === "pending" ? "Review consensus" : "View consensus"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div className="viewStack">
      <section className="overviewBand compactBand">
        <div>
          <p className="eyebrow">Consensus arbitration</p>
          <h1>Conflict Flagging and Arbitration</h1>
          <p className="subtle">Automated discrepancy detection, side-by-side review, and final consensus finalization.</p>
        </div>
        <div className="reportPicker">
          <div>
            <p className="eyebrow">Queue status</p>
            <strong>{pendingItems.length} pending</strong>
            <p className="subtle">{finalizedItems.length} finalized records</p>
          </div>
          <ViewLink className="ghostButton" view="extraction" onNavigate={() => setActiveView("extraction")}>
            <ClipboardCheck size={16} />
            Back To Extraction
          </ViewLink>
          {nextPendingItem ? (
            <button
              className="primaryButton"
              type="button"
              disabled={isFinalizingExtractionConsensus || nextPendingItem.report.id === activeReportForConsensus?.id}
              aria-controls="consensus-report-details"
              onClick={() => selectConsensusReport(nextPendingItem.report.id)}
            >
              <GitMerge size={16} />
              {activePendingIndex < 0 ? "Review pending consensus" : "Next pending consensus"}
            </button>
          ) : null}
          <label className="fieldLabel" htmlFor="consensus-report-picker">
            Study/report
          </label>
          <select
            id="consensus-report-picker"
            value={activeReportForConsensus?.id ?? ""}
            disabled={isFinalizingExtractionConsensus}
            aria-controls="consensus-report-details"
            onChange={(event) => selectConsensusReport(event.target.value)}
          >
            {[
              { label: `Pending consensus (${pendingItems.length})`, items: pendingItems },
              { label: `Collecting extraction votes (${collectingItems.length})`, items: collectingItems },
              { label: `Finalized consensus (${finalizedItems.length})`, items: finalizedItems }
            ].filter((group) => group.items.length > 0).map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map(({ report, index }) => (
                  <option key={report.id} value={report.id}>
                    {formatReportQueueOption(report, projectScreeningStudies, index + 1)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </section>

      {consensusMessage ? (
        <div className={consensusMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
          {consensusMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{consensusMessage}</span>
        </div>
      ) : null}

      <ConsensusReportOverview
        key={`${selectedProject.id}:${activeExtractionTemplate.id}`}
        items={consensusQueue}
        renderItems={renderReportItems}
      >
        {pendingItems.length > 0 ? (
          <section id="consensus-report-list" aria-labelledby="pending-consensus-title">
            <h3 id="pending-consensus-title">Pending consensus ({pendingItems.length})</h3>
            <p className="subtle">Resolve these records to finish consensus and enable CSV export.</p>
            {renderReportItems(pendingItems)}
          </section>
        ) : null}
      </ConsensusReportOverview>

      {!hasRequiredVotes ? (
        <section className="panel" id="consensus-report-details" tabIndex={-1} aria-label={detailsLabel}>
          <SectionTitle icon={AlertTriangle} title="Waiting For Independent Extractions" action="Automated gate" />
          {activeStudyForConsensus ? (
            <div className="reviewedItemDoi">{renderDoiLink(activeStudyForConsensus.doi, `DOI ${activeStudyForConsensus.doi || "Missing"}`, activeStudyForConsensus)}</div>
          ) : null}
          <div className="validationItem blocked">
            <AlertTriangle size={17} />
            <span>
              {`This report has ${submittedResponsesForActiveReport.length}/${requiredVotes} submitted extraction vote${requiredVotes === 1 ? "" : "s"}.`}
            </span>
          </div>
        </section>
      ) : (
        <section className="panel" id="consensus-report-details" tabIndex={-1} aria-label={detailsLabel}>
          <SectionTitle icon={GitMerge} title="Automated Conflict Flagging" action={`${activeExtractionTemplate.fields.length} fields compared`} />
          <p className="subtle">
            {activeStudyForConsensus
              ? `${activeStudyForConsensus.title} · ${activeQueueItem?.status === "finalized" ? "finalized" : "pending arbitration"}`
              : "Select a report to review extraction discrepancies."}
          </p>
          {activeStudyForConsensus ? (
            <div className="reviewedItemDoi">{renderDoiLink(activeStudyForConsensus.doi, `DOI ${activeStudyForConsensus.doi || "Missing"}`, activeStudyForConsensus)}</div>
          ) : null}
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  {submittedResponsesForActiveReport.map((response) => (
                    <th key={response.id}>{response.userName}</th>
                  ))}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {activeExtractionTemplate.fields.map((field) => {
                  const isFlagged = flaggedFieldIdSet.has(field.id);
                  return (
                    <tr key={field.id}>
                      <td>
                        <strong>{field.title}</strong>
                      </td>
                      {submittedResponsesForActiveReport.map((response) => (
                        <td key={`${field.id}:${response.id}`}>{formatExtractionResponseValue(response.values[field.id])}</td>
                      ))}
                      <td>{isFlagged ? "Conflict" : "Match"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {activeQueueItem?.status === "finalized" && activeRecord ? (
            <div className="validationItem ok">
              <Check size={17} />
              <span>
                Finalized by {activeRecord.finalizedByUserName || "System"} at {formatAuditTime(activeRecord.finalizedAt || activeRecord.updatedAt)}.
              </span>
            </div>
          ) : null}
        </section>
      )}

      {hasRequiredVotes ? (
        <section className="panel">
          <SectionTitle icon={ClipboardCheck} title="Arbitration And Finalization" action={`${conflictedFields.length} conflicts`} />
          {conflictedFields.length === 0 ? (
            <div className="validationItem ok">
              <Check size={17} />
              <span>{activeQueueItem?.status === "finalized" ? "No conflicting extraction fields detected. This consensus record is finalized." : "No conflicting extraction fields detected. Finalize this consensus record to include it in the export."}</span>
              {activeQueueItem?.status !== "finalized" ? (
                <button className="primaryButton" type="button" disabled={!canArbitrate || isFinalizingExtractionConsensus} onClick={finalizeExtractionConsensus}>
                  {isFinalizingExtractionConsensus ? "Finalizing..." : "Finalize Consensus"}
                </button>
              ) : null}
            </div>
          ) : (
            <form className="extractionForm" onSubmit={finalizeExtractionConsensus}>
              {conflictedFields.map((field) => {
                const value = consensusFormValues[field.id];
                return (
                  <fieldset className="extractionField" key={field.id}>
                    <legend>{field.title}</legend>
                    {field.type === "multiline_text" ? (
                      <textarea
                        disabled={isFinalizingExtractionConsensus}
                        value={typeof value === "string" ? value : ""}
                        onChange={(event) => updateConsensusValue(field.id, event.target.value)}
                      />
                    ) : null}
                    {field.type === "single_choice" ? (
                      <div className="choiceList">
                        {field.options.map((option) => (
                          <label key={option}>
                            <input
                              type="radio"
                              name={`consensus-${field.id}`}
                              disabled={isFinalizingExtractionConsensus}
                              checked={value === option}
                              onChange={() => updateConsensusValue(field.id, option)}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                    {field.type === "multiple_choice" ? (
                      <div className="choiceList">
                        {field.options.map((option) => {
                          const checked = Array.isArray(value) && value.includes(option);
                          return (
                            <label key={option}>
                              <input
                                type="checkbox"
                                disabled={isFinalizingExtractionConsensus}
                                checked={checked}
                                onChange={(event) => toggleConsensusChoice(field.id, option, event.target.checked)}
                              />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </fieldset>
                );
              })}

              <button className="primaryButton" type="submit" disabled={!canArbitrate || isFinalizingExtractionConsensus}>
                {isFinalizingExtractionConsensus ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
                {isFinalizingExtractionConsensus ? "Finalizing..." : "Finalize Consensus"}
              </button>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
