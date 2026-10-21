import { AlertTriangle, BarChart3, Check, CircleEllipsis, FileText, X } from "lucide-react";
import type { PrismaCounts } from "@/lib/prismaData";
import type { ExportConsistency } from "@/lib/exportConsistency";
import { PrismaFlow, SectionTitle } from "@/components/prisma-review-ui";
import { ViewLink } from "@/components/navigation-link";

type ExportsSectionProps = {
  recordsIdentified: number;
  activeCounts: PrismaCounts;
  reportsExcludedTotal: number;
  exportConsistency: ExportConsistency;
  exportMessage: string;
  isExportingConsensusCsv: boolean;
  canExportExtractionCsv: boolean;
  exportUnavailableReasons: string[];
  canOpenScreeningStudy: (studyId: string) => boolean;
  canOpenReport: (reportId: string) => boolean;
  onOpenScreeningStudy: (studyId: string) => void;
  onOpenReport: (reportId: string) => void;
  downloadConsensusExtractionCsv: () => void;
  formatNumber: (value: number) => string;
};

export function ExportsSection({
  recordsIdentified,
  activeCounts,
  reportsExcludedTotal,
  exportConsistency,
  exportMessage,
  isExportingConsensusCsv,
  canExportExtractionCsv,
  exportUnavailableReasons,
  canOpenScreeningStudy,
  canOpenReport,
  onOpenScreeningStudy,
  onOpenReport,
  downloadConsensusExtractionCsv,
  formatNumber
}: ExportsSectionProps) {
  const exportMessageIsSuccess = /downloaded|generated|exported/i.test(exportMessage);
  const exportReadinessCopy = canExportExtractionCsv
    ? exportConsistency.failedCount > 0
      ? "Export can be downloaded now, but PRISMA consistency checks still need review before final reporting."
      : "Export is available for the current finalized consensus dataset."
    : `CSV export is unavailable. ${exportUnavailableReasons.join(" ")}`;
  const isZeroDataProject =
    recordsIdentified === 0 &&
    exportConsistency.screenedAndPreScreenRemovedTotal === 0 &&
    activeCounts.recordsScreened === 0 &&
    exportConsistency.screenBalanceTotal === 0 &&
    activeCounts.reportsSought === 0 &&
    exportConsistency.retrievalBalanceTotal === 0 &&
    activeCounts.reportsAssessed === 0 &&
    exportConsistency.assessedBalanceTotal === 0 &&
    exportConsistency.excludedWithoutReasonCount === 0;

  const validations = [
    {
      label: exportConsistency.identifiedCheckOk
        ? "Identified records cover screening and pre-screen removals"
        : "Identified records do not cover screening and pre-screen removals",
      status: isZeroDataProject || !exportConsistency.identifiedCheckActive ? "muted" : exportConsistency.identifiedCheckOk ? "ok" : "warning",
      detail: `Identified: ${formatNumber(recordsIdentified)}. Screened + pre-screen removals: ${formatNumber(exportConsistency.screenedAndPreScreenRemovedTotal)}.`
    },
    {
      label: exportConsistency.screenedCheckOk
        ? "Screening decisions are fully balanced"
        : "Screening decisions are not fully balanced",
      status: isZeroDataProject || !exportConsistency.screenedCheckActive ? "muted" : exportConsistency.screenedCheckOk ? "ok" : "warning",
      detail: `Screened: ${formatNumber(activeCounts.recordsScreened)}. Excluded: ${formatNumber(activeCounts.recordsExcluded)}. Moved to full text: ${formatNumber(exportConsistency.reportsAdvancedToFullText)}. Total: ${formatNumber(exportConsistency.screenBalanceTotal)}.`
    },
    {
      label: exportConsistency.retrievalCheckOk
        ? "Retrieval outcomes are fully balanced"
        : "Retrieval outcomes are not fully balanced",
      status: isZeroDataProject || !exportConsistency.retrievalCheckActive ? "muted" : exportConsistency.retrievalCheckOk ? "ok" : "warning",
      detail: `Reports sought: ${formatNumber(activeCounts.reportsSought)}. Assessed + not retrieved: ${formatNumber(exportConsistency.retrievalBalanceTotal)}.`
    },
    {
      label: exportConsistency.assessedCheckOk
        ? "Eligibility decisions are fully balanced"
        : "Eligibility decisions are not fully balanced",
      status: isZeroDataProject || !exportConsistency.assessedCheckActive ? "muted" : exportConsistency.assessedCheckOk ? "ok" : "warning",
      detail: `Assessed reports: ${formatNumber(activeCounts.reportsAssessed)}. Exclusions with reasons + included studies: ${formatNumber(exportConsistency.assessedBalanceTotal)}.`
    },
    {
      label: exportConsistency.exclusionReasonCheckOk
        ? "Every current full-text exclusion has a reason"
        : "Some current full-text exclusions are missing a reason",
      status:
        isZeroDataProject || !exportConsistency.exclusionReasonCheckActive ? "muted" : exportConsistency.exclusionReasonCheckOk ? "ok" : "warning",
      detail: `Current full-text exclusions missing reason: ${formatNumber(exportConsistency.excludedWithoutReasonCount)}.`
    }
  ];

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Project Exports</p>
          <h1>PRISMA Output Review</h1>
          <p className="subtle">Review flow totals and consistency checks before sharing project outputs.</p>
        </div>
      </section>

      {exportConsistency.failedCount > 0 ? (
        <div className="validationItem warning">
          <AlertTriangle size={17} />
          <span>
            {exportConsistency.failedCount} consistency check{exportConsistency.failedCount === 1 ? " needs" : "s need"} review.
            {" "}Consistency warnings do not block CSV export. CSV availability is explained separately below.
          </span>
        </div>
      ) : null}

      {exportMessage ? (
        <div className={exportMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
          {exportMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{exportMessage}</span>
        </div>
      ) : null}

      <section className="exportLayout">
        <div className="viewStack">
          <div className="panel">
            <SectionTitle icon={FileText} title="Consensus Dataset Export" action={canExportExtractionCsv ? "Ready" : "Blocked"} />
            <p className="subtle bottomMargin">
              Export the finalized consensus dataset used for downstream analysis. The CSV includes one row per included study with consensus-approved fields only.
            </p>
            <div className={canExportExtractionCsv && exportConsistency.failedCount === 0 ? "validationItem ok" : "validationItem muted"}>
              {canExportExtractionCsv && exportConsistency.failedCount === 0 ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{exportReadinessCopy}</span>
            </div>
            <div className="buttonRow exportPrimaryAction">
              <button
                className="primaryButton"
                type="button"
                title={canExportExtractionCsv ? "Download consensus extraction CSV" : "Complete review and finalize consensus data before exporting"}
                onClick={downloadConsensusExtractionCsv}
                disabled={!canExportExtractionCsv || isExportingConsensusCsv}
              >
                {isExportingConsensusCsv ? <span className="inlineSpinner" aria-hidden="true" /> : <FileText size={17} />}
                {isExportingConsensusCsv ? "Exporting..." : "Export Extraction CSV"}
              </button>
            </div>
          </div>

          <div className="panel">
            <SectionTitle icon={BarChart3} title="PRISMA Flow Diagram Preview" action="Auto-calculated" />
            <p className="subtle">This diagram is generated from the current project state and cannot be edited here.</p>
            <PrismaFlow counts={activeCounts} reportsExcludedTotal={reportsExcludedTotal} />
          </div>
        </div>

        <div className="panel">
          <SectionTitle
            icon={CircleEllipsis}
            title="Consistency Checks"
            action={isZeroDataProject || exportConsistency.activeCount === 0 ? "Awaiting data" : `${exportConsistency.passedCount}/${exportConsistency.activeCount} passed`}
          />
          <p className="subtle">These are live integrity checks from current project data, not demo placeholders.</p>
          <div className="validationList">
            {validations.map((validation) => (
              <div
                className={
                  validation.status === "muted"
                    ? "validationItem muted"
                    : validation.status === "ok"
                      ? "validationItem ok"
                      : "validationItem warning"
                }
                key={validation.label}
              >
                {validation.status === "muted" ? <CircleEllipsis size={17} /> : validation.status === "ok" ? <Check size={17} /> : <X size={17} />}
                <div>
                  <span>{validation.label}</span>
                  <small>{validation.detail}</small>
                </div>
              </div>
            ))}
          </div>

          {exportConsistency.unresolvedScreeningStudies.length > 0 ? (
            <div className="exportReviewItems">
              <h3>Screening decisions to finish ({formatNumber(exportConsistency.unresolvedScreeningStudies.length)})</h3>
              <p className="subtle">These records still need a final screening outcome. Open an available record to submit or resolve its votes.</p>
              <ul>
                {exportConsistency.unresolvedScreeningStudies.map((study) => (
                  <li key={study.id}>
                    <strong>{study.title}</strong>
                    <small>{study.titleAbstractStatusLabel || "Awaiting a final screening decision"}</small>
                    <ViewLink
                      className="ghostButton"
                      view="screening"
                      aria-label={`Review screening: ${study.title}`}
                      disabled={!canOpenScreeningStudy(study.id)}
                      onNavigate={() => onOpenScreeningStudy(study.id)}
                    >Review screening</ViewLink>
                    {!canOpenScreeningStudy(study.id) ? <small>Your vote may already be saved, or another reviewer is working on this record. An eligible reviewer needs to continue screening.</small> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {exportConsistency.pendingRetrievalReports.length > 0 ? (
            <div className="exportReviewItems">
              <h3>Retrieval not started ({formatNumber(exportConsistency.pendingRetrievalReports.length)})</h3>
              <p className="subtle">
                These reports have moved to full text and are included in the screening balance.
                Open each report in Full Text and set its retrieval status: Retrieval in progress, Full text available, or Not retrieved after attempts.
              </p>
              <ul>
                {exportConsistency.pendingRetrievalReports.map((report) => (
                  <li key={report.id}>
                    <strong>{report.title}</strong>
                    <ViewLink
                      className="ghostButton"
                      view="fullText"
                      aria-label={`Review retrieval: ${report.title}`}
                      disabled={!canOpenReport(report.id)}
                      onNavigate={() => onOpenReport(report.id)}
                    >Review retrieval</ViewLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
