import type { PrismaCounts, ViewKey } from "@/lib/prismaData";
import type { ExportConsistency } from "@/lib/exportConsistency";

export type ProjectAttentionItem = {
  id: string;
  phase: ViewKey;
  view: ViewKey;
  label: string;
  count: number;
  detail?: string;
};

export function getNavigationAttention(
  items: ProjectAttentionItem[],
  pendingReviewWorkCounts: { screening: number; fullText: number }
) {
  return items.filter((item) => {
    if (item.view === "screeningConflicts") return pendingReviewWorkCounts.screening === 0;
    if (item.view === "fullTextConflicts") return pendingReviewWorkCounts.fullText === 0;
    return true;
  });
}

type ProjectAttentionInput = {
  counts: PrismaCounts;
  consistency: ExportConsistency;
  screeningConflictCount?: number;
  fullTextConflictCount?: number;
  pendingFullTextCount?: number;
  pendingConsensusCount?: number;
  phaseAccess?: Partial<Record<ViewKey, boolean>>;
};

export function getProjectAttention({
  counts, consistency, screeningConflictCount = 0,
  fullTextConflictCount = 0, pendingFullTextCount = 0, pendingConsensusCount = 0, phaseAccess
}: ProjectAttentionInput): ProjectAttentionItem[] {
  const items: ProjectAttentionItem[] = [];
  const add = (item: ProjectAttentionItem) => {
    if (item.count > 0 && phaseAccess?.[item.view] !== false && phaseAccess?.[item.phase] !== false) items.push(item);
  };
  add({ id: "screening", phase: "screening", view: "screeningConflicts", count: screeningConflictCount,
    label: `${screeningConflictCount} screening conflict${screeningConflictCount === 1 ? " needs" : "s need"} resolution.` });
  add({ id: "full-text-conflicts", phase: "fullText", view: "fullTextConflicts", count: fullTextConflictCount,
    label: `${fullTextConflictCount} full-text conflict${fullTextConflictCount === 1 ? " needs" : "s need"} resolution.` });
  const reasonCount = consistency.exclusionReasonIssues.length;
  add({ id: "exclusion-reasons", phase: "fullText", view: "fullText", count: reasonCount,
    label: `${reasonCount} full-text exclusion reason${reasonCount === 1 ? " needs" : "s need"} correction.` });
  add({ id: "consensus", phase: "consensus", view: "consensus", count: pendingConsensusCount,
    label: `${pendingConsensusCount} consensus record${pendingConsensusCount === 1 ? " needs" : "s need"} finalization.` });

  // In-progress votes can leave temporary deficits in the reporting equations.
  // Keep the raw checks on Exports, but don't turn ordinary queue work into alerts.
  const isExpectedDeficit = (difference: number, unfinishedCount: number) =>
    unfinishedCount > 0 && difference >= 0 && difference <= unfinishedCount;
  const screeningInProgress = isExpectedDeficit(counts.recordsScreened - consistency.screenBalanceTotal,
    Math.max(consistency.unresolvedScreeningStudies.length, screeningConflictCount));
  const fullTextWorkCount = pendingFullTextCount + fullTextConflictCount;
  const identificationFailed = consistency.identifiedCheckActive && !consistency.identifiedCheckOk;
  const screeningFailed = consistency.screenedCheckActive && !consistency.screenedCheckOk && !screeningInProgress;
  const retrievalFailed = consistency.retrievalCheckActive && !consistency.retrievalCheckOk &&
    !isExpectedDeficit(counts.reportsSought - consistency.retrievalBalanceTotal, fullTextWorkCount);
  const eligibilityFailed = consistency.assessedCheckActive && !consistency.assessedCheckOk &&
    !isExpectedDeficit(counts.reportsAssessed - consistency.assessedBalanceTotal, fullTextWorkCount);
  const exclusionReasonsFailed = consistency.exclusionReasonCheckActive && !consistency.exclusionReasonCheckOk;
  const failedChecks = [
    [identificationFailed, "identification totals"],
    [screeningFailed, "screening totals"],
    [retrievalFailed, "retrieval totals"],
    [eligibilityFailed, "eligibility totals"],
    [exclusionReasonsFailed, "exclusion reasons"]
  ].filter(([failed]) => failed).map(([, label]) => label);
  if (failedChecks.length > 0) {
    const addPhaseCheck = (phase: ViewKey, needsReview: boolean, label: string) => {
      if (needsReview && !items.some((item) => item.phase === phase &&
        item.view !== "screeningConflicts" && item.view !== "fullTextConflicts")) {
        add({ id: `${phase}-checks`, phase, view: "exports", count: 1, label });
      }
    };
    addPhaseCheck("imports", identificationFailed, "Imported record totals need review.");
    addPhaseCheck("screening", screeningFailed, "Screening totals need review.");
    addPhaseCheck("fullText", retrievalFailed || eligibilityFailed || exclusionReasonsFailed, "Full-text reporting checks need review.");
    const eligibilityDetail = eligibilityFailed
      ? ` ${counts.reportsAssessed} assessed; ${consistency.assessedBalanceTotal} accounted for.` : "";
    add({ id: "exports", phase: "exports", view: "exports", count: failedChecks.length,
      label: `${failedChecks.length} PRISMA consistency check${failedChecks.length === 1 ? " needs" : "s need"} review.`,
      detail: `Check ${failedChecks.join(", ")}.${eligibilityDetail}` });
  }
  return items;
}
