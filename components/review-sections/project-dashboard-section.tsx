import { Activity, AlertTriangle, ChevronRight, History, Settings, Users } from "lucide-react";
import type { Decision, PrismaCounts, ProjectWorkflowConflict, Report, ReviewProject, Study, WorkflowEvent, AppUser, ViewKey } from "@/lib/prismaData";
import { Badge, EmptyState, Metric, SectionTitle, StatusRow } from "@/components/prisma-review-ui";
import { getProjectPhaseProgress, getScreeningRecordTotal } from "@/lib/workflowSelectors";

type WorkflowConflict = ProjectWorkflowConflict & {
  studyIndex?: number;
};

type ProjectUserStatRow = {
  user: AppUser;
  importedRecords: number;
  duplicatePairsResolved: number;
  screened: number;
  uploadedPdf: number;
  fullTextReviews: number;
  extractions: number;
};

type ProjectDashboardSectionProps = {
  selectedProject: ReviewProject;
  workflowConflicts: WorkflowConflict[];
  recordsIdentified: number;
  activeCounts: PrismaCounts;
  reportsExcludedTotal: number;
  exportFailedCount: number;
  projectEvents: WorkflowEvent[];
  latestProjectEvents: WorkflowEvent[];
  projectUserStats: ProjectUserStatRow[];
  projectScreeningStudies: Study[];
  projectReportQueue: Report[];
  openConflict: (conflict: WorkflowConflict) => void;
  formatConflictStage: (stage: WorkflowConflict["stage"]) => string;
  decisionTone: (decision: Decision["decisionValue"]) => "success" | "warning" | "danger" | "info" | "neutral";
  formatDecision: (decision: Decision["decisionValue"]) => string;
  getWorkflowStepState: (step: "imports" | "screening" | "fullText" | "extraction", stage: ReviewProject["stage"]) => "complete" | "active" | "pending" | "warning";
  formatProjectPhase: (stage: ReviewProject["stage"]) => string;
  projectPhaseStatusTone: (stage: ReviewProject["stage"]) => "secure" | "info" | "warning" | "danger";
  formatMaybePolicy: (value: ReviewProject["maybePolicy"]) => string;
  formatAuditEntityLabel: (event: WorkflowEvent, project: ReviewProject, studies: Study[], reports: Report[]) => string;
  formatAuditTime: (value: string) => string;
  formatNumber: (value: number) => string;
  onOpenSettings: () => void;
  onOpenAudit: () => void;
  onNavigate: (view: ViewKey) => void;
};

