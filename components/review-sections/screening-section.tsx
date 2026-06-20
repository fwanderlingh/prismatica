import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, FileSearch, History, ListChecks, Lock, Minus, PanelRight, XCircle } from "lucide-react";
import type { Decision, Study } from "@/lib/prismaData";
import { Badge, EmptyState, SectionTitle, renderDoiLink } from "@/components/prisma-review-ui";
import type { DecisionValue } from "@/lib/workflow";
import { ReviewQueueItem } from "@/components/review-sections/review-queue";

type StageEvaluation = {
  state: string;
  label: string;
};

type ScreeningSectionProps = {
  projectScreeningStudies: Study[];
  totalScreeningStudyCount: number;
  screeningProgress: number;
  screenedByMe: number;
  decisions: Decision[];
  selectedProjectId: string;
  currentUserId: string;
  studyIndex: number;
  setStudyIndex: (index: number | ((previous: number) => number)) => void;
  titleAbstractEvaluations: Map<string, StageEvaluation>;
  formatDecision: (value: DecisionValue) => string;
  decisionTone: (value: DecisionValue) => "success" | "warning" | "danger" | "info" | "neutral";
  currentStudy: Study;
  stageEvaluation: StageEvaluation;
  highlightText: (text: string) => React.ReactNode;
  screeningNote: string;
  setScreeningNote: (value: string) => void;
  screeningMessage: string;
  canRecordScreeningDecision: boolean;
  currentUserDecision: Decision | undefined;
  currentStageDecisions: Decision[];
  pendingScreeningDecision: Exclude<DecisionValue, "not_retrieved"> | null;
  isUndoingScreeningDecision: boolean;
  reviewedCount: number;
  onOpenReviewed: () => void;
  formatConflictResolutionHint: (requiredVotes: number) => string;
  selectedProjectAbstractRequiredVotes: number;
  addScreeningDecision: (value: Exclude<DecisionValue, "not_retrieved">) => void;
  undoLastDecision: () => void;
};

