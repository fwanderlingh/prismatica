import { AlertTriangle, Check, ChevronRight, LayoutDashboard, Settings, Trash2 } from "lucide-react";
import type { AppUser, ReviewProject, ViewKey } from "@/lib/prismaData";
import { Badge, SectionTitle } from "@/components/prisma-review-ui";

type AdminReviewsSectionProps = {
  dashboardMessage: string;
  projects: ReviewProject[];
  users: AppUser[];
  formatProjectPhase: (stage: ReviewProject["stage"]) => string;
  projectPhaseBadgeTone: (stage: ReviewProject["stage"]) => "success" | "warning" | "danger" | "info" | "neutral";
  formatEuDate: (value: string) => string;
  openProject: (projectId: string, view?: ViewKey) => void;
  adminDeleteProject: (project: ReviewProject) => void;
};

export function AdminReviewsSection({
  dashboardMessage,
  projects,
  users,
  formatProjectPhase,
  projectPhaseBadgeTone,
  formatEuDate,
  openProject,
  adminDeleteProject
}: AdminReviewsSectionProps) {
  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Review Admin</h1>
          <p className="subtle">Inspect every review workspace, open settings, and remove obsolete or spam projects.</p>
        </div>
      </section>

      {dashboardMessage ? (
        <section className="panel">
          <div className={dashboardMessage.startsWith("Deleted review") ? "validationItem ok" : "validationItem blocked"}>
            {dashboardMessage.startsWith("Deleted review") ? <Check size={17} /> : <AlertTriangle size={17} />}
            <span>{dashboardMessage}</span>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <SectionTitle icon={LayoutDashboard} title="Registered Reviews" action={`${projects.length} total`} />
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Review</th>
                <th>Owners</th>
                <th>Status</th>
                <th>Records</th>
                <th>Updated</th>
                <th>Open</th>
                <th>Settings</th>
                <th>Delete</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const ownerNames = project.ownerIds
                  .map((ownerId) => users.find((user) => user.id === ownerId)?.name)
                  .filter(Boolean)
                  .join(", ");

                return (
                  <tr key={project.id}>
                    <td>
                      <strong>{project.title}</strong>
                      <span>{project.organization}</span>
                    </td>
                    <td>{ownerNames || "Unassigned"}</td>
                    <td>
                      <Badge label={formatProjectPhase(project.stage)} tone={projectPhaseBadgeTone(project.stage)} />
                    </td>
                    <td>{new Intl.NumberFormat("en-US").format(project.recordsTotal)}</td>
                    <td>{formatEuDate(project.updatedAt)}</td>
                    <td>
                      <button className="ghostButton" type="button" onClick={() => openProject(project.id)}>
                        <ChevronRight size={17} />
                        Open
                      </button>
                    </td>
                    <td>
                      <button className="ghostButton" type="button" onClick={() => openProject(project.id, "settings")}>
                        <Settings size={17} />
                        Edit
                      </button>
                    </td>
                    <td>
                      <button className="dangerButton" type="button" onClick={() => adminDeleteProject(project)}>
                        <Trash2 size={17} />
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
