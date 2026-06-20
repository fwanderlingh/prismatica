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
import { evaluateStage, type StageEvaluation } from "@/lib/workflow";

export type ProjectPhaseProgress = {
  percent: number;
  label: string;
};

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

export function getCountsForProject(
  project: ReviewProject,
  projectStudies: Study[] = [],
  projectReports: Report[] = [],
  decisions: Decision[] = [],
  extractionResponses: ExtractionResponse[] = [],
  extractionTemplates: ExtractionTemplate[] = [],
  projectDedupCandidates: DedupCandidate[] = []
): PrismaCounts {
  const fullTextCurrentDecisions = decisions.filter(
    (decision) => decision.projectId === project.id && decision.stage === "full_text" && decision.isCurrent
  );
  const fullTextDecisionsByReport = new Map<string, Decision[]>();
  for (const decision of fullTextCurrentDecisions) {
    const reportKey = decision.reportId ?? decision.studyId;
    fullTextDecisionsByReport.set(reportKey, [...(fullTextDecisionsByReport.get(reportKey) ?? []), decision]);
  }
  const fullTextExcluded = Array.from(fullTextDecisionsByReport.values())
    .filter(
      (reportDecisions) =>
        reportDecisions.length >= project.fullTextRequiredVotes &&
        reportDecisions.every((decision) => decision.decisionValue === "exclude")
    )
    .map((reportDecisions) => reportDecisions[0]);
  const reportsExcludedWithReasons = Object.fromEntries(project.exclusionReasons.map((reason) => [reason, 0])) as Record<string, number>;
  for (const decision of fullTextExcluded) {
    const reason = decision.exclusionReasonId;
    if (!reason || !(reason in reportsExcludedWithReasons)) {
      continue;
    }
    reportsExcludedWithReasons[reason] = (reportsExcludedWithReasons[reason] ?? 0) + 1;
  }

  const activeExtractionTemplate = extractionTemplates.find(
    (template) => template.projectId === project.id && template.isActive
  );
  const includedStudyIds = new Set(projectStudies.filter((study) => study.projectId === project.id && study.stage === "extraction").map((study) => study.id));
  const includedReports = projectReports.filter((report) => includedStudyIds.has(report.studyId));
  const studiesExtracted = activeExtractionTemplate
    ? includedReports.filter((report) => {
        const submittedVotes = extractionResponses.filter(
          (response) =>
            response.projectId === project.id &&
            response.reportId === report.id &&
            response.templateId === activeExtractionTemplate.id &&
            response.isSubmitted
        ).length;
        return submittedVotes >= project.extractionRequiredVotes;
      }).length
    : 0;

  return (
    seedProjectCounts[project.id] ?? {
      recordsIdentifiedDatabase: project.recordsTotal,
      recordsIdentifiedRegisters: 0,
      recordsIdentifiedOther: 0,
      duplicateRecordsRemoved: projectDedupCandidates.filter((candidate) => candidate.status === "confirmed" || candidate.status === "auto_confirmed").length,
      automationRemoved: 0,
      removedOtherReasons: 0,
      recordsScreened: project.recordsScreened,
      recordsExcluded: Math.max(project.recordsScreened - projectReports.length, 0),
      reportsSought: projectReports.length,
      reportsNotRetrieved: projectReports.filter((report) => report.retrievalStatus === "not_retrieved").length,
      reportsAssessed: new Set(fullTextCurrentDecisions.map((decision) => decision.reportId ?? decision.studyId)).size,
      reportsExcludedWithReasons,
      studiesIncluded: project.studiesIncluded,
      studiesExtracted,
      studiesIncludedMetaAnalysis: 0
    }
  );
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
      label: `${percent}% full-text reviewed · ${formatValue(value)} of ${formatValue(total)} reports`
    };
  }

  if (project.stage === "screening") {
    const total = project.recordsTotal;
    const value = Math.min(project.recordsScreened, total);
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
    salt?: string;
  }
) {
  const { projectId, currentUserId, phase, isPinned, salt = "" } = options;
  return items.slice().sort((left, right) => {
    const leftPinned = isPinned?.(left) ? 1 : 0;
    const rightPinned = isPinned?.(right) ? 1 : 0;
    if (leftPinned !== rightPinned) {
      return rightPinned - leftPinned;
    }

    const leftKey = reviewQueueHash(`${projectId}:${currentUserId}:${phase}:${salt}:${left.id}`);
    const rightKey = reviewQueueHash(`${projectId}:${currentUserId}:${phase}:${salt}:${right.id}`);
    if (leftKey !== rightKey) {
      return leftKey - rightKey;
    }
    return left.id.localeCompare(right.id);
  });
}

export function isFullTextReportComplete(report: Report, project: ReviewProject) {
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
      .map((candidate) => candidate.recordB.id)
  );
}

export function isTitleAbstractEvaluationComplete(evaluation: StageEvaluation | undefined) {
  return evaluation?.state === "advance_full_text" || evaluation?.state === "excluded_abstract";
}

export function isFullTextEvaluationComplete(evaluation: StageEvaluation | undefined) {
  return evaluation?.state === "advance_extraction" || evaluation?.state === "excluded_full_text";
}

export function getActiveTitleAbstractStudies(project: ReviewProject, studies: Study[], decisions: Decision[], currentUserId: string) {
  const activeStudies = studies.filter((study) => {
    const currentDecisions = decisions.filter(
      (decision) => decision.projectId === project.id && decision.studyId === study.id && decision.stage === "title_abstract" && decision.isCurrent
    );
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
      return checkedOutByCurrentUser || activeViewerCount < 1;
    }
    if (currentUserHasVoted || voteCount >= requiredVotes) {
      return false;
    }
    return checkedOutByCurrentUser || activeViewerCount < Math.max(requiredVotes - voteCount, 1);
  });

  return randomizeReviewQueueItems(activeStudies, {
    projectId: project.id,
    currentUserId,
    phase: "title_abstract",
    isPinned: (study) => Boolean(study.titleAbstractCheckedOutByCurrentUser)
  });
}

export function getActiveFullTextReports(project: ReviewProject, reports: Report[], decisions: Decision[], currentUserId: string) {
  const activeReports = reports.filter((report) => {
    const currentDecisions = decisions.filter(
      (decision) => decision.projectId === project.id && decision.reportId === report.id && decision.stage === "full_text" && decision.isCurrent
    );
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

  return randomizeReviewQueueItems(activeReports, {
    projectId: project.id,
    currentUserId,
    phase: "full_text",
    isPinned: (report) => Boolean(report.fullTextCheckedOutByCurrentUser)
  });
}

export function getActiveExtractionReports(
  project: ReviewProject,
  reports: Report[],
  extractionResponses: ExtractionResponse[],
  templateId: string,
  currentUserId: string
) {
  const activeReports = reports.filter((report) => {
    const submittedResponses = extractionResponses.filter(
      (response) =>
        response.projectId === project.id &&
        response.reportId === report.id &&
        response.templateId === templateId &&
        response.isSubmitted
    );
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
