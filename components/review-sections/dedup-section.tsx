import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, GitMerge, PenLine, RotateCcw, X } from "lucide-react";
import type { DedupCandidate, ImportBatch, Study } from "@/lib/prismaData";
import { EmptyState, RecordComparison, ScoreBar, SectionTitle, renderDoiLink } from "@/components/prisma-review-ui";

type DedupStatusFilter = "pending" | "confirmed" | "rejected";
type DedupStudyEditForm = {
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi: string;
  keywords: string;
  abstract: string;
};

type DedupSectionProps = {
  projectImportBatches: Pick<ImportBatch, "id" | "filename" | "records">[];
  projectScreeningStudies: Study[];
  recordsIdentified: number;
  projectDedupCandidates: DedupCandidate[];
  pendingDedupAction: {
    candidateId: string;
    status: DedupCandidate["status"];
    excludedStudyId?: string;
  } | null;
  dedupMessage: string;
  isRejectingAllDedupCandidates: boolean;
  updateDedupCandidate: (candidateId: string, status: DedupCandidate["status"], excludedStudyId?: string) => void;
  updateDedupStudy: (study: Study, form: DedupStudyEditForm) => Promise<void>;
  rejectAllPendingDedupCandidates: () => void;
};

export function DedupSection({
  projectImportBatches,
  projectScreeningStudies,
  recordsIdentified,
  projectDedupCandidates,
  pendingDedupAction,
  dedupMessage,
  isRejectingAllDedupCandidates,
  updateDedupCandidate,
  updateDedupStudy,
  rejectAllPendingDedupCandidates
}: DedupSectionProps) {
  const [activeStatus, setActiveStatus] = useState<DedupStatusFilter>("pending");
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [pendingShuffleSeed, setPendingShuffleSeed] = useState<number | null>(null);
  const [editingStudyId, setEditingStudyId] = useState("");
  const [savingStudyId, setSavingStudyId] = useState("");
  const [studyEditForm, setStudyEditForm] = useState<DedupStudyEditForm | null>(null);
  const importBatchById = useMemo(
    () => new Map(projectImportBatches.map((batch) => [batch.id, batch])),
    [projectImportBatches]
  );
  useEffect(() => {
    setPendingShuffleSeed(Math.random());
  }, []);
  const statusCounts = useMemo(
    () => ({
      pending: projectDedupCandidates.filter((candidate) => candidate.status === "pending").length,
      confirmed: projectDedupCandidates.filter((candidate) => isConfirmedDedupStatus(candidate.status)).length,
      rejected: projectDedupCandidates.filter((candidate) => candidate.status === "rejected").length
    }),
    [projectDedupCandidates]
  );
  const visibleCandidates = useMemo(
    () => {
      const candidates = projectDedupCandidates.filter((candidate) => matchesStatusFilter(candidate, activeStatus));
      if (activeStatus !== "pending" || pendingShuffleSeed === null) {
        return candidates;
      }
      return candidates.slice().sort((left, right) =>
        compareRandomizedCandidates(left.id, right.id, pendingShuffleSeed)
      );
    },
    [activeStatus, pendingShuffleSeed, projectDedupCandidates]
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
  const selectedStatusLabel = selectedCandidate ? getCandidateStatusLabel(selectedCandidate) : "";
  const selectedCandidateAction = pendingDedupAction?.candidateId === selectedCandidate?.id ? pendingDedupAction : null;
  const dedupMessageIsError = /cannot|denied|error|failed|forbidden|invalid|not found|unknown/i.test(dedupMessage);

  function beginEditingStudy(study: Study) {
    setEditingStudyId(study.id);
    setStudyEditForm({
      title: study.title,
      authors: study.authors.join("; "),
      journal: study.journal,
      year: study.year > 0 ? String(study.year) : "",
      doi: study.doi,
      keywords: study.keywords.join("; "),
      abstract: study.abstract
    });
  }

  async function saveStudyEdit(event: FormEvent<HTMLFormElement>, study: Study) {
    event.preventDefault();
    if (!studyEditForm || savingStudyId) {
      return;
    }

    setSavingStudyId(study.id);
    try {
      await updateDedupStudy(study, studyEditForm);
      setEditingStudyId("");
      setStudyEditForm(null);
    } catch {
      return;
    } finally {
      setSavingStudyId("");
    }
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
          <button className={activeStatus === "pending" ? "active" : ""} type="button" aria-pressed={activeStatus === "pending"} onClick={() => setActiveStatus("pending")}>
            Pending {statusCounts.pending}
          </button>
          <button className={activeStatus === "confirmed" ? "active" : ""} type="button" aria-pressed={activeStatus === "confirmed"} onClick={() => setActiveStatus("confirmed")}>
            Excluded {statusCounts.confirmed}
          </button>
          <button className={activeStatus === "rejected" ? "active" : ""} type="button" aria-pressed={activeStatus === "rejected"} onClick={() => setActiveStatus("rejected")}>
            Included {statusCounts.rejected}
          </button>
        </div>
      </section>

      {dedupMessage ? (
        <div className={dedupMessageIsError ? "validationItem blocked" : "validationItem ok"} role="status" aria-live="polite">
          {dedupMessageIsError ? <X size={17} /> : <Check size={17} />}
          <span>{dedupMessage}</span>
        </div>
      ) : null}

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
                    onClick={() => {
                      setSelectedCandidateId(candidate.id);
                      setEditingStudyId("");
                      setStudyEditForm(null);
                    }}
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
                        <button className="primaryButton" type="button" disabled={pendingDedupAction !== null} onClick={() => updateDedupCandidate(selectedCandidate.id, "rejected")}>
                          {selectedCandidateAction?.status === "rejected" ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
                          {selectedCandidateAction?.status === "rejected" ? "Including..." : "Include both entries"}
                        </button>
                      </div>
                    ) : (
                      <div className="buttonRow">
                        <p className="dedupStatusNote">{selectedStatusLabel}</p>
                        <button className="ghostButton" type="button" disabled={pendingDedupAction !== null} onClick={() => updateDedupCandidate(selectedCandidate.id, "pending")}>
                          {selectedCandidateAction?.status === "pending" ? <span className="inlineSpinner" aria-hidden="true" /> : <RotateCcw size={17} />}
                          {selectedCandidateAction?.status === "pending" ? "Undoing..." : "Undo"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>
              <div className="comparisonGrid">
                {[selectedCandidate.recordA, selectedCandidate.recordB].map((study, index) => {
                  const isExcluded = isConfirmedDedupStatus(selectedCandidate.status) && (selectedCandidate.excludedStudyId ?? selectedCandidate.recordB.id) === study.id;
                  const isExcludingThisEntry = selectedCandidateAction?.status === "confirmed" && selectedCandidateAction.excludedStudyId === study.id;
                  const importBatch = study.importBatchId ? importBatchById.get(study.importBatchId) : undefined;
                  const sourceLabel = importBatch?.filename ??
                    (/\b(?:bibtex|ris) upload\b/i.test(study.source) ? "Imported record" : study.source);
                  const isEditingStudy = editingStudyId === study.id && studyEditForm !== null;
                  const articleId = study.importItemId === undefined ? study.id : String(study.importItemId);
                  return (
                    <div className={`dedupRecordDecision${isExcluded ? " excluded" : ""}`} key={study.id}>
                      {isEditingStudy ? (
                        <form className="panel studyEditForm dedupStudyEditForm" onSubmit={(event) => saveStudyEdit(event, study)}>
                          <span className="articleIdPill">Article ID {articleId}</span>
                          <label className="wideField">
                            <span>Title</span>
                            <input value={studyEditForm.title} onChange={(event) => setStudyEditForm({ ...studyEditForm, title: event.target.value })} />
                          </label>
                          <label className="wideField">
                            <span>Authors</span>
                            <input value={studyEditForm.authors} onChange={(event) => setStudyEditForm({ ...studyEditForm, authors: event.target.value })} />
                          </label>
                          <div className="formGrid">
                            <label>
                              <span>Journal</span>
                              <input value={studyEditForm.journal} onChange={(event) => setStudyEditForm({ ...studyEditForm, journal: event.target.value })} />
                            </label>
                            <label>
                              <span>Year</span>
                              <input inputMode="numeric" value={studyEditForm.year} onChange={(event) => setStudyEditForm({ ...studyEditForm, year: event.target.value })} />
                            </label>
                            <label className="wideField">
                              <span>DOI</span>
                              <input value={studyEditForm.doi} onChange={(event) => setStudyEditForm({ ...studyEditForm, doi: event.target.value })} />
                            </label>
                          </div>
                          <label className="wideField">
                            <span>Keywords</span>
                            <input value={studyEditForm.keywords} onChange={(event) => setStudyEditForm({ ...studyEditForm, keywords: event.target.value })} />
                          </label>
                          <label className="wideField">
                            <span>Abstract</span>
                            <textarea value={studyEditForm.abstract} onChange={(event) => setStudyEditForm({ ...studyEditForm, abstract: event.target.value })} />
                          </label>
                          <div className="buttonRow">
                            <button className="primaryButton" type="submit" disabled={savingStudyId === study.id}>
                              {savingStudyId === study.id ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
                              {savingStudyId === study.id ? "Saving..." : "Save entry"}
                            </button>
                            <button className="ghostButton" type="button" disabled={savingStudyId === study.id} onClick={() => { setEditingStudyId(""); setStudyEditForm(null); }}>
                              <X size={17} />
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <RecordComparison title={`Entry ${index + 1}`} source={sourceLabel} articleId={articleId} study={study} />
                      )}
                      {!isEditingStudy ? (
                        <div className="buttonRow dedupRecordActions">
                          {study.importBatchId ? (
                            <button className="ghostButton" type="button" disabled={pendingDedupAction !== null} onClick={() => beginEditingStudy(study)}>
                              <PenLine size={17} />
                              Edit entry
                            </button>
                          ) : null}
                          {selectedCandidate.status === "pending" ? (
                            <button
                              className="dangerButton dedupRecordAction"
                              type="button"
                              disabled={pendingDedupAction !== null}
                              onClick={() => updateDedupCandidate(selectedCandidate.id, "confirmed", study.id)}
                            >
                              {isExcludingThisEntry ? <span className="inlineSpinner" aria-hidden="true" /> : <X size={17} />}
                              {isExcludingThisEntry ? "Excluding..." : "Exclude this entry"}
                            </button>
                          ) : (
                            <span className={`dedupRecordStatus${isExcluded ? " excluded" : " included"}`}>
                              {isExcluded ? "Excluded as duplicate" : "Included"}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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
        <SectionTitle icon={Check} title="Bulk Inclusion" action={`${statusCounts.pending} pending`} />
        <div className="buttonRow">
          <button
            className="primaryButton"
            type="button"
            disabled={statusCounts.pending === 0 || pendingDedupAction !== null || isRejectingAllDedupCandidates}
            onClick={rejectAllPendingDedupCandidates}
          >
            {isRejectingAllDedupCandidates ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
            {isRejectingAllDedupCandidates ? "Including all..." : "Include both for all pending"}
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

function compareRandomizedCandidates(leftId: string, rightId: string, seed: number) {
  return randomizedCandidateKey(leftId, seed) - randomizedCandidateKey(rightId, seed);
}

function randomizedCandidateKey(candidateId: string, seed: number) {
  let hash = Math.floor(seed * 0xffffffff) >>> 0;
  for (let index = 0; index < candidateId.length; index += 1) {
    hash = Math.imul(hash ^ candidateId.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}

function isConfirmedDedupStatus(status: DedupCandidate["status"]) {
  return status === "confirmed" || status === "auto_confirmed";
}

const dedupStatusFilterLabels: Record<DedupStatusFilter, string> = {
  pending: "Pending",
  confirmed: "Excluded",
  rejected: "Included"
};

function getCandidateStatusLabel(candidate: DedupCandidate) {
  if (candidate.status === "auto_confirmed") {
    return "One entry was automatically excluded as a duplicate.";
  }
  if (candidate.status === "confirmed") {
    return "One entry is excluded as a duplicate.";
  }
  if (candidate.status === "rejected") {
    return "Both entries are included.";
  }
  return "Pending duplicate review";
}
