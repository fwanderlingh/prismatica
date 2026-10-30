import type { ExtractionConsensus, ExtractionResponse, ExtractionTemplate, Report, ReviewProject } from "@/lib/prismaData";
import { groupByKey } from "@/lib/collectionIndexes";

export function getExtractionConflictFieldIds(fields: ExtractionTemplate["fields"], responses: ExtractionResponse[]) {
  const normalizedValue = (value: ExtractionResponse["values"][string] | undefined) => Array.isArray(value)
    ? JSON.stringify([...new Set(value.map((entry) => entry.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right)))
    : (value ?? "").trim();
  return fields.filter((field) => {
    const firstValue = normalizedValue(responses[0]?.values[field.id]);
    return responses.some((response) => normalizedValue(response.values[field.id]) !== firstValue);
  }).map((field) => field.id);
}

export function getExtractionConsensusQueue(
  project: Pick<ReviewProject, "id" | "extractionRequiredVotes">,
  reports: Report[],
  responses: ExtractionResponse[],
  consensus: ExtractionConsensus[],
  templateId: string
) {
  const responsesByReport = groupByKey(responses.filter((response) =>
    response.projectId === project.id && response.templateId === templateId && response.isSubmitted
  ), (response) => response.reportId);
  const recordsByReport = new Map(consensus.filter((record) =>
    record.projectId === project.id && record.templateId === templateId
  ).map((record) => [record.reportId, record]));

  return reports.filter((report) => report.projectId === project.id).map((report, index) => {
    const submittedResponses = responsesByReport.get(report.id) ?? [];
    const record = recordsByReport.get(report.id);
    const latestSubmittedAt = submittedResponses.reduce((latest, response) => {
      const submittedAt = Date.parse(response.submittedAt ?? response.updatedAt ?? "");
      return Number.isFinite(submittedAt) ? Math.max(latest, submittedAt) : latest;
    }, 0);
    const finalizedAt = Date.parse(record?.finalizedAt ?? "");
    const hasRequiredVotes = submittedResponses.length >= project.extractionRequiredVotes;
    const isFinalized = hasRequiredVotes && record?.status === "finalized" &&
      Number.isFinite(finalizedAt) && finalizedAt >= latestSubmittedAt;
    const status: "finalized" | "pending" | "collecting" = isFinalized ? "finalized" : hasRequiredVotes ? "pending" : "collecting";
    return { report, index, submittedResponses, record, status };
  });
}