export function ProjectDashboardSection({
  selectedProject,
  workflowConflicts,
  recordsIdentified,
  activeCounts,
  reportsExcludedTotal,
  exportFailedCount,
  projectEvents,
  latestProjectEvents,
  projectUserStats,
  projectScreeningStudies,
  projectReportQueue,
  openConflict,
  formatConflictStage,
  decisionTone,
  formatDecision,
  getWorkflowStepState,
  formatProjectPhase,
  projectPhaseStatusTone,
  formatMaybePolicy,
  formatAuditEntityLabel,
  formatAuditTime,
  formatNumber,
  onOpenSettings,
  onOpenAudit,
  onNavigate
}: ProjectDashboardSectionProps) {
  const alertCount = workflowConflicts.length;
  const phaseProgress = getProjectPhaseProgress(selectedProject, activeCounts, projectReportQueue, formatNumber);
  const screeningTotal = getScreeningRecordTotal(selectedProject, activeCounts);
  const phaseActions: Record<ReviewProject["stage"], { label: string; view: ViewKey }> = {
    setup: { label: "Import records", view: "imports" },
    import: { label: "Import records", view: "imports" },
    screening: { label: "Continue screening", view: "screening" },
    full_text: { label: "Review full text", view: "fullText" },
    extraction: { label: "Continue extraction", view: "extraction" },
    complete: { label: "Review exports", view: "exports" }
  };
  const phaseAction = phaseActions[selectedProject.stage];
  const nextActionLabel = alertCount > 0
    ? `Resolve ${alertCount} conflict${alertCount === 1 ? "" : "s"}`
    : phaseAction.label;

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Project Overview</p>
          <h1>{selectedProject.title}</h1>
          <p className="subtle">
            {selectedProject.protocolId} · {selectedProject.organization} · {formatProjectPhase(selectedProject.stage)}
          </p>
        </div>
        <div className="overviewSideStack">
          <div className="toolbarCluster">
            <button
              className="primaryButton"
              type="button"
              title={alertCount > 0 ? "Open the first unresolved workflow conflict" : phaseAction.label}
              onClick={() => {
                if (alertCount > 0) {
                  openConflict(workflowConflicts[0]);
                } else {
                  onNavigate(phaseAction.view);
                }
              }}
            >
              {alertCount > 0 ? <AlertTriangle size={17} /> : <ChevronRight size={17} />}
              {nextActionLabel}
            </button>
            <button className="ghostButton" type="button" title="Open project settings" onClick={onOpenSettings}>
              <Settings size={17} />
              Settings
            </button>
          </div>
        </div>
      </section>

      {/*<section className="metricGrid" aria-label="Project metrics">
        <Metric label="Records identified" value={formatNumber(recordsIdentified)} tone="blue" detail="Database, register, and manual sources" />
        <Metric label="Duplicates removed" value={activeCounts.duplicateRecordsRemoved.toString()} tone="teal" detail="Preserved for PRISMA provenance" />
        <Metric label="Records screened" value={activeCounts.recordsScreened.toString()} tone="amber" detail={`${activeCounts.recordsExcluded} excluded at title/abstract`} />
        <Metric label="Studies included" value={activeCounts.studiesIncluded.toString()} tone="green" detail={`${activeCounts.studiesExtracted} extracted`} />
      </section>*/}

      {workflowConflicts.length > 0 ? (
        <section className="panel">
          <SectionTitle icon={AlertTriangle} title="Conflict Resolution" action={`${workflowConflicts.length} open`} />
          <div className="conflictList">
            {workflowConflicts.map((conflict) => (
              <article className="conflictItem" key={conflict.id}>
                <div className="conflictMain">
                  <div>
                    <Badge label={formatConflictStage(conflict.stage)} tone={conflict.stage === "full_text" ? "info" : "warning"} />
                    <h3>{conflict.title}</h3>
                    <p>{conflict.subtitle}</p>
                  </div>
                  <div className="voteStrip" aria-label={`${conflict.title} votes`}>
                    {conflict.decisions.length > 0 ? (
                      conflict.decisions.map((decision) => (
                        <span className={`votePill ${decisionTone(decision.decisionValue)}`} key={decision.id}>
                          <strong>{decision.userName}</strong>
                          {formatDecision(decision.decisionValue)}
                        </span>
                      ))
                    ) : (
                      <span className="votePill neutral">
                        <strong>Blind mode</strong>
                        Vote details hidden
                      </span>
                    )}
                  </div>
                </div>
                <button className="ghostButton" type="button" onClick={() => openConflict(conflict)}>
                  <ChevronRight size={17} />
                  Resolve
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="dashboardGrid">
        <div className="panel largePanel workflowPanel">
          <SectionTitle
            icon={Activity}
            title="Review Workflow"
            action={`${formatProjectPhase(selectedProject.stage)} · ${phaseProgress.label}`}
          />
          <div className="workflowMap" aria-label="Review workflow">
            {[
              ["Import", `${formatNumber(recordsIdentified)} records`, getWorkflowStepState("imports", selectedProject.stage)],
              ["Deduplicate", `${activeCounts.duplicateRecordsRemoved} removed`, recordsIdentified > 0 ? "complete" : "pending"],
              ["Screen", `${formatNumber(activeCounts.recordsScreened)}/${formatNumber(screeningTotal)} screened`, getWorkflowStepState("screening", selectedProject.stage)],
              ["Full text", `${activeCounts.reportsSought} reports`, getWorkflowStepState("fullText", selectedProject.stage)],
              [
                "Extract",
                `${activeCounts.studiesExtracted}/${activeCounts.studiesIncluded} extracted`,
                getWorkflowStepState("extraction", selectedProject.stage)
              ],
              [
                "Export",
                exportFailedCount > 0 ? `${exportFailedCount} checks need review` : "PRISMA 2020 ready",
                activeCounts.studiesIncluded === 0
                  ? "pending"
                  : exportFailedCount > 0
                    ? "warning"
                    : "complete"
              ]
            ].map(([label, value, status]) => (
              <div className={`workflowNode ${status}`} key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="stateRows">
            <StatusRow label="Review phase" value={formatProjectPhase(selectedProject.stage)} tone={projectPhaseStatusTone(selectedProject.stage)} />
            <StatusRow
              label="Passed title/abstract screening"
              value={`${formatNumber(activeCounts.reportsSought)} advanced to full text`}
              tone="info"
            />
            <StatusRow
              label="Extraction progress"
              value={`${activeCounts.studiesExtracted}/${activeCounts.studiesIncluded} extracted`}
              tone={
                activeCounts.studiesIncluded === 0
                  ? "info"
                  : activeCounts.studiesExtracted >= activeCounts.studiesIncluded
                    ? "secure"
                    : "warning"
              }
            />
            <StatusRow label="Blind mode" value={selectedProject.blindMode ? "Enabled" : "Disabled"} tone="info" />
            <StatusRow label="Maybe policy" value={formatMaybePolicy(selectedProject.maybePolicy)} tone="info" />
            <StatusRow label="Unresolved conflicts" value={`${selectedProject.conflicts} open conflicts`} tone="warning" />
          </div>
        </div>

        <div className="panel">
          <SectionTitle icon={History} title="Audit Trail" action={projectEvents.length > 5 ? `Latest 5 of ${projectEvents.length}` : "Append-only"} />
          {projectEvents.length > 0 ? (
            <>
              <div className="eventList">
                {latestProjectEvents.map((event) => (
                  <article className="eventItem" key={event.id}>
                    <div>
                      <strong>{event.action}</strong>
                      <span>
                        {event.actor} · {formatAuditEntityLabel(event, selectedProject, projectScreeningStudies, projectReportQueue)}
                      </span>
                    </div>
                    <time>{formatAuditTime(event.time)}</time>
                  </article>
                ))}
              </div>
              <div className="auditTrailActions">
                <button className="ghostButton" type="button" onClick={onOpenAudit}>
                  <History size={17} />
                  Full Audit
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={History}
              title="No project events yet"
              description="Imports, decisions, adjudications, and exports will create append-only audit events for this review."
            />
          )}
        </div>
      </section>

      <section className="panel">
        <SectionTitle icon={Users} title="Reviewer Activity" action="Per-user project stats" />
        <div className="tableWrap">
          <table className="reviewerActivityTable">
            <colgroup>
              <col className="reviewerColumn" />
              <col className="importedRecordsColumn" />
              <col className="dedupResolvedColumn" />
              <col className="screenedColumn" />
              <col className="uploadedPdfColumn" />
              <col className="fullTextColumn" />
              <col className="extractionsColumn" />
            </colgroup>
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Imported records</th>
                <th>Duplicate pairs resolved</th>
                <th>Screened</th>
                <th>Uploaded PDF</th>
                <th>Full text reviews</th>
                <th>Extractions</th>
              </tr>
            </thead>
            <tbody>
              {projectUserStats.map((row) => (
                <tr key={row.user.id}>
                  <td>
                    <strong>{row.user.name}</strong>
                    <span>{row.user.title}</span>
                  </td>
                  <td>{row.importedRecords}</td>
                  <td>{row.duplicatePairsResolved}</td>
                  <td>{row.screened}</td>
                  <td>{row.uploadedPdf}</td>
                  <td>{row.fullTextReviews}</td>
                  <td>{row.extractions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
