import type { Report, Study } from "@/lib/prismaData";

type ArticleDisplaySource = Pick<Study, "importItemId"> | undefined;

export function getArticleDisplayId(study?: ArticleDisplaySource, fallbackId?: number | string) {
  const value = study?.importItemId ?? fallbackId;
  return value === undefined || value === null || value === "" ? "unassigned" : String(value);
}

export function formatArticleQueueId(study?: ArticleDisplaySource, fallbackId?: number | string) {
  return `# ${getArticleDisplayId(study, fallbackId)}`;
}

export function getStudyForReport(studies: Study[], report: Pick<Report, "studyId">) {
  return studies.find((study) => study.id === report.studyId);
}

export function formatReportQueueOption(report: Pick<Report, "studyId" | "title">, studies: Study[], fallbackId?: number | string) {
  return `${formatArticleQueueId(getStudyForReport(studies, report), fallbackId)} · ${report.title}`;
}
