import { Building2, CalendarClock, ChevronRight, FileSearch, FolderPlus, User } from "lucide-react";
import type { AppUser, ReviewProject, ViewKey } from "@/lib/prismaData";
import { Badge, EmptyState } from "@/components/prisma-review-ui";

type DashboardSectionProps = {
  currentUser: AppUser;
  userProjects: ReviewProject[];
  users: AppUser[];
  dashboardMessage: string;
  formatProjectPhase: (stage: ReviewProject["stage"]) => string;
  projectPhaseBadgeTone: (stage: ReviewProject["stage"]) => "success" | "warning" | "danger" | "info" | "neutral";
  openProject: (projectId: string, view?: ViewKey) => void;
  formatEuDate: (value: string) => string;
  formatNumber: (value: number) => string;
};

export function DashboardSection({
  currentUser,
  userProjects,
  users,
  dashboardMessage,
  formatProjectPhase,
  projectPhaseBadgeTone,
  openProject,
  formatEuDate,
  formatNumber
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
          const progress = project.recordsTotal > 0 ? Math.round((project.recordsScreened / project.recordsTotal) * 100) : 0;
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
                <span>{progress}% screened · {formatNumber(project.recordsScreened)} of {formatNumber(project.recordsTotal)} records</span>
                <div className="progressTrack">
                  <i style={{ width: `${progress}%` }} />
                </div>
              </div>
              <div className="buttonRow">
                <button className="primaryButton" type="button" onClick={() => openProject(project.id, "projectDashboard")}>
                  Open
                </button>
                <button className="ghostButton" type="button" onClick={() => openProject(project.id, "screening")}>
                  <FileSearch size={17} />
                  Screen
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
