import { useEffect, useMemo, useState } from "react";
import { Check, GitMerge, RotateCcw, X } from "lucide-react";
import type { DedupCandidate, Study } from "@/lib/prismaData";
import { EmptyState, RecordComparison, ScoreBar, SectionTitle, renderDoiLink } from "@/components/prisma-review-ui";

type DedupStatusFilter = "pending" | "confirmed" | "rejected";

type DedupSectionProps = {
  projectImportBatches: { records: number }[];
  projectScreeningStudies: Study[];
  recordsIdentified: number;
  projectDedupCandidates: DedupCandidate[];
  pendingDedupAction: DedupCandidate["status"] | null;
  isRejectingAllDedupCandidates: boolean;
  updateDedupCandidate: (candidateId: string, status: DedupCandidate["status"]) => void;
  rejectAllPendingDedupCandidates: () => void;
};

export function DedupSection({
  projectImportBatches,
  projectScreeningStudies,
  recordsIdentified,
  projectDedupCandidates,
  pendingDedupAction,
  isRejectingAllDedupCandidates,
  updateDedupCandidate,
  rejectAllPendingDedupCandidates
}: DedupSectionProps) {
  const [activeStatus, setActiveStatus] = useState<DedupStatusFilter>("pending");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const statusCounts = useMemo(
    () => ({
      pending: projectDedupCandidates.filter((candidate) => candidate.status === "pending").length,
      confirmed: projectDedupCandidates.filter((candidate) => isConfirmedDedupStatus(candidate.status)).length,
      rejected: projectDedupCandidates.filter((candidate) => candidate.status === "rejected").length
    }),
    [projectDedupCandidates]
  );
  const visibleCandidates = useMemo(
    () => projectDedupCandidates.filter((candidate) => matchesStatusFilter(candidate, activeStatus)),
    [activeStatus, projectDedupCandidates]
  );

  useEffect(() => {
    if (visibleCandidates.length === 0) {
      setSelectedCandidateId("");
      return;
    }
    if (!visibleCandidates.some((candidate) => candidate.id === selectedCandidateId)) {
      setSelectedCandidateId(visibleCandidates[0].id);
    }
  }, [selectedCandidateId, visibleCandidates]);

  const selectedCandidate = visibleCandidates.find((candidate) => candidate.id === selectedCandidateId) ?? visibleCandidates[0];

  if (projectDedupCandidates.length === 0) {
    const hasImportedRecords = projectImportBatches.some((batch) => batch.records > 0) || projectScreeningStudies.length > 0 || recordsIdentified > 0;
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
            title="No duplicate candidates"
            description={
              hasImportedRecords
                ? "No duplicate candidates were generated for the imported records. Screening can continue with the current citations."
                : "This review is waiting for imported records before deduplication can generate candidate pairs."
            }
          />
        </section>
      </div>
    );
  }

  const matchScorePercent = selectedCandidate ? formatPercent(selectedCandidate.score) : "";
  const activeStatusLabel = dedupStatusFilterLabels[activeStatus];
  const selectedStatusLabel = selectedCandidate ? getCandidateStatusLabel(selectedCandidate.status) : "";

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Deduplication</p>
          <h1>Candidate Review</h1>
          <p className="subtle">Duplicate records are attached to canonical studies, never deleted.</p>
        </div>
        <div className="segmented">
          <button className={activeStatus === "pending" ? "active" : ""} type="button" aria-pressed={activeStatus === "pending"} onClick={() => setActiveStatus("pending")}>
            Pending {statusCounts.pending}
          </button>
          <button className={activeStatus === "confirmed" ? "active" : ""} type="button" aria-pressed={activeStatus === "confirmed"} onClick={() => setActiveStatus("confirmed")}>
            Confirmed {statusCounts.confirmed}
          </button>
          <button className={activeStatus === "rejected" ? "active" : ""} type="button" aria-pressed={activeStatus === "rejected"} onClick={() => setActiveStatus("rejected")}>
            Rejected {statusCounts.rejected}
          </button>
        </div>
      </section>

      <section className="dedupGrid">
        <div className="panel dedupInspectorPanel">
          <SectionTitle icon={GitMerge} title={`${activeStatusLabel} List`} action={`${visibleCandidates.length} shown`} />
          {visibleCandidates.length > 0 ? (
            <div className="dedupCandidateList" aria-label={`${activeStatusLabel} duplicate candidates`}>
              {visibleCandidates.map((candidate) => {
                const isSelected = selectedCandidate?.id === candidate.id;
                return (
                  <button
                    className={`dedupCandidateButton${isSelected ? " active" : ""}`}
                    key={candidate.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedCandidateId(candidate.id)}
                  >
                    <span>
                      <strong>{candidate.recordA.title}</strong>
                      <small>
                        {candidate.recordA.source} vs {candidate.recordB.source}
                      </small>
                    </span>
                    <em>{formatPercent(candidate.score)}</em>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={GitMerge}
              title={`No ${activeStatusLabel.toLowerCase()} candidates`}
              description={`There are no duplicate candidates in the ${activeStatusLabel.toLowerCase()} list.`}
            />
          )}
        </div>

        <div className="dedupDetailColumn">
          {selectedCandidate ? (
            <>
              <section className="panel dedupMatchPanel">
                <SectionTitle icon={GitMerge} title="Match Explanation" action={`${matchScorePercent} score`} />
                <div className="dedupMatchLayout">
                  <div className="scoreRing" aria-label="Duplicate score">
                    <strong>{matchScorePercent}</strong>
                    <span>{selectedCandidate.method}</span>
                  </div>
                  <div className="scoreBars">
                    <ScoreBar label="Title" value={selectedCandidate.explanation.title} />
                    <ScoreBar label="First author" value={selectedCandidate.explanation.author} />
                    <ScoreBar label="Year" value={selectedCandidate.explanation.year} />
                  </div>
                  <div className="dedupMatchNotes">
                    <p className="doiNote">{renderDoiLink(selectedCandidate.explanation.doi, selectedCandidate.explanation.doi)}</p>
                    <ul className="plainList">
                      {selectedCandidate.explanation.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                    {selectedCandidate.status === "pending" ? (
                      <div className="buttonRow">
                        <button className="primaryButton" type="button" disabled={pendingDedupAction !== null} onClick={() => updateDedupCandidate(selectedCandidate.id, "confirmed")}>
                          {pendingDedupAction === "confirmed" ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
                          {pendingDedupAction === "confirmed" ? "Confirming..." : "Confirm"}
                        </button>
                        <button className="dangerButton" type="button" disabled={pendingDedupAction !== null} onClick={() => updateDedupCandidate(selectedCandidate.id, "rejected")}>
                          {pendingDedupAction === "rejected" ? <span className="inlineSpinner" aria-hidden="true" /> : <X size={17} />}
                          {pendingDedupAction === "rejected" ? "Rejecting..." : "Reject"}
                        </button>
                      </div>
                    ) : selectedCandidate.status === "rejected" ? (
                      <div className="buttonRow">
                        <p className="dedupStatusNote">{selectedStatusLabel}</p>
                        <button className="ghostButton" type="button" disabled={pendingDedupAction !== null} onClick={() => updateDedupCandidate(selectedCandidate.id, "pending")}>
                          {pendingDedupAction === "pending" ? <span className="inlineSpinner" aria-hidden="true" /> : <RotateCcw size={17} />}
                          {pendingDedupAction === "pending" ? "Undoing..." : "Undo"}
                        </button>
                      </div>
                    ) : (
                      <p className="dedupStatusNote">{selectedStatusLabel}</p>
                    )}
                  </div>
                </div>
              </section>
              <div className="comparisonGrid">
                <RecordComparison title="Record A" source={selectedCandidate.recordA.source} study={selectedCandidate.recordA} />
                <RecordComparison title="Record B" source={selectedCandidate.recordB.source} study={selectedCandidate.recordB} />
              </div>
            </>
          ) : (
            <section className="panel">
              <EmptyState
                icon={GitMerge}
                title={`No ${activeStatusLabel.toLowerCase()} candidates`}
                description={`Choose another duplicate review status to inspect candidates.`}
              />
            </section>
          )}
        </div>
      </section>

      <section className="panel dedupBulkPanel">
        <SectionTitle icon={X} title="Bulk Decisions" action={`${statusCounts.pending} pending`} />
        <div className="buttonRow">
          <button
            className="dangerButton"
            type="button"
            disabled={statusCounts.pending === 0 || pendingDedupAction !== null || isRejectingAllDedupCandidates}
            onClick={rejectAllPendingDedupCandidates}
          >
            {isRejectingAllDedupCandidates ? <span className="inlineSpinner" aria-hidden="true" /> : <X size={17} />}
            {isRejectingAllDedupCandidates ? "Rejecting all..." : "Reject all pending"}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatPercent(value: number) {
  const percent = Math.max(0, Math.min(100, value * 100));
  if (percent === 100) {
    return "100%";
  }
  if (percent > 99) {
    return `${percent.toFixed(1)}%`;
  }
  return `${Math.round(percent)}%`;
}

function matchesStatusFilter(candidate: DedupCandidate, status: DedupStatusFilter) {
  if (status === "confirmed") {
    return isConfirmedDedupStatus(candidate.status);
  }
  return candidate.status === status;
}

function isConfirmedDedupStatus(status: DedupCandidate["status"]) {
  return status === "confirmed" || status === "auto_confirmed";
}

const dedupStatusFilterLabels: Record<DedupStatusFilter, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  rejected: "Rejected"
};

function getCandidateStatusLabel(status: DedupCandidate["status"]) {
  if (status === "auto_confirmed") {
    return "Auto-confirmed duplicate";
  }
  if (status === "confirmed") {
    return "Confirmed duplicate";
  }
  if (status === "rejected") {
    return "Rejected duplicate";
  }
  return "Pending duplicate review";
}
