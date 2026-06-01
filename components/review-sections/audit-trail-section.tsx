import { ArrowLeft, ArrowRight, History } from "lucide-react";
import type { Report, ReviewProject, Study, WorkflowEvent } from "@/lib/prismaData";
import { EmptyState, SectionTitle } from "@/components/prisma-review-ui";

type AuditTrailSectionProps = {
  selectedProject: ReviewProject;
  projectEvents: WorkflowEvent[];
  pagedProjectEvents: WorkflowEvent[];
  currentAuditPage: number;
  auditPageCount: number;
  onOpenOverview: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  formatAuditEntityLabel: (event: WorkflowEvent, project: ReviewProject, studies: Study[], reports: Report[]) => string;
  formatAuditTime: (value: string) => string;
  projectScreeningStudies: Study[];
  projectReportQueue: Report[];
};

export function AuditTrailSection({
  selectedProject,
  projectEvents,
  pagedProjectEvents,
  currentAuditPage,
  auditPageCount,
  onOpenOverview,
  onPreviousPage,
  onNextPage,
  formatAuditEntityLabel,
  formatAuditTime,
  projectScreeningStudies,
  projectReportQueue
}: AuditTrailSectionProps) {
  const firstEventIndex = projectEvents.length === 0 ? 0 : (currentAuditPage - 1) * 10 + 1;
  const lastEventIndex = Math.min(currentAuditPage * 10, projectEvents.length);

  return (
    <div className="viewStack">
      <section className="overviewBand compactBand">
        <div>
          <p className="eyebrow">Project audit</p>
          <h1>Full Audit Trail</h1>
          <p className="subtle">
            {selectedProject.title} · {projectEvents.length} append-only action{projectEvents.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="toolbarCluster">
          <button className="ghostButton" type="button" onClick={onOpenOverview}>
            <ArrowLeft size={17} />
            Overview
          </button>
        </div>
      </section>

      <section className="panel">
        <SectionTitle icon={History} title="Audit Events" action={projectEvents.length > 0 ? `${firstEventIndex}-${lastEventIndex} of ${projectEvents.length}` : "No events"} />
        {projectEvents.length > 0 ? (
          <>
            <div className="eventList fullAuditList">
              {pagedProjectEvents.map((event) => (
                <article className="eventItem" key={event.id}>
                  <div>
                    <strong>{event.action}</strong>
                    <span>
                      {event.actor} · {formatAuditEntityLabel(event, selectedProject, projectScreeningStudies, projectReportQueue)}
                    </span>
                  </div>
                  <time>{formatAuditTime(event.time)}</time>
                </article>
              ))}
            </div>
            <div className="paginationBar" aria-label="Audit pagination">
              <button
                className="ghostButton"
                type="button"
                disabled={currentAuditPage === 1}
                onClick={onPreviousPage}
              >
                <ArrowLeft size={17} />
                Previous
              </button>
              <span>
                Page {currentAuditPage} of {auditPageCount}
              </span>
              <button
                className="ghostButton"
                type="button"
                disabled={currentAuditPage === auditPageCount}
                onClick={onNextPage}
              >
                Next
                <ArrowRight size={17} />
              </button>
            </div>
          </>
        ) : (
          <EmptyState
            icon={History}
            title="No audit events yet"
            description="Imports, decisions, adjudications, and exports will appear here as append-only project history."
          />
        )}
      </section>
    </div>
  );
}
