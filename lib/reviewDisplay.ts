import type { Report, Study } from "@/lib/prismaData";

type ArticleDisplaySource = Pick<Study, "importItemId"> | undefined;

export function formatAuthorList(authors: string[]) {
  return authors
    .map((author) => {
      const name = author.trim();
      const commaIndex = name.indexOf(",");
      if (commaIndex < 0 || name.indexOf(",", commaIndex + 1) >= 0) {
        return name;
      }

      const surname = name.slice(0, commaIndex).trim();
      const givenName = name.slice(commaIndex + 1).trim();
      return surname && givenName ? `${givenName} ${surname}` : name;
    })
    .filter(Boolean)
    .join(", ");
}

export function formatReviewDateTime(value: string) {
  const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  const date = dayFirst && Number(dayFirst[1]) > 12
    ? new Date(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]), Number(dayFirst[4]), Number(dayFirst[5]), Number(dayFirst[6]))
    : new Date(value.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  if (Number.isNaN(date.getTime())) return value;

  const pad = (part: number) => String(part).padStart(2, "0");
  const day = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${day} ${time}`;
}

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
