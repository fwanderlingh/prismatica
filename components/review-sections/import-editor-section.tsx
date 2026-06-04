import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Database, FileSearch, FileText, PenLine, Trash2, X } from "lucide-react";
import type { ImportBatch, Study } from "@/lib/prismaData";
import { EmptyState, SectionTitle } from "@/components/prisma-review-ui";

type FormSubmitEvent = {
  preventDefault: () => void;
};

type StudyEditForm = {
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi: string;
  keywords: string;
  abstract: string;
};

type ImportDetailForm = {
  sourceName: string;
  filename: string;
};

type ImportEditorSectionProps = {
  batch: ImportBatch;
  batchStudies: Study[];
  warningMessages: string[];
  importDetailMessage: string;
  importDetailForm: ImportDetailForm;
  studyEditId: string;
  studyEditForm: StudyEditForm;
  closeImportEditor: () => void;
  deleteImportBatch: (importId: string) => void;
  openScreening: () => void;
  isSavingImportDetails: boolean;
  isSavingStudyEdit: boolean;
  updateImportDetails: (event: FormSubmitEvent) => void;
  onImportSourceNameChange: (value: string) => void;
  onImportFilenameChange: (value: string) => void;
  reviewImportWarnings: (importId: string) => void;
  updateImportStudy: (event: FormSubmitEvent) => void;
  onStudyEditFormChange: (updates: Partial<StudyEditForm>) => void;
  cancelStudyEdit: () => void;
  editImportStudy: (study: Study) => void;
  deleteImportStudy: (study: Study) => void;
};

