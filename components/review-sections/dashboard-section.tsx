import { useEffect, useState } from "react";
import { ViewLink } from "@/components/navigation-link";
import { BookOpen, Building2, CalendarClock, ChevronRight, ClipboardCheck, FileSearch, FolderPlus, GitMerge, Import as ImportIcon, LayoutGrid, List, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppUser, ReviewProject, ViewKey } from "@/lib/prismaData";
import { Badge, EmptyState } from "@/components/prisma-review-ui";

const REVIEW_LAYOUT_COOKIE = "prismatica_review_layout";

type DashboardSectionProps = {
  currentUser: AppUser;
  userProjects: ReviewProject[];
  users: AppUser[];
  dashboardMessage: string;
  getProjectPhaseProgress: (project: ReviewProject) => ProjectPhaseProgress;
  formatProjectPhase: (stage: ReviewProject["stage"]) => string;
  projectPhaseBadgeTone: (stage: ReviewProject["stage"]) => "success" | "warning" | "danger" | "info" | "neutral";
  openProject: (projectId: string, view?: ViewKey) => void;
  formatEuDate: (value: string) => string;
};

type ProjectPhaseProgress = {
  percent: number;
  label: string;
};

type ProjectActivePhaseAction = {
  view: ViewKey;
  label: string;
  Icon: LucideIcon;
};

function getProjectActivePhaseAction(stage: ReviewProject["stage"]): ProjectActivePhaseAction {
  if (stage === "setup" || stage === "import") {
    return { view: "imports", label: "Import", Icon: ImportIcon };
  }
  if (stage === "full_text") {
    return { view: "fullText", label: "Full text", Icon: BookOpen };
  }
  if (stage === "extraction") {
    return { view: "extraction", label: "Extract", Icon: ClipboardCheck };
  }
  if (stage === "complete") {
    return { view: "consensus", label: "Consensus", Icon: GitMerge };
  }
  return { view: "screening", label: "Screen", Icon: FileSearch };
}

export function DashboardSection({
  currentUser,
  userProjects,
  users,
  dashboardMessage,
  getProjectPhaseProgress,
  formatProjectPhase,
  projectPhaseBadgeTone,
  openProject,
  formatEuDate
}: DashboardSectionProps) {
  const [isRowView, setIsRowView] = useState(() => {
    if (typeof document === "undefined") return true;
    try {
      const layoutCookie = document.cookie.split(";")
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(`${REVIEW_LAYOUT_COOKIE}=`));
      return layoutCookie !== `${REVIEW_LAYOUT_COOKIE}=grid`;
    } catch {
      return true;
    }
  });
  const layoutActionLabel = isRowView ? "Switch to grid view" : "Switch to row view";

  useEffect(() => {
    try {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${REVIEW_LAYOUT_COOKIE}=${isRowView ? "rows" : "grid"}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    } catch {
      // Keep layout switching available when cookies are blocked.
    }
  }, [isRowView]);

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Review dashboard</p>
          <h1>Review Projects</h1>
          <p className="subtle">
            {currentUser.name} · {currentUser.organization} · {userProjects.length} accessible reviews{currentUser.isAdmin ? " · admin view" : ""}
          </p>
        </div>
        {userProjects.length > 0 ? (
          <button
            className="ghostButton iconOnly reviewLayoutToggle"
            type="button"
            aria-label={layoutActionLabel}
            aria-controls="review-projects"
            title={layoutActionLabel}
            onClick={() => setIsRowView((previous) => !previous)}
          >
            {isRowView ? <LayoutGrid size={18} aria-hidden="true" /> : <List size={18} aria-hidden="true" />}
          </button>
        ) : null}
      </section>

      {dashboardMessage ? (
        <section className="panel">
          <div className={dashboardMessage.startsWith("Deleted review") ? "validationItem ok" : "validationItem blocked"}>
            <span>{dashboardMessage}</span>
          </div>
        </section>
      ) : null}

      {userProjects.length > 0 ? (
      <section id="review-projects" className={`reviewGrid${isRowView ? " reviewRows" : ""}`}>
        {userProjects.map((project) => {
          const ownerNames = project.ownerIds
            .map((ownerId) => users.find((user) => user.id === ownerId)?.name)
            .filter((name): name is string => Boolean(name));
          const progress = getProjectPhaseProgress(project);
          const phaseAction = getProjectActivePhaseAction(project.stage);
          const ActivePhaseIcon = phaseAction.Icon;
          return (
            <article className="panel projectCard" key={project.id}>
              <div className="projectCardHeader">
                <div>
                  <Badge label={formatProjectPhase(project.stage)} tone={projectPhaseBadgeTone(project.stage)} />
                  <h2>{project.title}</h2>
                  <p>{project.description}</p>
                </div>
                <ViewLink view="projectDashboard" projectId={project.id} className="ghostButton iconOnly" aria-label={`Open ${project.title}`} title="Open review project" onNavigate={() => openProject(project.id)}>
                  <ChevronRight size={18} />
                </ViewLink>
              </div>
              <div className="projectMeta">
                <span>
                  <Building2 size={15} />
                  {project.organization}
                </span>
                <span>
                  <User size={15} />
                  {ownerNames.length > 0 ? ownerNames.join(", ") : "Unassigned owner"}
                </span>
                {project.dueDate ? (
                  <span>
                    <CalendarClock size={15} />
                    Due {formatEuDate(project.dueDate)}
                  </span>
                ) : null}
              </div>
              <div className="progressBlock">
                <span>{progress.label}</span>
                <div className="progressTrack">
                  <i style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
              <div className="buttonRow">
                <ViewLink view="projectDashboard" projectId={project.id} className="primaryButton" onNavigate={() => openProject(project.id, "projectDashboard")}>
                  Open
                </ViewLink>
                <ViewLink view={phaseAction.view} projectId={project.id} className="ghostButton" onNavigate={() => openProject(project.id, phaseAction.view)}>
                  <ActivePhaseIcon size={17} />
                  {phaseAction.label}
                </ViewLink>
              </div>
            </article>
          );
        })}
      </section>
      ) : (
      <section className="panel">
        <EmptyState
          icon={FolderPlus}
          title="No review projects yet"
          description="Create your first review project to start importing citations and assigning reviewers."
        />
      </section>
      )}
    </div>
  );
}
