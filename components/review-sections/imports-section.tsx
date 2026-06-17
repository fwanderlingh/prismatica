import { AlertTriangle, BookOpen, Check, ChevronDown, Database, FileArchive, FileSearch, FileText, GitMerge, Lock, Upload } from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import type { ImportBatch } from "@/lib/prismaData";
import { Badge, EmptyState, SectionTitle } from "@/components/prisma-review-ui";

type ImportsSectionProps = {
  projectImportBatches: ImportBatch[];
  selectedReviewBatch: ImportBatch | undefined;
  importMessage: string;
  bibtexInputRef: RefObject<HTMLInputElement | null>;
  risInputRef: RefObject<HTMLInputElement | null>;
  onImportCitationFile: (format: ImportBatch["format"], event: ChangeEvent<HTMLInputElement>) => void;
  onOpenImportEditor: (importId: string) => void;
};

export function ImportsSection({
  projectImportBatches,
  selectedReviewBatch,
  importMessage,
  bibtexInputRef,
  risInputRef,
  onImportCitationFile,
  onOpenImportEditor
}: ImportsSectionProps) {
  const reviewBatches = projectImportBatches.filter((batch) => batch.status === "needs_review" || batch.parserWarnings > 0);
  const okBatches = projectImportBatches.filter((batch) => batch.status !== "needs_review" && batch.parserWarnings === 0);
  const importMessageIsSuccess = /deleted|imported|importing|reviewed|saved|updated/i.test(importMessage);

  function renderBatchTable(batches: ImportBatch[]) {
    return (
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Format</th>
              <th>Records</th>
              <th>PDFs</th>
              <th>Warnings</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr className={batch.id === selectedReviewBatch?.id ? "activeImportRow" : undefined} key={batch.id}>
                <td>
                  <strong>{batch.sourceName}</strong>
                  <span>{batch.filename}</span>
                </td>
                <td>{batch.format.toUpperCase()}</td>
                <td>{batch.records}</td>
                <td>
                  {(batch.pdfLinks ?? 0) > 0 ? `${batch.pdfsRetrieved ?? 0}/${batch.pdfLinks ?? 0}` : "None"}
                </td>
                <td>{batch.parserWarnings}</td>
                <td>
                  {batch.status === "needs_review" ? (
                    <Badge label="needs review" tone="warning" />
                  ) : (
                    <Badge label={batch.status.replace("_", " ")} tone="success" />
                  )}
                </td>
                <td>
                  <button className="ghostButton" type="button" onClick={() => onOpenImportEditor(batch.id)}>
                    <FileSearch size={17} />
                    Review Import
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Import and provenance</p>
          <h1>Record Intake</h1>
          <p className="subtle">RIS and BibTeX batches remain traceable to the original payload.</p>
        </div>
        <div className="toolbarCluster">
          <input
            className="hiddenFileInput"
            ref={bibtexInputRef}
            type="file"
            accept=".bib,.bibtex,text/x-bibtex,text/plain"
            onChange={(event) => onImportCitationFile("bib", event)}
          />
          <input
            className="hiddenFileInput"
            ref={risInputRef}
            type="file"
            accept=".ris,application/x-research-info-systems,text/plain"
            onChange={(event) => onImportCitationFile("ris", event)}
          />
          <button className="ghostButton" type="button" title="Upload an RIS file" onClick={() => risInputRef.current?.click()}>
            <Upload size={17} />
            RIS
          </button>
          <button className="ghostButton" type="button" title="Upload a BibTeX file" onClick={() => bibtexInputRef.current?.click()}>
            <FileArchive size={17} />
            BibTeX
          </button>
        </div>
      </section>
      {importMessage ? (
        <div className={importMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
          {importMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{importMessage}</span>
        </div>
      ) : null}

      <section className="importGrid">
        <div className="panel">
          <SectionTitle icon={Database} title="Import Batches" action="Parser status" />
          {projectImportBatches.length > 0 ? (
            <div className="importBatchGroups">
              {reviewBatches.length > 0 ? (
                <section className="importEntryGroup">
                  <div className="importEntryGroupHeader">
                    <strong>Review Queue</strong>
                    <span>{reviewBatches.length} need review</span>
                  </div>
                  {renderBatchTable(reviewBatches)}
                </section>
              ) : null}
              {okBatches.length > 0 ? (
                <section className="importEntryGroup">
                  <div className="importEntryGroupHeader">
                    <strong>OK Imports</strong>
                    <span>{okBatches.length} ready</span>
                  </div>
                  {renderBatchTable(okBatches)}
                </section>
              ) : null}
            </div>
          ) : (
            <EmptyState icon={Upload} title="No imports yet" description="Upload RIS and BibTeX files to populate records for this review." />
          )}
        </div>

        <div className="panel">
          <SectionTitle icon={FileText} title="Provenance Model" action="Record -> Report -> Study" />
          <div className="provenanceStack">
            <div>
              <Database size={22} />
              <strong>Imported record</strong>
              <span>One citation from Scopus, IEEE, PubMed, etc.</span>
            </div>
            <ChevronDown size={18} />
            <div>
              <GitMerge size={22} />
              <strong>Study candidate</strong>
              <span>Canonical review unit created after deduplication.</span>
            </div>
            <ChevronDown size={18} />
            <div>
              <BookOpen size={22} />
              <strong>Report</strong>
              <span>Full-text article or PDF associated with the study.</span>
            </div>
          </div>
          <div className="secureBox">
            <Lock size={17} />
            <span>
              {projectImportBatches.length > 0
                ? "Parser warnings and parsed screening records are tracked per import batch."
                : "Record provenance will appear here after the first committed import batch."}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
