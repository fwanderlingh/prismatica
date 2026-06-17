import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Report, Study } from "@/lib/prismaData";
import { formatArticleQueueId, formatReportQueueOption } from "@/lib/reviewDisplay";

type ArticleIdLabelProps = {
  study?: Pick<Study, "importItemId">;
  fallbackId?: number | string;
};

type ReviewQueueItemProps = ArticleIdLabelProps & {
  active: boolean;
  title: string;
  badges?: ReactNode;
  onSelect: () => void;
};

type ReportPickerProps = {
  id: string;
  eyebrow: string;
  summary: ReactNode;
  detail?: ReactNode;
  activeStudy?: Pick<Study, "importItemId">;
  activeFallbackId?: number | string;
  selectLabel: string;
  selectedReportId: string;
  reports: Report[];
  studies: Study[];
  onSelectReport: (reportId: string) => void;
  action?: ReactNode;
  navigation?: ReactNode;
};

type ReportNavigationProps = {
  currentIndex: number;
  total: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
};

export function ArticleIdLabel({ study, fallbackId }: ArticleIdLabelProps) {
  return <small className="queueArticleId">{formatArticleQueueId(study, fallbackId)}</small>;
}

export function ReviewQueueItem({ active, title, study, fallbackId, badges, onSelect }: ReviewQueueItemProps) {
  return (
    <button className={active ? "queueItem active" : "queueItem"} type="button" onClick={onSelect}>
      <div className="queueItemTop">
        <ArticleIdLabel study={study} fallbackId={fallbackId} />
        {badges ? <span className="queueBadges">{badges}</span> : null}
      </div>
      <span className="queueItemTitle">{title}</span>
    </button>
  );
}

export function ReportPicker({
  id,
  eyebrow,
  summary,
  detail,
  activeStudy,
  activeFallbackId,
  selectLabel,
  selectedReportId,
  reports,
  studies,
  onSelectReport,
  action,
  navigation
}: ReportPickerProps) {
  return (
    <div className="reportPicker">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <strong>{summary}</strong>
        {detail ? <p className="subtle">{detail}</p> : null}
        <ArticleIdLabel study={activeStudy} fallbackId={activeFallbackId} />
      </div>
      {action}
      <label className="fieldLabel" htmlFor={id}>
        {selectLabel}
      </label>
      <select id={id} value={selectedReportId} onChange={(event) => onSelectReport(event.target.value)}>
        {reports.map((report, index) => (
          <option key={report.id} value={report.id}>
            {formatReportQueueOption(report, studies, index + 1)}
          </option>
        ))}
      </select>
      {navigation}
    </div>
  );
}

export function ReportNavigation({
  currentIndex,
  total,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext
}: ReportNavigationProps) {
  const visibleIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
  return (
    <div className="buttonRow" aria-label="Report navigation">
      <button
        className="ghostButton iconOnly"
        type="button"
        title="Previous report"
        disabled={!canGoPrevious}
        onClick={onPrevious}
      >
        <ArrowLeft size={17} />
      </button>
      <span>
        {visibleIndex} of {total}
      </span>
      <button
        className="ghostButton iconOnly"
        type="button"
        title="Next report"
        disabled={!canGoNext}
        onClick={onNext}
      >
        <ArrowRight size={17} />
      </button>
    </div>
  );
}
