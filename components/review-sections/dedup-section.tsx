import { Check, GitMerge, X } from "lucide-react";
import type { DedupCandidate, Study } from "@/lib/prismaData";
import { EmptyState, RecordComparison, ScoreBar, SectionTitle, renderDoiLink } from "@/components/prisma-review-ui";

type DedupSectionProps = {
  latestPendingDedup: DedupCandidate | undefined;
  projectImportBatches: { records: number }[];
  projectScreeningStudies: Study[];
  recordsIdentified: number;
  projectDedupCandidates: DedupCandidate[];
  updateDedupCandidate: (candidateId: string, status: DedupCandidate["status"]) => void;
};

export function DedupSection({
  latestPendingDedup,
  projectImportBatches,
  projectScreeningStudies,
  recordsIdentified,
  projectDedupCandidates,
  updateDedupCandidate
}: DedupSectionProps) {
  if (!latestPendingDedup) {
    const hasImportedRecords = projectImportBatches.some((batch) => batch.records > 0) || projectScreeningStudies.length > 0 || recordsIdentified > 0;
    const hasResolvedDedupCandidates = projectDedupCandidates.length > 0;
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Deduplication</p>
            <h1>Candidate Review</h1>
            <p className="subtle">Duplicate candidates will appear after records are imported and candidate generation runs.</p>
          </div>
        </section>
        <section className="panel">
          <EmptyState
            icon={GitMerge}
            title={hasResolvedDedupCandidates ? "Duplicate review complete" : "No duplicate candidates"}
            description={
              hasImportedRecords
                ? hasResolvedDedupCandidates
                  ? "All generated duplicate candidates have been resolved."
                  : "No duplicate candidates were generated for the imported records. Screening can continue with the current citations."
                : "This review is waiting for imported records before deduplication can generate candidate pairs."
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Deduplication</p>
          <h1>Candidate Review</h1>
          <p className="subtle">Duplicate records are attached to canonical studies, never deleted.</p>
        </div>
        <div className="segmented">
          <button className="active" type="button">
            Pending {projectDedupCandidates.filter((candidate) => candidate.status === "pending").length}
          </button>
          <button type="button">Confirmed {projectDedupCandidates.filter((candidate) => candidate.status === "confirmed").length}</button>
          <button type="button">Rejected {projectDedupCandidates.filter((candidate) => candidate.status === "rejected").length}</button>
        </div>
      </section>

      <section className="dedupGrid">
        <div className="panel">
          <SectionTitle icon={GitMerge} title="Match Explanation" action={`${Math.round(latestPendingDedup.score * 100)} percent score`} />
          <div className="scoreRing" aria-label="Duplicate score">
            <strong>{latestPendingDedup.score.toFixed(3)}</strong>
            <span>{latestPendingDedup.method}</span>
          </div>
          <div className="scoreBars">
            <ScoreBar label="Title" value={latestPendingDedup.explanation.title} />
            <ScoreBar label="First author" value={latestPendingDedup.explanation.author} />
            <ScoreBar label="Year" value={latestPendingDedup.explanation.year} />
          </div>
          <p className="doiNote">{renderDoiLink(latestPendingDedup.explanation.doi, latestPendingDedup.explanation.doi)}</p>
          <ul className="plainList">
            {latestPendingDedup.explanation.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <div className="buttonRow">
            <button className="primaryButton" type="button" onClick={() => updateDedupCandidate(latestPendingDedup.id, "confirmed")}>
              <Check size={17} />
              Confirm
            </button>
            <button className="dangerButton" type="button" onClick={() => updateDedupCandidate(latestPendingDedup.id, "rejected")}>
              <X size={17} />
              Reject
            </button>
          </div>
        </div>

        <div className="comparisonGrid">
          <RecordComparison title="Record A" source={latestPendingDedup.recordA.source} study={latestPendingDedup.recordA} />
          <RecordComparison title="Record B" source={latestPendingDedup.recordB.source} study={latestPendingDedup.recordB} />
        </div>
      </section>
    </div>
  );
}
