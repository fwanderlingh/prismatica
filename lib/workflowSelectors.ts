import { groupByKey } from "./collectionIndexes";
import {
  projectCounts as seedProjectCounts,
  type DedupCandidate,
  type Decision,
  type ExtractionResponse,
  type ExtractionTemplate,
  type PrismaCounts,
  type Report,
  type ReviewProject,
  type Study
} from "@/lib/prismaData";
import { evaluateStage } from "@/lib/workflow";

export type ProjectPhaseProgress = {
  percent: number;
  label: string;
};

type SequentialPhaseInput = {
  project: ReviewProject;
  studies: Study[];
  reports: Report[];
  decisions: Decision[];
  dedupCandidates: DedupCandidate[];
  recordsIdentified: number;
  studiesIncluded: number;
  useAggregateStatuses?: boolean;
};

export function getSequentialPhaseAccess({
  project, studies, reports, decisions, dedupCandidates, recordsIdentified, studiesIncluded, useAggregateStatuses = true
}: SequentialPhaseInput) {
  const importsComplete = recordsIdentified > 0 || project.recordsTotal > 0 || studies.length > 0;
  const dedupComplete = importsComplete && dedupCandidates.every((candidate) => candidate.status !== "pending");
  const currentDecisions = decisions.filter((decision) => decision.projectId === project.id && decision.isCurrent);
  const abstractDecisions = groupByKey(currentDecisions.filter((decision) => decision.stage === "title_abstract"), (decision) => decision.studyId);
  const fullTextDecisions = groupByKey(currentDecisions.filter((decision) => decision.stage === "full_text"), (decision) => decision.reportId);
  // Aggregate statuses include all reviewers' votes, including those hidden in blind review.
  const screeningComplete = dedupComplete && studies.length > 0 && studies.every((study) => {
    const status = (useAggregateStatuses ? study.titleAbstractStatus : undefined) ?? evaluateStage(
      "title_abstract", (abstractDecisions.get(study.id) ?? []).map((decision) => decision.decisionValue),
      study.titleAbstractRequiredVotes ?? project.abstractRequiredVotes, project.maybePolicy
    ).state;
    return status === "advance_full_text" || status === "excluded_abstract";
  });
  const fullTextComplete = screeningComplete && reports.length > 0 && reports.every((report) => {
    if (report.retrievalStatus === "not_retrieved") return true;
    const status = (useAggregateStatuses ? report.fullTextStatus : undefined) ?? evaluateStage(
      "full_text", (fullTextDecisions.get(report.id) ?? []).map((decision) => decision.decisionValue),
      report.fullTextRequiredVotes ?? project.fullTextRequiredVotes, project.maybePolicy
    ).state;
    return status === "advance_extraction" || status === "excluded_full_text";
  });
  const extractionAvailable = fullTextComplete && studiesIncluded > 0;
  const screeningStarted = project.stage !== "setup" && project.stage !== "import";
  return {
    imports: true,
    dedup: importsComplete || screeningStarted,
    screening: dedupComplete || screeningStarted,
    fullText: screeningComplete && reports.length > 0,
    extraction: extractionAvailable,
    consensus: extractionAvailable
  };
}

export function getSequentialProjectStage(input: SequentialPhaseInput): ReviewProject["stage"] {
  const { project } = input;
  if (!project.requireSequentialPhases || project.stage === "setup" || project.stage === "import" || project.stage === "screening") {
    return project.stage;
  }
  const access = getSequentialPhaseAccess(input);
  if (!access.fullText) return "screening";
  if ((project.stage === "extraction" || project.stage === "complete") && !access.extraction) return "full_text";
  return project.stage;
}

export function getWorkflowReportsForProject(project: ReviewProject, projectStudies: Study[], reports: Report[]) {
  const activeStudyIds = new Set(
    projectStudies
      .filter((study) => study.projectId === project.id && (study.stage === "full_text" || study.stage === "extraction"))
      .map((study) => study.id)
  );
  return reports.filter((report) => report.projectId === project.id && activeStudyIds.has(report.studyId));
}