export function ImportEditorSection({
  batch,
  batchStudies,
  warningMessages,
  importDetailMessage,
  importDetailForm,
  studyEditId,
  studyEditForm,
  isSavingImportDetails,
  isSavingStudyEdit,
  closeImportEditor,
  deleteImportBatch,
  openScreening,
  updateImportDetails,
  onImportSourceNameChange,
  onImportFilenameChange,
  reviewImportWarnings,
  updateImportStudy,
  onStudyEditFormChange,
  cancelStudyEdit,
  editImportStudy,
  deleteImportStudy
}: ImportEditorSectionProps) {
  const messageIsSuccess = /imported|updated|deleted|reviewed/i.test(importDetailMessage);

  return (
    <div className="viewStack">
      <section className="overviewBand compactBand">
        <div>
          <p className="eyebrow">Import review</p>
          <h1>{batch.filename}</h1>
          <p className="subtle">
            {batch.format.toUpperCase()} · {batch.records} records · uploaded by {batch.uploadedBy} on {batch.uploadedAt}
          </p>
        </div>
        <div className="toolbarCluster">
          <button className="ghostButton" type="button" onClick={closeImportEditor}>
            <ArrowLeft size={17} />
            Imports
          </button>
          <button className="dangerButton" type="button" onClick={() => deleteImportBatch(batch.id)}>
            <Trash2 size={17} />
            Delete Batch
          </button>
          <button className="primaryButton" type="button" disabled={batchStudies.length === 0} onClick={openScreening}>
            <FileSearch size={17} />
            Open Screening
          </button>
        </div>
      </section>

      {importDetailMessage ? (
        <div className={messageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
          {messageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{importDetailMessage}</span>
        </div>
      ) : null}

      <section className="importEditorLayout">
        <div className="panel">
          <SectionTitle icon={Database} title="Batch Details" action={batch.parserWarnings > 0 ? `${batch.parserWarnings} warnings` : "Ready"} />
          <form className="importDetailForm" onSubmit={updateImportDetails}>
            <label>
              <span>Source</span>
              <input value={importDetailForm.sourceName} onChange={(event) => onImportSourceNameChange(event.target.value)} />
            </label>
            <label>
              <span>Filename</span>
              <input value={importDetailForm.filename} onChange={(event) => onImportFilenameChange(event.target.value)} />
            </label>
            <div className="buttonRow">
              <button className="primaryButton" type="submit" disabled={isSavingImportDetails}>
                {isSavingImportDetails ? (
                  <>
                    <span className="inlineSpinner" aria-hidden="true" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check size={17} />
                    Save Details
                  </>
                )}
              </button>
              {batch.parserWarnings > 0 ? (
                <button className="ghostButton" type="button" onClick={() => reviewImportWarnings(batch.id)}>
                  <CheckCircle2 size={17} />
                  Mark Reviewed
                </button>
              ) : null}
            </div>
          </form>

          <div className={batch.parserWarnings > 0 ? "warningBox importReviewBox" : "secureBox importReviewBox"}>
            {batch.parserWarnings > 0 ? <AlertTriangle size={18} /> : <Check size={17} />}
            <div>
              <strong>{batch.status.replace("_", " ")}</strong>
              {warningMessages.length > 0 ? (
                <ul className="plainList compactList">
                  {warningMessages.slice(0, 10).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <span>No parser warnings are open for this batch.</span>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <SectionTitle icon={FileText} title="Citation Entries" action={`${batchStudies.length} records`} />
          {batchStudies.length > 0 ? (
            <div className="importEntryList">
              {batchStudies.map((study, index) => (
                <article className={studyEditId === study.id ? "importEntryCard editing" : "importEntryCard"} key={study.id}>
                  {studyEditId === study.id ? (
                    <form className="studyEditForm" onSubmit={updateImportStudy}>
                      <span className="entryReference">Record {index + 1}</span>
                      <label className="wideField">
                        <span>Title</span>
                        <input value={studyEditForm.title} onChange={(event) => onStudyEditFormChange({ title: event.target.value })} />
                      </label>
                      <div className="formGrid">
                        <label>
                          <span>Authors</span>
                          <input value={studyEditForm.authors} onChange={(event) => onStudyEditFormChange({ authors: event.target.value })} />
                        </label>
                        <label>
                          <span>Journal</span>
                          <input value={studyEditForm.journal} onChange={(event) => onStudyEditFormChange({ journal: event.target.value })} />
                        </label>
                        <label>
                          <span>Year</span>
                          <input inputMode="numeric" value={studyEditForm.year} onChange={(event) => onStudyEditFormChange({ year: event.target.value })} />
                        </label>
                        <label>
                          <span>DOI</span>
                          <input value={studyEditForm.doi} onChange={(event) => onStudyEditFormChange({ doi: event.target.value })} />
                        </label>
                      </div>
                      <label className="wideField">
                        <span>Keywords</span>
                        <input value={studyEditForm.keywords} onChange={(event) => onStudyEditFormChange({ keywords: event.target.value })} />
                      </label>
                      <label className="wideField">
                        <span>Abstract</span>
                        <textarea value={studyEditForm.abstract} onChange={(event) => onStudyEditFormChange({ abstract: event.target.value })} />
                      </label>
                      <div className="buttonRow">
                        <button className="primaryButton" type="submit" disabled={isSavingStudyEdit}>
                          {isSavingStudyEdit ? (
                            <>
                              <span className="inlineSpinner" aria-hidden="true" />
                              Saving...
                            </>
                          ) : (
                            <>
                              <Check size={17} />
                              Save Entry
                            </>
                          )}
                        </button>
                        <button className="ghostButton" type="button" onClick={cancelStudyEdit}>
                          <X size={17} />
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="importEntryHeader">
                        <div>
                          <span className="entryReference">Record {study.importItemId ?? index + 1}</span>
                          <strong>{study.title}</strong>
                          <span>
                            {study.authors.length > 0 ? study.authors.join(", ") : "No authors parsed"} · {study.journal} · {" "}
                            {study.year > 0 ? study.year : "Year needs review"}
                          </span>
                        </div>
                        <div className="buttonRow">
                          <button className="ghostButton" type="button" onClick={() => editImportStudy(study)}>
                            <PenLine size={17} />
                            Edit
                          </button>
                          <button className="dangerButton" type="button" onClick={() => deleteImportStudy(study)}>
                            <Trash2 size={17} />
                            Delete
                          </button>
                        </div>
                      </div>
                      <p className="importAbstract">{study.abstract}</p>
                      {study.pdfUrl ? (
                        <p className="importPdfLink">
                          <FileText size={15} />
                          <a href={study.pdfUrl} target="_blank" rel="noreferrer">Linked PDF</a>
                        </p>
                      ) : null}
                      {study.parserWarnings && study.parserWarnings.length > 0 ? (
                        <ul className="plainList compactList">
                          {study.parserWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon={FileText} title="No citation entries" description="This import batch does not contain screening records." />
          )}
        </div>
      </section>
    </div>
  );
}
