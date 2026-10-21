import type { Decision, PrismaCounts, Report, ReviewProject, Study } from "@/lib/prismaData";
import { getFullTextExclusionReasons, getTitleAbstractStatuses } from "@/lib/workflowSelectors";

type ExportConsistencyInput = {
  project: ReviewProject;
  counts: PrismaCounts;
  studies: Study[];
  reports: Report[];
  decisions: Decision[];
};

export function getExportConsistency({ project, counts, studies, reports, decisions }: ExportConsistencyInput) {
  const pendingRetrievalReports = reports.filter(
    (report) => report.projectId === project.id && report.retrievalStatus === "not_sought"
  );
  // A report enters full-text review before retrieval starts. Preserve aggregate
  // sought counts when only a sample of the underlying report rows is available.
  const reportsAdvancedToFullText = counts.reportsSought + pendingRetrievalReports.length;
  const abstractStatuses = getTitleAbstractStatuses(project, studies, decisions);
  const unresolvedScreeningStudies = studies.filter((study) => {
    const status = abstractStatuses.get(study.id);
    return status !== undefined && status !== "advance_full_text" && status !== "excluded_abstract";
  });
  const recordsIdentified = counts.recordsIdentifiedDatabase + counts.recordsIdentifiedRegisters + counts.recordsIdentifiedOther;
  const reportsExcludedTotal = Object.values(counts.reportsExcludedWithReasons).reduce((sum, count) => sum + count, 0);
  const preScreenRemovalTotal = counts.duplicateRecordsRemoved + counts.automationRemoved + counts.removedOtherReasons;
  const screenedAndPreScreenRemovedTotal = counts.recordsScreened + preScreenRemovalTotal;
  const screenBalanceTotal = counts.recordsExcluded + reportsAdvancedToFullText;
  const retrievalBalanceTotal = counts.reportsAssessed + counts.reportsNotRetrieved;
  const assessedBalanceTotal = reportsExcludedTotal + counts.studiesIncluded;
  const excludedFullTextDecisions = decisions.filter(
    (decision) => decision.projectId === project.id && decision.stage === "full_text" && decision.isCurrent && decision.decisionValue === "exclude"
  );
  const finalExclusions = getFullTextExclusionReasons(project, reports, decisions);
  const missingReasonReportIds = new Set(excludedFullTextDecisions.filter((decision) => !decision.exclusionReasonId)
    .map((decision) => decision.reportId ?? decision.studyId));
  for (const exclusion of finalExclusions) {
    if (!exclusion.reasonId || !project.exclusionReasons.includes(exclusion.reasonId)) missingReasonReportIds.add(exclusion.reportId);
  }
  const excludedWithoutReasonCount = missingReasonReportIds.size;

  const identifiedCheckActive = recordsIdentified > 0 || screenedAndPreScreenRemovedTotal > 0;
  const screenedCheckActive = counts.recordsScreened > 0 || screenBalanceTotal > 0;
  const retrievalCheckActive = counts.reportsSought > 0 || retrievalBalanceTotal > 0;
  const assessedCheckActive = counts.reportsAssessed > 0 || assessedBalanceTotal > 0;
  const exclusionReasonCheckActive = excludedFullTextDecisions.length > 0 || finalExclusions.length > 0;

  const identifiedCheckOk = identifiedCheckActive && recordsIdentified >= screenedAndPreScreenRemovedTotal;
  const screenedCheckOk = screenedCheckActive && counts.recordsScreened === screenBalanceTotal;
  const retrievalCheckOk = retrievalCheckActive && counts.reportsSought === retrievalBalanceTotal;
  const assessedCheckOk = assessedCheckActive && counts.reportsAssessed === assessedBalanceTotal;
  const exclusionReasonCheckOk = exclusionReasonCheckActive && excludedWithoutReasonCount === 0;
  const activeCount = [identifiedCheckActive, screenedCheckActive, retrievalCheckActive, assessedCheckActive, exclusionReasonCheckActive].filter(Boolean).length;
  const passedCount = [identifiedCheckOk, screenedCheckOk, retrievalCheckOk, assessedCheckOk, exclusionReasonCheckOk].filter(Boolean).length;

  return {
    screenedAndPreScreenRemovedTotal,
    screenBalanceTotal,
    retrievalBalanceTotal,
    assessedBalanceTotal,
    excludedWithoutReasonCount,
    identifiedCheckActive,
    screenedCheckActive,
    retrievalCheckActive,
    assessedCheckActive,
    exclusionReasonCheckActive,
    identifiedCheckOk,
    screenedCheckOk,
    retrievalCheckOk,
    assessedCheckOk,
    exclusionReasonCheckOk,
    activeCount,
    passedCount,
    totalCount: 5,
    failedCount: activeCount - passedCount,
    reportsAdvancedToFullText,
    pendingRetrievalReports,
    unresolvedScreeningStudies
  };
}

export type ExportConsistency = ReturnType<typeof getExportConsistency>;
