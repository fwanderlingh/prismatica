import { BookOpen, Building2, CalendarClock, ChevronRight, ClipboardCheck, FileSearch, FolderPlus, GitMerge, Import as ImportIcon, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppUser, ReviewProject, ViewKey } from "@/lib/prismaData";
import { Badge, EmptyState } from "@/components/prisma-review-ui";

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
    return { view: "fullText", label: "Full Text", Icon: BookOpen };
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
      </section>

      {dashboardMessage ? (
        <section className="panel">
          <div className={dashboardMessage.startsWith("Deleted review") ? "validationItem ok" : "validationItem blocked"}>
            <span>{dashboardMessage}</span>
          </div>
        </section>
      ) : null}

      {userProjects.length > 0 ? (
      <section className="reviewGrid">
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
                <button className="ghostButton iconOnly" type="button" title="Open review project" onClick={() => openProject(project.id)}>
                  <ChevronRight size={18} />
                </button>
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
                <button className="primaryButton" type="button" onClick={() => openProject(project.id, "projectDashboard")}>
                  Open
                </button>
                <button className="ghostButton" type="button" onClick={() => openProject(project.id, phaseAction.view)}>
                  <ActivePhaseIcon size={17} />
                  {phaseAction.label}
                </button>
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
