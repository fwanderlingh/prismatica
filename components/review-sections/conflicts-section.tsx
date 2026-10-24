import { AlertTriangle, ArrowLeft, ChevronRight } from "lucide-react";
import { ViewLink } from "@/components/navigation-link";
import { Badge, EmptyState, SectionTitle } from "@/components/prisma-review-ui";
import type { Decision, ProjectWorkflowConflict, ReviewProject } from "@/lib/prismaData";

type WorkflowConflict = ProjectWorkflowConflict & { studyIndex?: number };

type ConflictsSectionProps = {
  selectedProject: ReviewProject;
  currentUserId: string;
  stage: WorkflowConflict["stage"];
  workflowConflicts: WorkflowConflict[];
  openConflict: (conflict: WorkflowConflict) => void;
  canOpenConflict: (conflict: WorkflowConflict) => boolean;
  formatConflictStage: (stage: WorkflowConflict["stage"]) => string;
  decisionTone: (decision: Decision["decisionValue"]) => "success" | "warning" | "danger" | "info" | "neutral";
  formatDecision: (decision: Decision["decisionValue"]) => string;
  onBackToQueue: () => void;
};

export function ConflictsSection({
  selectedProject,
  currentUserId,
  stage,
  workflowConflicts,
  openConflict,
  canOpenConflict,
  formatConflictStage,
  decisionTone,
  formatDecision,
  onBackToQueue
}: ConflictsSectionProps) {
  const isFullText = stage === "full_text";
  const queueView = isFullText ? "fullText" : "screening";
  const phaseLabel = isFullText ? "Full Text" : "Screening";
  const conflicts = workflowConflicts.filter((conflict) => conflict.projectId === selectedProject.id && conflict.stage === stage);
  const ownConflicts: WorkflowConflict[] = [];
  const otherConflicts: WorkflowConflict[] = [];
  for (const conflict of conflicts) {
    const hasOwnVote = conflict.decisions.some((decision) => decision.isCurrent && decision.userId === currentUserId);
    (hasOwnVote ? ownConflicts : otherConflicts).push(conflict);
  }
  const conflictGroups = [
    { title: "Conflict Resolution", items: otherConflicts, hasOwnVote: false },
    { title: "Conflicts you voted on", items: ownConflicts, hasOwnVote: true }
  ];

  return (
    <div className="viewStack">
      <section className="overviewBand compactBand">
        <div>
          <p className="eyebrow">{selectedProject.title}</p>
          <h1>{phaseLabel} Conflicts</h1>
          <p className="subtle">Choose an unresolved conflict to continue its review.</p>
        </div>
        <div className="buttonRow">
          <ViewLink view={queueView} className="ghostButton" onNavigate={onBackToQueue}>
            <ArrowLeft size={17} />
            Back to {phaseLabel}
          </ViewLink>
        </div>
      </section>

      {conflictGroups.filter((group) => !group.hasOwnVote || group.items.length > 0).map((group) => (
        <section className="panel" key={group.title}>
          <SectionTitle icon={AlertTriangle} title={group.title} action={`${group.items.length} open`} />
          {group.items.length > 0 ? (
            <div className="conflictList">
              {group.items.map((conflict) => {
                const visibleDecisions = conflict.decisions.filter((decision) => decision.isCurrent && (!selectedProject.blindMode || decision.userId === currentUserId));
                const canResolve = canOpenConflict(conflict);
                return (
                  <article className={group.hasOwnVote ? "conflictItem ownConflictItem" : "conflictItem"} key={conflict.id}>
                    <div className="conflictMain">
                      <div>
                        <Badge label={formatConflictStage(conflict.stage)} tone={isFullText ? "info" : "warning"} />
                        <h3>{conflict.title}</h3>
                        <p>{conflict.subtitle}</p>
                        {!canResolve ? <p>Currently unavailable in your review queue.</p> : null}
                      </div>
                      <div className="voteStrip" aria-label={`${conflict.title} votes`}>
                        {visibleDecisions.length > 0 ? (
                          visibleDecisions.map((decision) => (
                            <span className={`votePill ${decisionTone(decision.decisionValue)}`} key={decision.id}>
                              <strong>{decision.userName}</strong>
                              {formatDecision(decision.decisionValue)}
                            </span>
                          ))
                        ) : (
                          <span className="votePill neutral">
                            {selectedProject.blindMode ? <><strong>Blind mode</strong>Vote details hidden</> : "No current votes"}
                          </span>
                        )}
                      </div>
                    </div>
                    <ViewLink className="ghostButton" view={queueView} disabled={!canResolve} onNavigate={() => openConflict(conflict)}>
                      <ChevronRight size={17} />
                      Resolve
                    </ViewLink>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title={ownConflicts.length > 0 ? "No other conflicts" : `No ${isFullText ? "full text" : "screening"} conflicts`}
              description={ownConflicts.length > 0
                ? "Conflicts you have already voted on are listed below."
                : `There are no unresolved conflicts in this ${isFullText ? "full text" : "screening"} phase. Return to the queue to continue reviewing.`}
            />
          )}
        </section>
      ))}
    </div>
  );
}
