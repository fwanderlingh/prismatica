import { AlertTriangle, Check, FileSearch } from "lucide-react";
import type { ExclusionReasonIssue } from "@/lib/exportConsistency";
import { SectionTitle } from "@/components/prisma-review-ui";

type ExclusionReasonCorrectionsProps = {
  issues: ExclusionReasonIssue[];
  exclusionReasons: string[];
  canCorrect: boolean;
  pendingReportId?: string;
  message?: string;
  onCorrect: (reportId: string, exclusionReasonId: string) => void;
};

export function ExclusionReasonCorrections({
  issues,
  exclusionReasons,
  canCorrect,
  pendingReportId = "",
  message = "",
  onCorrect
}: ExclusionReasonCorrectionsProps) {
  if (issues.length === 0 && !message) return null;
  const messageIsSuccess = /^(Exclusion reason corrected\.|This report already has valid exclusion reasons\.)/i.test(message);

  return (
    <section className="panel">
      <SectionTitle icon={FileSearch} title="Exclusion reasons to correct" action={`${issues.length} reports`} />
      {message ? (
        <div className={messageIsSuccess ? "validationItem ok" : "validationItem blocked"} role="status">
          {messageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{message}</span>
        </div>
      ) : null}
      {issues.length > 0 ? (
        <>
          <p className="subtle">These completed exclusions have a missing reason or a label that is no longer in the project options. Choose a current reason to replace those labels and correct the reporting counts. Valid reviewer reasons are preserved.</p>
          {!canCorrect ? <p className="subtle">A project owner or administrator can correct these reasons here.</p> : null}
          {canCorrect && exclusionReasons.length === 0 ? <p className="subtle">Add exclusion reasons in Project Settings before correcting these reports.</p> : null}
          <div className="exportReviewItems">
            <ul>
              {issues.map((issue) => {
                const selectId = `exclusion-reason-${issue.reportId}`;
                const isPending = pendingReportId === issue.reportId;
                return (
                  <li key={issue.reportId}>
                    <strong>{issue.importItemId !== undefined ? `# ${issue.importItemId} · ` : ""}{issue.title}</strong>
                    <small>Recorded reason{issue.invalidReasons.length === 1 ? "" : "s"}: {issue.invalidReasons.map((reason) => reason ? `“${reason}”` : "Missing or outdated").join("; ")}</small>
                    {canCorrect ? (
                      <form
                        className="extractionForm"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (pendingReportId) return;
                          const select = event.currentTarget.elements.namedItem("exclusionReasonId") as HTMLSelectElement | null;
                          if (select && exclusionReasons.includes(select.value)) onCorrect(issue.reportId, select.value);
                        }}
                      >
                        <label className="fieldLabel" htmlFor={selectId}>Current project reason</label>
                        <select
                          id={selectId}
                          name="exclusionReasonId"
                          defaultValue={issue.suggestedReason ?? ""}
                          disabled={Boolean(pendingReportId) || exclusionReasons.length === 0}
                          required
                        >
                          <option value="">Choose an exclusion reason</option>
                          {exclusionReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                        </select>
                        <div className="buttonRow">
                          <button className="ghostButton" type="submit" disabled={Boolean(pendingReportId) || exclusionReasons.length === 0}>
                            {isPending ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
                            {isPending ? "Saving..." : "Save reason"}
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}
    </section>
  );
}
