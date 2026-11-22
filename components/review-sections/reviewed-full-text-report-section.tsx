import type { ReactNode } from "react";
import { ArrowLeft, BookOpen, ExternalLink } from "lucide-react";
import { ViewLink } from "@/components/navigation-link";
import { PaperCommentIndicator } from "@/components/paper-comment-indicator";
import { Badge, EmptyState, SectionTitle, StatusRow, renderDoiLink } from "@/components/prisma-review-ui";
import type { Report, ReviewProject, Study } from "@/lib/prismaData";
import { formatReviewDateTime, getReportPdfUrl } from "@/lib/reviewDisplay";
import { renderAbstractText } from "./abstract-text";
import type { ReviewedQueueItem } from "./reviewed-items-section";

type ReviewedFullTextReportSectionProps = {
  project: ReviewProject;
  report?: Report;
  item?: ReviewedQueueItem;
  study?: Study;
  exclusionReason?: string;
  paperComments?: ReactNode;
};

export function ReviewedFullTextReportSection({ project, report, item, study, exclusionReason, paperComments }: ReviewedFullTextReportSectionProps) {
  const backLink = <ViewLink view="fullTextReviewed" className="ghostButton"><ArrowLeft size={17} />Back to Reviewed Reports</ViewLink>;
  if (!report || !item || report.projectId !== project.id || item.id !== report.id ||
    (study && (study.id !== report.studyId || study.projectId !== project.id))) {
    return <div className="viewStack">
      <section className="overviewBand"><h1>Reviewed report</h1>{backLink}</section>
      <section className="panel"><EmptyState icon={BookOpen} title="Reviewed report unavailable" description="This report is no longer in your reviewed list. Return to Reviewed Reports to choose another entry." /></section>
    </div>;
  }
  const pdfUrl = getReportPdfUrl(project.id, report);
  const retrievalLabels = {
    not_sought: "Retrieval not started", sought: "Retrieval in progress",
    retrieved: "Full text available", not_retrieved: "Not retrieved after attempts"
  };
  return <div className="viewStack">
    <section className="overviewBand compactBand">
      <div><p className="eyebrow">Full-text screening · Reviewed report</p><h1>{report.title}<PaperCommentIndicator study={study} /></h1></div>
      {backLink}
    </section>
    <section className="fullTextLayout">
      <aside className="panel fullTextPanel">
        <SectionTitle icon={BookOpen} title="Report details" action="Reviewed" />
        <Badge label={item.statusLabel} tone={item.statusTone} />
        <p className="subtle">{report.citation}</p>
        <div className="metaStrip">{renderDoiLink(study?.doi ?? "", study?.doi || "Missing DOI")}</div>
        <div className="pdfStatusGrid">
          <StatusRow label="Retrieval status" value={retrievalLabels[report.retrievalStatus]} tone="info" />
          <StatusRow label="Full-text status" value={report.fullTextStatusLabel ?? "Not available"} tone="info" />
          {report.fullTextVoteCount !== undefined ? <StatusRow label="Full-text votes" value={`${report.fullTextVoteCount}/${report.fullTextRequiredVotes ?? project.fullTextRequiredVotes}`} tone="info" /> : null}
          {exclusionReason ? <StatusRow label="My exclusion reason" value={exclusionReason} tone="info" /> : null}
          {item.completedAt ? <StatusRow label="My review recorded" value={formatReviewDateTime(item.completedAt)} tone="info" /> : null}
          <StatusRow label="PDF" value={report.fileName ? "Uploaded" : "No PDF uploaded"} tone={report.fileName ? "secure" : "info"} />
        </div>
        {study?.abstract ? <div className="reviewedReportAbstract"><h3>Abstract</h3><p>{renderAbstractText(study.abstract)}</p></div> : null}
      </aside>
      <div className="fullTextPdfColumn">
        {paperComments ? <div className="panel fullTextCommentsPanel">{paperComments}</div> : null}
        <div className="pdfPane">
          <div className="pdfToolbar">
            <strong className="pdfTitle" title={report.fileName || "No PDF uploaded"}>{report.fileName || "No PDF uploaded"}</strong>
            {pdfUrl ? <a className="ghostButton" href={pdfUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />Open PDF</a> : null}
          </div>
          {pdfUrl ? <div className="pdfCanvas pdfCanvasViewer"><iframe className="pdfViewer" src={pdfUrl} title={`${report.title} PDF`} /></div>
            : <div className="pdfCanvas"><EmptyState icon={BookOpen} title="No PDF uploaded" description="You can still read this report's details and shared comments." /></div>}
        </div>
      </div>
    </section>
  </div>;
}