export function ScreeningSection({
  projectScreeningStudies,
  totalScreeningStudyCount,
  screeningProgress,
  screenedByMe,
  decisions,
  selectedProjectId,
  currentUserId,
  studyIndex,
  setStudyIndex,
  titleAbstractEvaluations,
  formatDecision,
  decisionTone,
  currentStudy,
  stageEvaluation,
  highlightText,
  screeningNote,
  setScreeningNote,
  screeningMessage,
  canRecordScreeningDecision,
  currentUserDecision,
  currentStageDecisions,
  pendingScreeningDecision,
  isUndoingScreeningDecision,
  reviewedCount,
  onOpenReviewed,
  formatConflictResolutionHint,
  selectedProjectAbstractRequiredVotes,
  addScreeningDecision,
  undoLastDecision
}: ScreeningSectionProps) {
  const isSubmittingDecision = pendingScreeningDecision !== null;
  const activeDecisionValue = currentUserDecision?.decisionValue;
  const isDecisionDisabled = isSubmittingDecision || isUndoingScreeningDecision || !canRecordScreeningDecision;
  const visibleScreeningMessage = screeningMessage;
  const messageIsSuccess = /saved|undone/i.test(visibleScreeningMessage);
  const messageIsError = /already|cannot|denied|duplicate|error|failed|forbidden|invalid|no longer|not found|required|unauthorized/i.test(visibleScreeningMessage);
  const screeningMessageClassName = messageIsSuccess ? "validationItem ok" : messageIsError ? "validationItem blocked" : "validationItem warning";
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!currentStudy.titleAbstractCheckedOutByCurrentUser || !currentStudy.titleAbstractCheckoutExpiresAt) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [currentStudy.titleAbstractCheckedOutByCurrentUser, currentStudy.titleAbstractCheckoutExpiresAt]);

  const screeningCheckoutTimer =
    currentStudy.titleAbstractCheckedOutByCurrentUser && currentStudy.titleAbstractCheckoutExpiresAt
      ? formatCheckoutTimer(currentStudy.titleAbstractCheckoutExpiresAt, now)
      : "Acquiring checkout...";

  if (projectScreeningStudies.length === 0) {
    const hasCompletedScreeningQueue = totalScreeningStudyCount > 0;
    return (
      <div className="viewStack">
        <section className="overviewBand compactBand">
          <div>
            <p className="eyebrow">Title and abstract screening</p>
            <h1>Reviewer Queue</h1>
            <p className="subtle">Screening starts after imports are committed and canonical studies are created.</p>
          </div>
          <button className="ghostButton" type="button" onClick={onOpenReviewed}>
            <History size={16} />
            Reviewed {reviewedCount}
          </button>
        </section>
        <section className="panel">
          <EmptyState
            icon={FileSearch}
            title={hasCompletedScreeningQueue ? "No active citations left" : "No citations ready for screening"}
            description={
              hasCompletedScreeningQueue
                ? "Every title/abstract record has reached the required independent vote count or moved out of the active screening queue."
                : "Import RIS or BibTeX records to populate the title and abstract screening queue."
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="viewStack">
      <section className="overviewBand compactBand">
        <div>
          <p className="eyebrow">Title and abstract screening</p>
          <h1>Reviewer Queue</h1>
          <p className="subtle">Blind mode returns only your decision and aggregate state.</p>
        </div>
        <div className="progressBlock">
          <span>{screeningProgress}% of project queue</span>
          <div className="progressTrack">
            <i style={{ width: `${screeningProgress}%` }} />
          </div>
        </div>
        <button className="ghostButton" type="button" onClick={onOpenReviewed}>
          <History size={16} />
          Reviewed {reviewedCount}
        </button>
      </section>

      <section className="screeningLayout">
        <aside className="panel queuePanel">
          <SectionTitle icon={ListChecks} title="Queue" action={`${projectScreeningStudies.length} active`} />
          <div className="queueList">
            {projectScreeningStudies.map((study, index) => {
              const decision = decisions.find(
                (candidate) =>
                  candidate.projectId === selectedProjectId &&
                  candidate.studyId === study.id &&
                  candidate.userId === currentUserId &&
                  candidate.stage === "title_abstract" &&
                  candidate.isCurrent
              );
              const queueEvaluation = titleAbstractEvaluations.get(study.id);
              const hasQueueConflict = queueEvaluation?.state === "conflict" || queueEvaluation?.state === "needs_third_vote";
              return (
                <ReviewQueueItem
                  active={index === studyIndex}
                  badges={
                    <>
                      {hasQueueConflict ? <Badge label={queueEvaluation?.label ?? "Resolve conflict"} tone="danger" /> : null}
                      {decision ? (
                        <Badge label={formatDecision(decision.decisionValue)} tone={decisionTone(decision.decisionValue)} />
                      ) : (
                        <Badge label="open" tone="neutral" />
                      )}
                    </>
                  }
                  fallbackId={index + 1}
                  key={study.id}
                  onSelect={() => setStudyIndex(index)}
                  study={study}
                  title={study.title}
                />
              );
            })}
          </div>
        </aside>

        <article className="panel citationPanel">
          <div className="citationHeader">
            <div>
              <p className="eyebrow">{currentStudy.source}</p>
              <h2>{currentStudy.title}</h2>
              <p className="subtle">
                {currentStudy.authors.length > 0 ? currentStudy.authors.join(", ") : "No authors parsed"} · {currentStudy.journal} ·{" "}
                {currentStudy.year > 0 ? currentStudy.year : <span className="needsReviewText">Year needs review</span>}
              </p>
            </div>
            <Badge label={stageEvaluation.label} tone={stageEvaluation.state === "conflict" ? "danger" : "info"} />
          </div>
          <div className="metaStrip">
            <span>
              DOI {renderDoiLink(currentStudy.doi, currentStudy.doi || "Missing")}
            </span>
            <span className={currentStudy.keywords.length > 0 ? undefined : "emptyMetaValue"}>
              {currentStudy.keywords.length > 0 ? currentStudy.keywords.join(" · ") : "no keywords"}
            </span>
          </div>
          <p className="abstractText">{highlightText(currentStudy.abstract)}</p>
          <textarea
            value={screeningNote}
            onChange={(event) => setScreeningNote(event.target.value)}
            placeholder="My note"
            aria-label="Screening note"
          />
        </article>

        <aside className="panel actionPanel">
          <SectionTitle icon={PanelRight} title="Decision" action={screeningCheckoutTimer} />
          <div className="decisionState">
            <span>My current vote</span>
            <strong>{currentUserDecision ? formatDecision(currentUserDecision.decisionValue) : "No vote"}</strong>
          </div>
          {visibleScreeningMessage ? (
            <div className={screeningMessageClassName}>
              {messageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{visibleScreeningMessage}</span>
            </div>
          ) : null}
          {stageEvaluation.state === "conflict" || stageEvaluation.state === "needs_third_vote" ? (
            <div className="conflictVotesBox">
              <strong>{stageEvaluation.label}</strong>
              <p>{formatConflictResolutionHint(selectedProjectAbstractRequiredVotes)}</p>
              <div className="voteStrip">
                {currentStageDecisions.map((decision) => (
                  <span className={`votePill ${decisionTone(decision.decisionValue)}`} key={decision.id}>
                    <strong>{decision.userName}</strong>
                    {formatDecision(decision.decisionValue)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="decisionButtons">
            <button
              className={activeDecisionValue === "include" ? "includeButton active" : "includeButton"}
              type="button"
              onClick={() => addScreeningDecision("include")}
              disabled={isDecisionDisabled}
            >
              {pendingScreeningDecision === "include" ? <span className="inlineSpinner" aria-hidden="true" /> : <CheckCircle2 size={18} />}
              {pendingScreeningDecision === "include" ? "Saving..." : "Include"}
            </button>
            <button
              className={activeDecisionValue === "maybe" ? "maybeButton active" : "maybeButton"}
              type="button"
              onClick={() => addScreeningDecision("maybe")}
              disabled={isDecisionDisabled}
            >
              {pendingScreeningDecision === "maybe" ? <span className="inlineSpinner" aria-hidden="true" /> : <Minus size={18} />}
              {pendingScreeningDecision === "maybe" ? "Saving..." : "Maybe"}
            </button>
            <button
              className={activeDecisionValue === "exclude" ? "excludeButton active" : "excludeButton"}
              type="button"
              onClick={() => addScreeningDecision("exclude")}
              disabled={isDecisionDisabled}
            >
              {pendingScreeningDecision === "exclude" ? <span className="inlineSpinner" aria-hidden="true" /> : <XCircle size={18} />}
              {pendingScreeningDecision === "exclude" ? "Saving..." : "Exclude"}
            </button>
          </div>
          <div className="buttonRow bottomMargin">
            <button
              className="ghostButton iconOnly"
              type="button"
              onClick={() => setStudyIndex((index) => Math.max(index - 1, 0))}
              title="Previous citation"
              disabled={isSubmittingDecision || isUndoingScreeningDecision}
            >
              <ArrowLeft size={17} />
            </button>
            <button
              className="ghostButton"
              type="button"
              onClick={undoLastDecision}
              title="Undo latest decision"
              disabled={isSubmittingDecision || isUndoingScreeningDecision}
            >
              {isUndoingScreeningDecision ? <span className="inlineSpinner" aria-hidden="true" /> : <History size={17} />}
              {isUndoingScreeningDecision ? "Undoing..." : "Undo"}
            </button>
            <button
              className="ghostButton iconOnly"
              type="button"
              onClick={() => setStudyIndex((index) => Math.min(index + 1, projectScreeningStudies.length - 1))}
              title="Next citation"
              disabled={isSubmittingDecision || isUndoingScreeningDecision}
            >
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="validationItem muted">
            <Lock size={17} />
            <span>Other reviewer votes are hidden while blind mode is enabled.</span>
          </div>
        </aside>
      </section>
    </div>
  );
}

function formatCheckoutTimer(expiresAt: string, now: number) {
  const remainingMs = Math.max(0, Date.parse(expiresAt) - now);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
