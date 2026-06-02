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
  consensusFormValues,
  updateConsensusValue,
  toggleConsensusChoice
}: ConsensusSectionProps) {
  const canArbitrate =
    selectedProject.memberIds.includes(currentUser.id) ||
    selectedProject.ownerIds.includes(currentUser.id) ||
    selectedProject.ownerId === currentUser.id;
  const consensusMessageIsSuccess = /finalized|saved|resolved/i.test(consensusMessage);

  if (activeCounts.studiesIncluded === 0) {
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
  const consensusQueue = projectExtractionReports.map((report) => {
    const submittedVotes = extractionResponses.filter(
      (response) =>
        response.projectId === selectedProject.id &&
        response.reportId === report.id &&
        response.templateId === activeExtractionTemplate.id &&
        response.isSubmitted
    ).length;
    const record = extractionConsensus.find(
      (consensus) =>
        consensus.projectId === selectedProject.id &&
        consensus.reportId === report.id &&
        consensus.templateId === activeExtractionTemplate.id
    );

    return {
      report,
      submittedVotes,
      record
    };
  });

  const pendingConsensusCount = consensusQueue.filter(
    (item) => item.submittedVotes >= requiredVotes && item.record?.status !== "finalized"
  ).length;
  const finalizedConsensusCount = consensusQueue.filter((item) => item.record?.status === "finalized").length;
  const activeReportForConsensus = activeExtractionReport ?? projectExtractionReports[0];
  const activeStudyForConsensus = activeReportForConsensus
    ? projectScreeningStudies.find((study) => study.id === activeReportForConsensus.studyId)
    : undefined;
  const submittedResponsesForActiveReport = activeReportForConsensus
    ? extractionResponses.filter(
        (response) =>
          response.projectId === selectedProject.id &&
          response.reportId === activeReportForConsensus.id &&
          response.templateId === activeExtractionTemplate.id &&
          response.isSubmitted
      )
    : [];
  const hasRequiredVotes = submittedResponsesForActiveReport.length >= requiredVotes;
  const flaggedFieldIdSet = new Set(activeExtractionConsensus?.flaggedFieldIds ?? []);
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
            <strong>{pendingConsensusCount} pending</strong>
            <p className="subtle">{finalizedConsensusCount} finalized records</p>
          </div>
          <button className="ghostButton" type="button" onClick={() => setActiveView("extraction")}>
            <ClipboardCheck size={16} />
            Back To Extraction
          </button>
          <label className="fieldLabel" htmlFor="consensus-report-picker">
            Study/report
          </label>
          <select
            id="consensus-report-picker"
            value={activeReportForConsensus?.id ?? ""}
            onChange={(event) => setActiveExtractionReportId(event.target.value)}
          >
            {projectExtractionReports.map((report) => {
              const item = consensusQueue.find((candidate) => candidate.report.id === report.id);
              const statusLabel =
                item && item.submittedVotes >= requiredVotes
                  ? item.record?.status === "finalized"
                    ? "finalized"
                    : "pending"
                  : "collecting votes";
              return (
                <option key={report.id} value={report.id}>
                  {report.title} ({statusLabel})
                </option>
              );
            })}
          </select>
        </div>
      </section>

      {consensusMessage ? (
        <div className={consensusMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
          {consensusMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{consensusMessage}</span>
        </div>
      ) : null}

      {!hasRequiredVotes ? (
        <section className="panel">
          <SectionTitle icon={AlertTriangle} title="Waiting For Independent Extractions" action="Automated gate" />
          <div className="validationItem blocked">
            <AlertTriangle size={17} />
            <span>
              {`This report has ${submittedResponsesForActiveReport.length}/${requiredVotes} submitted extraction vote${requiredVotes === 1 ? "" : "s"}.`}
            </span>
          </div>
        </section>
      ) : (
        <section className="panel">
          <SectionTitle icon={GitMerge} title="Automated Conflict Flagging" action={`${activeExtractionTemplate.fields.length} fields compared`} />
          <p className="subtle">
            {activeStudyForConsensus
              ? `${activeStudyForConsensus.title} · ${activeExtractionConsensus?.status === "finalized" ? "finalized" : "pending arbitration"}`
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

          {activeExtractionConsensus?.status === "finalized" ? (
            <div className="validationItem ok">
              <Check size={17} />
              <span>
                Finalized by {activeExtractionConsensus.finalizedByUserName || "System"} at {formatAuditTime(activeExtractionConsensus.finalizedAt || activeExtractionConsensus.updatedAt)}.
              </span>
            </div>
          ) : null}
        </section>
      )}

      {hasRequiredVotes && activeExtractionConsensus ? (
        <section className="panel">
          <SectionTitle icon={ClipboardCheck} title="Arbitration And Finalization" action={`${conflictedFields.length} conflicts`} />
          {conflictedFields.length === 0 ? (
            <div className="validationItem ok">
              <Check size={17} />
              <span>No conflicting extraction fields detected. This consensus record can be exported as finalized.</span>
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

              <button className="primaryButton" type="submit" disabled={!canArbitrate}>
                <Check size={17} />
                Finalize Consensus
              </button>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
