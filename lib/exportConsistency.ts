import type { Decision, PrismaCounts, Report, ReviewProject, Study } from "@/lib/prismaData";
import { getFullTextExclusionReasons, getTitleAbstractStatuses } from "@/lib/workflowSelectors";

type ExportConsistencyInput = {
  project: ReviewProject;
  counts: PrismaCounts;
  studies: Study[];
  reports: Report[];
  decisions: Decision[];
};

export type ExclusionReasonIssue = {
  reportId: string;
  title: string;
  importItemId?: number;
  invalidReasons: (string | null)[];
  suggestedReason?: string;
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
  const reportsById = new Map(reports.filter((report) => report.projectId === project.id).map((report) => [report.id, report]));
  const studiesById = new Map(studies.filter((study) => study.projectId === project.id).map((study) => [study.id, study]));
  const isConfiguredReason = (reason: string | null | undefined): reason is string => Boolean(reason && project.exclusionReasons.includes(reason));
  const missingReasonReportIds = new Set<string>();
  const exclusionReasonIssues: ExclusionReasonIssue[] = [];
  for (const exclusion of finalExclusions) {
    const report = reportsById.get(exclusion.reportId);
    const reportDecisions = excludedFullTextDecisions.filter((decision) => (decision.reportId ?? decision.studyId) === exclusion.reportId);
    const invalidReasons = new Set(reportDecisions.filter((decision) => !isConfiguredReason(decision.exclusionReasonId))
      .map((decision) => decision.exclusionReasonId || null));
    if (!isConfiguredReason(exclusion.reasonId)) invalidReasons.add(exclusion.reasonId || null);
    // Blind review exposes an aggregate repair flag without revealing peer votes.
    if (report?.fullTextExclusionReasonNeedsCorrection && invalidReasons.size === 0) invalidReasons.add(null);
    if (invalidReasons.size === 0) continue;
    missingReasonReportIds.add(exclusion.reportId);
    // A correction endpoint needs a real report; orphaned historical votes cannot
    // offer a repair action for an unrelated item.
    if (!report) continue;
    const candidates = new Set(reportDecisions.map((decision) => decision.exclusionReasonId).filter(isConfiguredReason));
    if (isConfiguredReason(exclusion.reasonId)) candidates.add(exclusion.reasonId);
    for (const reason of invalidReasons) {
      if (!reason) continue;
      const matchingReasons = project.exclusionReasons.filter((configured) => configured.trim().toLowerCase() === reason.trim().toLowerCase());
      if (matchingReasons.length === 1) candidates.add(matchingReasons[0]);
    }
    exclusionReasonIssues.push({
      reportId: report.id,
      title: report.title,
      importItemId: studiesById.get(report.studyId)?.importItemId,
      invalidReasons: [...invalidReasons],
      ...(candidates.size === 1 ? { suggestedReason: [...candidates][0] } : {})
    });
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
    unresolvedScreeningStudies,
    exclusionReasonIssues
  };
}

export type ExportConsistency = ReturnType<typeof getExportConsistency>;
