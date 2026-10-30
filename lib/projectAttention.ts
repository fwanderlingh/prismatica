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

type ProjectAttentionInput = {
  counts: PrismaCounts;
  consistency: ExportConsistency;
  pendingDedupCount?: number;
  screeningConflictCount?: number;
  fullTextConflictCount?: number;
  pendingFullTextCount?: number;
  pendingExtractionCount?: number;
  pendingConsensusCount?: number;
  needsExtractionTemplate?: boolean;
  phaseAccess?: Partial<Record<ViewKey, boolean>>;
};

export function getProjectAttention({
  counts, consistency, pendingDedupCount = 0, screeningConflictCount = 0,
  fullTextConflictCount = 0, pendingFullTextCount = 0, pendingExtractionCount = 0, pendingConsensusCount = 0,
  needsExtractionTemplate = false, phaseAccess
}: ProjectAttentionInput): ProjectAttentionItem[] {
  const items: ProjectAttentionItem[] = [];
  const add = (item: ProjectAttentionItem) => {
    if (item.count > 0 && phaseAccess?.[item.view] !== false && phaseAccess?.[item.phase] !== false) items.push(item);
  };
  add({ id: "dedup", phase: "dedup", view: "dedup", count: pendingDedupCount,
    label: `${pendingDedupCount} duplicate pair${pendingDedupCount === 1 ? " needs" : "s need"} review.` });
  const screeningCount = Math.max(consistency.unresolvedScreeningStudies.length, screeningConflictCount);
  add({ id: "screening", phase: "screening", view: screeningConflictCount === screeningCount ? "screeningConflicts" : "screening", count: screeningCount,
    label: `${screeningCount} screening record${screeningCount === 1 ? " needs" : "s need"} a final decision.`,
    ...(screeningConflictCount > 0 ? { detail: `${screeningConflictCount} conflict${screeningConflictCount === 1 ? " needs" : "s need"} resolution.` } : {}) });
  const retrievalCount = consistency.pendingRetrievalReports.length;
  add({ id: "retrieval", phase: "fullText", view: "fullText", count: retrievalCount,
    label: `${retrievalCount} report${retrievalCount === 1 ? " awaits" : "s await"} retrieval.` });
  add({ id: "full-text-conflicts", phase: "fullText", view: "fullTextConflicts", count: fullTextConflictCount,
    label: `${fullTextConflictCount} full-text conflict${fullTextConflictCount === 1 ? " needs" : "s need"} resolution.` });
  add({ id: "full-text", phase: "fullText", view: "fullText", count: pendingFullTextCount,
    label: `${pendingFullTextCount} report${pendingFullTextCount === 1 ? " needs" : "s need"} full-text review.` });
  const reasonCount = consistency.exclusionReasonIssues.length;
  add({ id: "exclusion-reasons", phase: "fullText", view: "fullText", count: reasonCount,
    label: `${reasonCount} full-text exclusion reason${reasonCount === 1 ? " needs" : "s need"} correction.` });
  if (needsExtractionTemplate && counts.studiesIncluded > 0) {
    add({ id: "extraction-template", phase: "extraction", view: "extraction", count: 1,
      label: "An active extraction template is needed." });
  } else {
    add({ id: "extraction", phase: "extraction", view: "extraction", count: pendingExtractionCount,
      label: `${pendingExtractionCount} included report${pendingExtractionCount === 1 ? " needs" : "s need"} extraction submissions.` });
    add({ id: "consensus", phase: "consensus", view: "consensus", count: pendingConsensusCount,
      label: `${pendingConsensusCount} consensus record${pendingConsensusCount === 1 ? " needs" : "s need"} finalization.` });
  }
  if (consistency.failedCount > 0) {
    const addPhaseCheck = (phase: ViewKey, needsReview: boolean, label: string) => {
      if (needsReview && !items.some((item) => item.phase === phase)) {
        add({ id: `${phase}-checks`, phase, view: "exports", count: 1, label });
      }
    };
    addPhaseCheck("imports", consistency.identifiedCheckActive && !consistency.identifiedCheckOk, "Imported record totals need review.");
    addPhaseCheck("screening", consistency.screenedCheckActive && !consistency.screenedCheckOk, "Screening totals need review.");
    addPhaseCheck("fullText", (consistency.retrievalCheckActive && !consistency.retrievalCheckOk) ||
      (consistency.assessedCheckActive && !consistency.assessedCheckOk) ||
      (consistency.exclusionReasonCheckActive && !consistency.exclusionReasonCheckOk), "Full-text reporting checks need review.");
    const failedChecks = [
      [consistency.identifiedCheckActive && !consistency.identifiedCheckOk, "identification totals"],
      [consistency.screenedCheckActive && !consistency.screenedCheckOk, "screening totals"],
      [consistency.retrievalCheckActive && !consistency.retrievalCheckOk, "retrieval totals"],
      [consistency.assessedCheckActive && !consistency.assessedCheckOk, "eligibility totals"],
      [consistency.exclusionReasonCheckActive && !consistency.exclusionReasonCheckOk, "exclusion reasons"]
    ].filter(([failed]) => failed).map(([, label]) => label).join(", ");
    const eligibilityDetail = consistency.assessedCheckActive && !consistency.assessedCheckOk
      ? ` ${counts.reportsAssessed} assessed; ${consistency.assessedBalanceTotal} accounted for.` : "";
    add({ id: "exports", phase: "exports", view: "exports", count: consistency.failedCount,
      label: `${consistency.failedCount} PRISMA consistency check${consistency.failedCount === 1 ? " needs" : "s need"} review.`,
      detail: `Check ${failedChecks}.${eligibilityDetail}` });
  }
  return items;
}
