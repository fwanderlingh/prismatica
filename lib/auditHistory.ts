import type { DedupCandidate, Report, Study, WorkflowEvent } from "./prismaData";

export const DEFAULT_AUDIT_HISTORY_LIMIT = 100;
export const MAX_AUDIT_HISTORY_LIMIT = 10000;

export function normalizeAuditHistoryLimit(value: unknown) {
  const limit = Number(value);
  return Number.isFinite(limit) && limit >= 1
    ? Math.min(MAX_AUDIT_HISTORY_LIMIT, Math.round(limit))
    : DEFAULT_AUDIT_HISTORY_LIMIT;
}

export function getProjectAuditEvents(
  events: WorkflowEvent[],
  projectId: string,
  studies: Pick<Study, "id">[],
  reports: Pick<Report, "id">[],
  candidates: Pick<DedupCandidate, "id">[]
) {
  const entityIds = new Set([projectId, ...studies.map((study) => study.id), ...reports.map((report) => report.id), ...candidates.map((candidate) => candidate.id)]);
  return events.filter((event) => entityIds.has(event.entity));
}
