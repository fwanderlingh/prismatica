import { AlertTriangle } from "lucide-react";
import { ViewLink } from "@/components/navigation-link";
import type { ProjectWorkflowConflict } from "@/lib/prismaData";

export function ResolveConflictButton({ conflicts, currentUserId, view, onResolve }: {
  conflicts: ProjectWorkflowConflict[];
  currentUserId: string;
  view: "screeningConflicts" | "fullTextConflicts";
  onResolve: () => void;
}) {
  if (conflicts.length === 0) return null;
  const onlyOwnConflicts = conflicts.every((conflict) => conflict.decisions.some(
    (decision) => decision.isCurrent && decision.userId === currentUserId
  ));
  return (
    <ViewLink
      className={`ghostButton conflictButton${onlyOwnConflicts ? " ownConflictsButton" : ""}`}
      view={view}
      title={onlyOwnConflicts ? "View conflicts you have voted on" : "View unresolved conflicts"}
      onNavigate={onResolve}
    >
      <AlertTriangle size={17} />
      {onlyOwnConflicts ? "Conflicts" : `Resolve ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`}
    </ViewLink>
  );
}