export function sortReportsByStudyOrder(reports: Report[], studies: Study[]) {
  const reportOrderByStudyId = new Map(studies.map((study, index) => [study.id, study.importItemId ?? index + 1]));
  return reports.slice().sort((left, right) => {
    const leftOrder = reportOrderByStudyId.get(left.studyId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = reportOrderByStudyId.get(right.studyId) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.title.localeCompare(right.title);
  });
}

export function getTitleAbstractStatuses(project: ReviewProject, studies: Study[], decisions: Decision[]) {
  const currentDecisionsByStudy = groupByKey(
    decisions.filter((decision) => decision.projectId === project.id && decision.stage === "title_abstract" && decision.isCurrent),
    (decision) => decision.studyId
  );
  // Server aggregates include votes that blind review hides from this payload.
  return new Map(studies
    .filter((study) => !study.projectId || study.projectId === project.id)
    .map((study) => [study.id, study.titleAbstractStatus ?? evaluateStage(
      "title_abstract",
      (currentDecisionsByStudy.get(study.id) ?? []).map((decision) => decision.decisionValue),
      study.titleAbstractRequiredVotes ?? project.abstractRequiredVotes,
      project.maybePolicy
    ).state]));
}

// Completed report outcomes are safe aggregates in blind reviews. Individual
// decisions are only a fallback for snapshots without server workflow metadata.
export function getFullTextExclusionReasons(project: ReviewProject, reports: Report[], decisions: Decision[]) {
  const currentDecisionsByReport = groupByKey(decisions.filter(
    (decision) => decision.projectId === project.id && decision.stage === "full_text" && decision.isCurrent
  ), (decision) => decision.reportId ?? decision.studyId);
  const reportsById = new Map(reports.filter((report) => report.projectId === project.id).map((report) => [report.id, report]));
  const reportIds = new Set([...reportsById.keys(), ...currentDecisionsByReport.keys()]);
  return [...reportIds].flatMap((reportId) => {
    const report = reportsById.get(reportId);
    const currentDecisions = currentDecisionsByReport.get(reportId) ?? [];
    const status = report?.fullTextStatus ?? evaluateStage(
      "full_text", currentDecisions.map((decision) => decision.decisionValue),
      report?.fullTextRequiredVotes ?? project.fullTextRequiredVotes, project.maybePolicy
    ).state;
    if (status !== "excluded_full_text") return [];
    const reasonId = report?.fullTextExclusionReasonId !== undefined
      ? report.fullTextExclusionReasonId
      : currentDecisions.find((decision) => decision.decisionValue === "exclude")?.exclusionReasonId ?? null;
    return [{ reportId, reasonId }];
  });
}

export function getCountsForProject(
  project: ReviewProject,
  projectStudies: Study[] = [],
  projectReports: Report[] = [],
  decisions: Decision[] = [],
  extractionResponses: ExtractionResponse[] = [],
  extractionTemplates: ExtractionTemplate[] = [],
  projectDedupCandidates: DedupCandidate[] = []
): PrismaCounts {
  const confirmedDuplicateStudyIds = getConfirmedDuplicateStudyIds(projectDedupCandidates);
  const abstractStatuses = getTitleAbstractStatuses(project, projectStudies, decisions);
  const recordsExcluded = [...abstractStatuses.entries()]
    .filter(([studyId, status]) => status === "excluded_abstract" && !confirmedDuplicateStudyIds.has(studyId)).length;
  const fullTextCurrentDecisions = decisions.filter(
    (decision) => decision.projectId === project.id && decision.stage === "full_text" && decision.isCurrent
  );
  const fullTextDecisionsByReport = new Map<string, Decision[]>();
  for (const decision of fullTextCurrentDecisions) {
    const reportKey = decision.reportId ?? decision.studyId;
    fullTextDecisionsByReport.set(reportKey, [...(fullTextDecisionsByReport.get(reportKey) ?? []), decision]);
  }
  const fullTextExcluded = getFullTextExclusionReasons(project, projectReports, decisions);
  const reportsExcludedWithReasons = Object.fromEntries(project.exclusionReasons.map((reason) => [reason, 0])) as Record<string, number>;
  for (const { reasonId: reason } of fullTextExcluded) {
    if (!reason || !(reason in reportsExcludedWithReasons)) {
      continue;
    }
    reportsExcludedWithReasons[reason] = (reportsExcludedWithReasons[reason] ?? 0) + 1;
  }
  const assessedReportIds = new Set(fullTextDecisionsByReport.keys());
  for (const report of projectReports) {
    if (report.projectId !== project.id) continue;
    const voteCount = report.fullTextVoteCount ?? fullTextDecisionsByReport.get(report.id)?.length ?? 0;
    if (voteCount > 0) assessedReportIds.add(report.id);
    else assessedReportIds.delete(report.id);
  }

  const activeExtractionTemplate = extractionTemplates.find(
    (template) => template.projectId === project.id && template.isActive
  );
  const includedStudyIds = new Set(projectStudies.filter((study) => study.projectId === project.id && study.stage === "extraction").map((study) => study.id));
  const includedReports = projectReports.filter((report) => includedStudyIds.has(report.studyId));
  const submittedCountsByReport = new Map<string, number>();
  if (activeExtractionTemplate) {
    for (const response of extractionResponses) {
      if (response.projectId === project.id && response.templateId === activeExtractionTemplate.id && response.isSubmitted) {
        submittedCountsByReport.set(response.reportId, (submittedCountsByReport.get(response.reportId) ?? 0) + 1);
      }
    }
  }
  const studiesExtracted = activeExtractionTemplate
    ? includedReports.filter((report) => (submittedCountsByReport.get(report.id) ?? 0) >= project.extractionRequiredVotes).length
    : 0;

  return (
    seedProjectCounts[project.id] ?? {
      recordsIdentifiedDatabase: project.recordsTotal,
      recordsIdentifiedRegisters: 0,
      recordsIdentifiedOther: 0,
      duplicateRecordsRemoved: confirmedDuplicateStudyIds.size,
      automationRemoved: 0,
      removedOtherReasons: 0,
      recordsScreened: project.recordsScreened,
      recordsExcluded,
      reportsSought: projectReports.filter((report) => report.retrievalStatus !== "not_sought").length,
      reportsNotRetrieved: projectReports.filter((report) => report.retrievalStatus === "not_retrieved").length,
      reportsAssessed: assessedReportIds.size,
      reportsExcludedWithReasons,
      studiesIncluded: project.studiesIncluded,
      studiesExtracted,
      studiesIncludedMetaAnalysis: 0
    }
  );
}

export function getScreeningRecordTotal(project: ReviewProject, counts: PrismaCounts) {
  return Math.max(0, project.recordsTotal - counts.duplicateRecordsRemoved - counts.automationRemoved - counts.removedOtherReasons);
}

export function getProjectPhaseProgress(
  project: ReviewProject,
  counts: PrismaCounts,
  projectReports: Report[],
  formatValue: (value: number) => string
): ProjectPhaseProgress {
  if (project.stage === "complete") {
    return {
      percent: 100,
      label: `100% complete · ${formatValue(counts.studiesIncluded)} studies included`
    };
  }

  if (project.stage === "extraction") {
    const total = counts.studiesIncluded;
    const value = counts.studiesExtracted;
    const percent = getProgressPercent(value, total);
    return {
      percent,
      label: `${percent}% extracted · ${formatValue(value)} of ${formatValue(total)} studies`
    };
  }

  if (project.stage === "full_text") {
    const total = projectReports.length > 0 ? projectReports.length : counts.reportsSought;
    const value =
      projectReports.length > 0
        ? projectReports.filter((report) => isFullTextReportComplete(report, project)).length
        : counts.reportsAssessed;
    const percent = getProgressPercent(value, total);
    return {
      percent,
      label: `${percent}% full-text completed · ${formatValue(value)} of ${formatValue(total)} reports`
    };
  }

  if (project.stage === "screening") {
    const total = getScreeningRecordTotal(project, counts);
    const value = Math.max(0, Math.min(counts.recordsScreened, total));
    const percent = getProgressPercent(value, total);
    return {
      percent,
      label: `${percent}% screened · ${formatValue(value)} of ${formatValue(total)} records`
    };
  }

  const imported = project.recordsTotal || counts.recordsIdentifiedDatabase + counts.recordsIdentifiedRegisters + counts.recordsIdentifiedOther;
  return {
    percent: imported > 0 ? 100 : 0,
    label: `${formatValue(imported)} records imported`
  };
}

export function getProgressPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

export function getCheckoutRefreshIntervalMs(windowMinutes: number) {
  const ttlMs = Math.max(1, Math.min(120, Math.round(windowMinutes))) * 60_000;
  return Math.max(30_000, Math.min(Math.floor(ttlMs / 2), ttlMs - 5_000));
}

type ReviewQueuePhase = "title_abstract" | "full_text" | "extraction";

function reviewQueueHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function randomizeReviewQueueItems<T extends { id: string }>(
  items: T[],
  options: {
    projectId: string;
    currentUserId: string;
    phase: ReviewQueuePhase;
    isPinned?: (item: T) => boolean;
    isLast?: (item: T) => boolean;
    salt?: string;
  }
) {
  const { projectId, currentUserId, phase, isPinned, isLast, salt = "" } = options;
  const prefix = `${projectId}:${currentUserId}:${phase}:${salt}:`;
  return items.map((item) => ({
    item,
    last: isLast?.(item) ? 1 : 0,
    pinned: isPinned?.(item) ? 1 : 0,
    key: reviewQueueHash(`${prefix}${item.id}`)
  })).sort((left, right) => {
    if (left.last !== right.last) return left.last - right.last;
    if (left.pinned !== right.pinned) return right.pinned - left.pinned;
    if (left.key !== right.key) return left.key - right.key;
    return left.item.id.localeCompare(right.item.id);
  }).map(({ item }) => item);
}

export function getNextReviewQueueItemId<T extends { id: string }>(items: T[], previousItemId: string): string | null {
  return items.find((item) => item.id !== previousItemId)?.id ?? items[0]?.id ?? null;
}

function getOwnDecisionOrder(decisions: Decision[], currentUserId: string, getItemId: (decision: Decision) => string | undefined) {
  const order = new Map<string, number>();
  decisions.forEach((decision, index) => {
    const itemId = getItemId(decision);
    if (itemId && decision.userId === currentUserId) order.set(itemId, index);
  });
  return order;
}

function deferReviewedConflicts<T extends { id: string }>(items: T[], conflictIds: Set<string>, ownDecisionOrder: Map<string, number>) {
  const priority = (item: T) => conflictIds.has(item.id) ? ownDecisionOrder.has(item.id) ? 2 : 1 : 0;
  return items.sort((left, right) => {
    const leftPriority = priority(left);
    const rightPriority = priority(right);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    // Votes are appended in save order. Their locale-formatted timestamps can tie
    // or be unparseable, so append order reliably puts a newly created conflict last.
    if (leftPriority === 2) return ownDecisionOrder.get(left.id)! - ownDecisionOrder.get(right.id)!;
    return 0;
  });
}

export function isFullTextReportComplete(report: Report, project: ReviewProject) {
  if (report.retrievalStatus === "not_retrieved") {
    return true;
  }
  if (report.fullTextStatus === "advance_extraction" || report.fullTextStatus === "excluded_full_text") {
    return true;
  }

  const requiredVotes = report.fullTextRequiredVotes ?? project.fullTextRequiredVotes;
  return Boolean(report.fullTextVoteCount && report.fullTextVoteCount >= requiredVotes && report.fullTextStatus === "manual_review");
}

export function getDedupCandidateProjectId(candidate: DedupCandidate) {
  return candidate.projectId ?? candidate.recordA.projectId ?? candidate.recordB.projectId ?? "demo-review";
}

export function getConfirmedDuplicateStudyIds(candidates: DedupCandidate[]) {
  return new Set(
    candidates
      .filter((candidate) => candidate.status === "confirmed" || candidate.status === "auto_confirmed")
      .map((candidate) => candidate.excludedStudyId ?? candidate.recordB.id)
  );
}

export function getActiveTitleAbstractStudies(project: ReviewProject, studies: Study[], decisions: Decision[], currentUserId: string) {
  const currentDecisions = decisions.filter(
    (decision) => decision.projectId === project.id && decision.stage === "title_abstract" && decision.isCurrent
  );
  const decisionsByItem = groupByKey(
    currentDecisions,
    (decision) => decision.studyId
  );
  const ownDecisionOrder = getOwnDecisionOrder(currentDecisions, currentUserId, (decision) => decision.studyId);
  const conflictIds = new Set<string>();
  const activeStudies = studies.filter((study) => {
    const currentDecisions = decisionsByItem.get(study.id) ?? [];
    const currentUserHasVoted = currentDecisions.some((decision) => decision.userId === currentUserId);
    const voteCount = study.titleAbstractVoteCount ?? currentDecisions.length;
    const requiredVotes = study.titleAbstractRequiredVotes ?? project.abstractRequiredVotes;
    const activeViewerCount = study.titleAbstractActiveViewerCount ?? 0;
    const checkedOutByCurrentUser = Boolean(study.titleAbstractCheckedOutByCurrentUser);
    const evaluationState =
      study.titleAbstractStatus ??
      evaluateStage(
        "title_abstract",
        currentDecisions.map((decision) => decision.decisionValue),
        requiredVotes,
        project.maybePolicy
      ).state;

    if (evaluationState === "conflict" || evaluationState === "needs_third_vote") {
      conflictIds.add(study.id);
      return checkedOutByCurrentUser || activeViewerCount < 1;
    }
    if (currentUserHasVoted || voteCount >= requiredVotes) {
      return false;
    }
    return checkedOutByCurrentUser || activeViewerCount < Math.max(requiredVotes - voteCount, 1);
  });

  return deferReviewedConflicts(randomizeReviewQueueItems(activeStudies, {
    projectId: project.id,
    currentUserId,
    phase: "title_abstract",
    isPinned: (study) => Boolean(study.titleAbstractCheckedOutByCurrentUser),
    isLast: (study) => conflictIds.has(study.id)
  }), conflictIds, ownDecisionOrder);
}

export function getActiveFullTextReports(project: ReviewProject, reports: Report[], decisions: Decision[], currentUserId: string) {
  const currentDecisions = decisions.filter(
    (decision) => decision.projectId === project.id && decision.stage === "full_text" && decision.isCurrent
  );
  const decisionsByItem = groupByKey(
    currentDecisions,
    (decision) => decision.reportId
  );
  const ownDecisionOrder = getOwnDecisionOrder(currentDecisions, currentUserId, (decision) => decision.reportId);
  const conflictIds = new Set<string>();
  const activeReports = reports.filter((report) => {
    if (report.retrievalStatus === "not_retrieved") {
      return false;
    }
    const currentDecisions = decisionsByItem.get(report.id) ?? [];
    const currentUserHasVoted = currentDecisions.some((decision) => decision.userId === currentUserId);
    const voteCount = report.fullTextVoteCount ?? currentDecisions.length;
    const requiredVotes = report.fullTextRequiredVotes ?? project.fullTextRequiredVotes;
    const activeViewerCount = report.fullTextActiveViewerCount ?? 0;
    const checkedOutByCurrentUser = Boolean(report.fullTextCheckedOutByCurrentUser);
    const evaluationState =
      report.fullTextStatus ??
      evaluateStage(
        "full_text",
        currentDecisions.map((decision) => decision.decisionValue),
        requiredVotes,
        project.maybePolicy
      ).state;

    if (evaluationState === "conflict" || evaluationState === "needs_third_vote") {
      conflictIds.add(report.id);
      return checkedOutByCurrentUser || activeViewerCount < 1;
    }
    if (
      currentUserHasVoted ||
      voteCount >= requiredVotes ||
      evaluationState === "advance_extraction" ||
      evaluationState === "excluded_full_text" ||
      evaluationState === "manual_review"
    ) {
      return false;
    }
    return checkedOutByCurrentUser || activeViewerCount < Math.max(requiredVotes - voteCount, 1);
  });

  return deferReviewedConflicts(randomizeReviewQueueItems(activeReports, {
    projectId: project.id,
    currentUserId,
    phase: "full_text",
    isPinned: (report) => Boolean(report.fullTextCheckedOutByCurrentUser),
    isLast: (report) => conflictIds.has(report.id)
  }), conflictIds, ownDecisionOrder);
}

export function getActiveExtractionReports(
  project: ReviewProject,
  reports: Report[],
  extractionResponses: ExtractionResponse[],
  templateId: string,
  currentUserId: string
) {
  const responsesByReport = groupByKey(
    extractionResponses.filter((response) => response.projectId === project.id && response.templateId === templateId && response.isSubmitted),
    (response) => response.reportId
  );
  const activeReports = reports.filter((report) => {
    const submittedResponses = responsesByReport.get(report.id) ?? [];
    const currentUserHasSubmitted = submittedResponses.some((response) => response.userId === currentUserId);
    const metadataMatchesTemplate = report.extractionTemplateId === templateId;
    const submittedCount = metadataMatchesTemplate ? report.extractionVoteCount ?? submittedResponses.length : submittedResponses.length;
    const requiredVotes = report.extractionRequiredVotes ?? project.extractionRequiredVotes;
    const activeViewerCount = metadataMatchesTemplate ? report.extractionActiveViewerCount ?? 0 : 0;
    const checkedOutByCurrentUser = metadataMatchesTemplate ? Boolean(report.extractionCheckedOutByCurrentUser) : false;

    if (currentUserHasSubmitted || submittedCount >= requiredVotes) {
      return false;
    }
    return checkedOutByCurrentUser || activeViewerCount < Math.max(requiredVotes - submittedCount, 1);
  });

  return randomizeReviewQueueItems(activeReports, {
    projectId: project.id,
    currentUserId,
    phase: "extraction",
    isPinned: (report) => Boolean(report.extractionCheckedOutByCurrentUser),
    salt: templateId
  });
}

export function sumObject(values: Record<string, number>) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}
