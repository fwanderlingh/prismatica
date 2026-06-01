import { AlertTriangle, BarChart3, Check, CheckCircle2, FileText, X } from "lucide-react";
import type { PrismaCounts } from "@/lib/prismaData";
import { PrismaFlow, SectionTitle } from "@/components/prisma-review-ui";

type ExportConsistency = {
  identifiedCheckOk: boolean;
  screenedCheckOk: boolean;
  retrievalCheckOk: boolean;
  assessedCheckOk: boolean;
  exclusionReasonCheckOk: boolean;
  screenedAndPreScreenRemovedTotal: number;
  screenBalanceTotal: number;
  retrievalBalanceTotal: number;
  assessedBalanceTotal: number;
  excludedWithoutReasonCount: number;
  failedCount: number;
  passedCount: number;
  totalCount: number;
};

type ExportsSectionProps = {
  recordsIdentified: number;
  activeCounts: PrismaCounts;
  reportsExcludedTotal: number;
  exportConsistency: ExportConsistency;
  exportMessage: string;
  canExportExtractionCsv: boolean;
  downloadConsensusExtractionCsv: () => void;
  formatNumber: (value: number) => string;
};

export function ExportsSection({
  recordsIdentified,
  activeCounts,
  reportsExcludedTotal,
  exportConsistency,
  exportMessage,
  canExportExtractionCsv,
  downloadConsensusExtractionCsv,
  formatNumber
}: ExportsSectionProps) {
  const exportMessageIsSuccess = /downloaded|generated|exported/i.test(exportMessage);
  const validations = [
    {
      label: exportConsistency.identifiedCheckOk
        ? "Identified records cover screening and pre-screen removals"
        : "Identified records do not cover screening and pre-screen removals",
      ok: exportConsistency.identifiedCheckOk,
      detail: `Identified: ${formatNumber(recordsIdentified)}. Screened + pre-screen removals: ${formatNumber(exportConsistency.screenedAndPreScreenRemovedTotal)}.`
    },
    {
      label: exportConsistency.screenedCheckOk
        ? "Screening decisions are fully balanced"
        : "Screening decisions are not fully balanced",
      ok: exportConsistency.screenedCheckOk,
      detail: `Screened: ${formatNumber(activeCounts.recordsScreened)}. Excluded + moved to full text: ${formatNumber(exportConsistency.screenBalanceTotal)}.`
    },
    {
      label: exportConsistency.retrievalCheckOk
        ? "Retrieval outcomes are fully balanced"
        : "Retrieval outcomes are not fully balanced",
      ok: exportConsistency.retrievalCheckOk,
      detail: `Reports sought: ${formatNumber(activeCounts.reportsSought)}. Assessed + not retrieved: ${formatNumber(exportConsistency.retrievalBalanceTotal)}.`
    },
    {
      label: exportConsistency.assessedCheckOk
        ? "Eligibility decisions are fully balanced"
        : "Eligibility decisions are not fully balanced",
      ok: exportConsistency.assessedCheckOk,
      detail: `Assessed reports: ${formatNumber(activeCounts.reportsAssessed)}. Exclusions with reasons + included studies: ${formatNumber(exportConsistency.assessedBalanceTotal)}.`
    },
    {
      label: exportConsistency.exclusionReasonCheckOk
        ? "Every current full-text exclusion has a reason"
        : "Some current full-text exclusions are missing a reason",
      ok: exportConsistency.exclusionReasonCheckOk,
      detail: `Current full-text exclusions missing reason: ${formatNumber(exportConsistency.excludedWithoutReasonCount)}.`
    }
  ];

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Exports</p>
          <h1>PRISMA Output Review</h1>
          <p className="subtle">Review flow totals and consistency checks before sharing project outputs.</p>
        </div>
      </section>

      {exportConsistency.failedCount > 0 ? (
        <div className="validationItem warning">
          <AlertTriangle size={17} />
          <span>
            {exportConsistency.failedCount} consistency check{exportConsistency.failedCount === 1 ? "" : "s"} need review. Export is allowed, but verify these issues before final reporting.
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
            <p className="subtle">
              Export the finalized consensus dataset used for downstream analysis. The CSV includes one row per included study with consensus-approved fields only.
            </p>
            <div className="buttonRow exportPrimaryAction">
              <button
                className="primaryButton"
                type="button"
                title="Download consensus extraction CSV"
                onClick={downloadConsensusExtractionCsv}
                disabled={!canExportExtractionCsv}
              >
                <FileText size={17} />
                Export Extraction CSV
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
          <SectionTitle icon={CheckCircle2} title="Consistency Checks" action={`${exportConsistency.passedCount}/${exportConsistency.totalCount} passed`} />
          <p className="subtle">These are live integrity checks from current project data, not demo placeholders.</p>
          <div className="validationList">
            {validations.map((validation) => (
              <div className={validation.ok ? "validationItem ok" : "validationItem warning"} key={validation.label}>
                {validation.ok ? <Check size={17} /> : <X size={17} />}
                <div>
                  <span>{validation.label}</span>
                  <small>{validation.detail}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
