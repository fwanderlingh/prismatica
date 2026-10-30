import { ViewLink } from "@/components/navigation-link";
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
import { EmptyState, SectionTitle } from "@/components/prisma-review-ui";
import { formatReportQueueOption } from "@/lib/reviewDisplay";
import { getExtractionConflictFieldIds, getExtractionConsensusQueue } from "@/lib/consensusQueue";

type FormSubmitEvent = {
  preventDefault: () => void;
};

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
            <strong>{pendingItems.length > 0 ? <a className="consensusPendingLink" href="#pending-consensus-title">{pendingItems.length} pending</a> : "0 pending"}</strong>
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
              onClick={() => setActiveExtractionReportId(nextPendingItem.report.id)}
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
            onChange={(event) => setActiveExtractionReportId(event.target.value)}
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

      {pendingItems.length > 0 ? (
        <section className="panel" aria-labelledby="pending-consensus-title">
          <h2 id="pending-consensus-title">Pending consensus ({pendingItems.length})</h2>
          <p className="subtle">Resolve these records to finish consensus and enable CSV export.</p>
          <div className="exportReviewItems consensusPendingItems">
            <ul>
              {pendingItems.map(({ report, index, record, submittedResponses }) => {
                const isSelected = report.id === activeReportForConsensus?.id;
                const conflictCount = (record?.flaggedFieldIds ?? getExtractionConflictFieldIds(activeExtractionTemplate.fields, submittedResponses)).length;
                return (
                  <li key={report.id} aria-current={isSelected ? "true" : undefined}>
                    <strong>{formatReportQueueOption(report, projectScreeningStudies, index + 1)}</strong>
                    <small>{conflictCount > 0 ? `${conflictCount} field conflict${conflictCount === 1 ? "" : "s"} to resolve` : "Ready for finalization"}</small>
                    <button
                      className={isSelected ? "primaryButton" : "ghostButton"}
                      type="button"
                      disabled={isFinalizingExtractionConsensus}
                      aria-controls="consensus-report-details"
                      aria-label={`Review consensus: ${formatReportQueueOption(report, projectScreeningStudies, index + 1)}`}
                      onClick={() => setActiveExtractionReportId(report.id)}
                    >
                      <GitMerge size={16} />
                      {isSelected ? "Reviewing this report" : "Review consensus"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {!hasRequiredVotes ? (
        <section className="panel" id="consensus-report-details">
          <SectionTitle icon={AlertTriangle} title="Waiting For Independent Extractions" action="Automated gate" />
          <div className="validationItem blocked">
            <AlertTriangle size={17} />
            <span>
              {`This report has ${submittedResponsesForActiveReport.length}/${requiredVotes} submitted extraction vote${requiredVotes === 1 ? "" : "s"}.`}
            </span>
          </div>
        </section>
      ) : (
        <section className="panel" id="consensus-report-details">
          <SectionTitle icon={GitMerge} title="Automated Conflict Flagging" action={`${activeExtractionTemplate.fields.length} fields compared`} />
          <p className="subtle">
            {activeStudyForConsensus
              ? `${activeStudyForConsensus.title} · ${activeQueueItem?.status === "finalized" ? "finalized" : "pending arbitration"}`
              : "Select a report to review extraction discrepancies."}
          </p>
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
