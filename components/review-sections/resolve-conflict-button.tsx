import { AlertTriangle } from "lucide-react";
import { ViewLink } from "@/components/navigation-link";

export function ResolveConflictButton({ count, view, onResolve }: {
  count: number;
  view: "screeningConflicts" | "fullTextConflicts";
  onResolve: () => void;
}) {
  if (count === 0) return null;
  return (
    <ViewLink className="ghostButton conflictButton" view={view} title="View unresolved conflicts" onNavigate={onResolve}>
      <AlertTriangle size={17} />
      Resolve {count} conflict{count === 1 ? "" : "s"}
    </ViewLink>
  );
}
