import { AlertTriangle, BookOpen, Check, ClipboardCheck, GitMerge, History, Plus, Trash2 } from "lucide-react";
import {
  type AppUser,
  type ExtractionFieldType,
  type ExtractionResponse,
  type ExtractionResponseValue,
  type ExtractionTemplate,
  type PrismaCounts,
  type Report,
  type ReviewProject,
  type Study,
  type ViewKey
} from "@/lib/prismaData";
import { EmptyState, SectionTitle, StatusRow } from "@/components/prisma-review-ui";
import { ReportPicker } from "@/components/review-sections/review-queue";

type FormSubmitEvent = {
  preventDefault: () => void;
};

type ExtractionTemplateFieldForm = {
  id: string;
  title: string;
  type: ExtractionFieldType;
  optionsText: string;
};

type ExtractionTemplateForm = {
  title: string;
  fields: ExtractionTemplateFieldForm[];
};

type ExtractionSectionProps = {
  activeCounts: PrismaCounts;
  projectReportQueue: Report[];
  projectExtractionStudyIds: Set<string>;
  selectedProject: ReviewProject;
  currentUser: AppUser;
  extractionMessage: string;
  activeExtractionTemplate?: ExtractionTemplate;
  createExtractionTemplate: (event: FormSubmitEvent) => void;
  isCreatingExtractionTemplate: boolean;
  extractionTemplateForm: ExtractionTemplateForm;
  setExtractionTemplateTitle: (title: string) => void;
  removeExtractionTemplateField: (fieldId: string) => void;
  updateExtractionTemplateField: (fieldId: string, updates: Partial<ExtractionTemplateFieldForm>) => void;
  addExtractionTemplateField: (type: ExtractionFieldType) => void;
  activeExtractionReport?: Report;
  projectExtractionReports: Report[];
  totalExtractionReportCount: number;
  setActiveView: (view: ViewKey) => void;
  setActiveExtractionReportId: (reportId: string) => void;
  setActiveReportId: (reportId: string) => void;
  projectScreeningStudies: Study[];
  extractionResponses: ExtractionResponse[];
  activeExtractionResponse?: ExtractionResponse;
  submitExtractionResponse: (event: FormSubmitEvent) => void;
  isSubmittingExtractionResponse: boolean;
  extractionFormValues: Record<string, ExtractionResponseValue | undefined>;
  updateExtractionValue: (fieldId: string, value: ExtractionResponseValue) => void;
  toggleExtractionChoice: (fieldId: string, option: string, checked: boolean) => void;
  reviewedCount: number;
  onOpenReviewed: () => void;
};

const pdfViewerPreferences = "#page=1&view=FitH&pagemode=none&navpanes=0";

export function ExtractionSection({
  activeCounts,
  projectReportQueue,
  projectExtractionStudyIds,
  selectedProject,
  currentUser,
  extractionMessage,
  activeExtractionTemplate,
  createExtractionTemplate,
  isCreatingExtractionTemplate,
  extractionTemplateForm,
  setExtractionTemplateTitle,
  removeExtractionTemplateField,
  updateExtractionTemplateField,
  addExtractionTemplateField,
  activeExtractionReport,
  projectExtractionReports,
  totalExtractionReportCount,
  setActiveView,
  setActiveExtractionReportId,
  setActiveReportId,
  projectScreeningStudies,
  extractionResponses,
  activeExtractionResponse,
  submitExtractionResponse,
  isSubmittingExtractionResponse,
  extractionFormValues,
  updateExtractionValue,
  toggleExtractionChoice,
  reviewedCount,
  onOpenReviewed
}: ExtractionSectionProps) {
  const uploadedPdfCount = projectReportQueue.filter((report) => report.fileName).length;
  const canManageProject = selectedProject.ownerIds.includes(currentUser.id) || selectedProject.ownerId === currentUser.id;
  const extractionMessageIsSuccess = /created|submitted|saved/i.test(extractionMessage);

  if (activeCounts.studiesIncluded === 0) {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Data extraction</p>
            <h1>Dual Independent Extraction</h1>
            <p className="subtle">Extraction forms and assignments become available after studies are included.</p>
          </div>
          <button className="ghostButton" type="button" onClick={onOpenReviewed}>
            <History size={16} />
            Reviewed {reviewedCount}
          </button>
        </section>
        <section className="settingsGrid">
          <div className="panel">
            <EmptyState
              icon={ClipboardCheck}
              title="No included studies yet"
              description="Files appear here after a report is retrieved, its PDF is uploaded, and the full-text decision reaches Include."
            />
          </div>
          <div className="panel">
            <SectionTitle icon={BookOpen} title="File Readiness" action="Full-text gate" />
            <div className="stateRows">
              <StatusRow label="Full-text reports" value={projectReportQueue.length.toString()} tone={projectReportQueue.length > 0 ? "info" : "warning"} />
              <StatusRow label="Uploaded PDFs" value={uploadedPdfCount.toString()} tone={uploadedPdfCount > 0 ? "secure" : "warning"} />
              <StatusRow label="Included for extraction" value={activeCounts.studiesIncluded.toString()} tone="danger" />
            </div>
            {projectReportQueue.length > 0 ? (
              <div className="tableWrap compactTableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Report</th>
                      <th>PDF</th>
                      <th>Extraction gate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectReportQueue.map((report) => (
                      <tr key={report.id}>
                        <td>
                          <strong>{report.title}</strong>
                        </td>
                        <td>{report.fileName ? "Uploaded" : "Missing"}</td>
                        <td>{projectExtractionStudyIds.has(report.studyId) ? "Visible" : "Awaiting Include"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  if (!activeExtractionTemplate) {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Data extraction</p>
            <h1>Data Template</h1>
            <p className="subtle">Project owners define the extraction fields before reviewers extract data from included reports.</p>
          </div>
          <button className="ghostButton" type="button" onClick={onOpenReviewed}>
            <History size={16} />
            Reviewed {reviewedCount}
          </button>
        </section>

        {extractionMessage ? (
          <div className={extractionMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
            {extractionMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
            <span>{extractionMessage}</span>
          </div>
        ) : null}

        {canManageProject ? (
          <form className="panel templateBuilder" onSubmit={createExtractionTemplate}>
            <SectionTitle icon={ClipboardCheck} title="Create Data Template" action={`${extractionTemplateForm.fields.length} fields`} />
            <label>
              <span>Template title</span>
              <input
                value={extractionTemplateForm.title}
                onChange={(event) => setExtractionTemplateTitle(event.target.value)}
              />
            </label>

            <div className="templateFieldList">
              {extractionTemplateForm.fields.map((field, index) => (
                <div className="templateFieldEditor" key={field.id}>
                  <div className="templateFieldHeader">
                    <strong>Field {index + 1}</strong>
                    <button className="ghostButton iconOnly" type="button" title="Remove field" onClick={() => removeExtractionTemplateField(field.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="formGrid compactFormGrid">
                    <label>
                      <span>Title</span>
                      <input
                        value={field.title}
                        onChange={(event) => updateExtractionTemplateField(field.id, { title: event.target.value })}
                        placeholder="Population characteristics"
                      />
                    </label>
                    <label>
                      <span>Type</span>
                      <select
                        value={field.type}
                        onChange={(event) => updateExtractionTemplateField(field.id, { type: event.target.value as ExtractionFieldType })}
                      >
                        <option value="multiline_text">Multiline Text</option>
                        <option value="single_choice">Single Choice</option>
                        <option value="multiple_choice">Multiple Choice</option>
                      </select>
                    </label>
                  </div>
                  {field.type !== "multiline_text" ? (
                    <label>
                      <span>Choices</span>
                      <textarea
                        value={field.optionsText}
                        onChange={(event) => updateExtractionTemplateField(field.id, { optionsText: event.target.value })}
                        placeholder={"Option A\nOption B"}
                      />
                    </label>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="buttonRow">
              <button className="ghostButton" type="button" onClick={() => addExtractionTemplateField("multiline_text")}>
                <Plus size={17} />
                Text
              </button>
              <button className="ghostButton" type="button" onClick={() => addExtractionTemplateField("single_choice")}>
                <Plus size={17} />
                Single Choice
              </button>
              <button className="ghostButton" type="button" onClick={() => addExtractionTemplateField("multiple_choice")}>
                <Plus size={17} />
                Multiple Choice
              </button>
              <button className="primaryButton" type="submit" disabled={isCreatingExtractionTemplate}>
                {isCreatingExtractionTemplate ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
                {isCreatingExtractionTemplate ? "Creating..." : "Create Template"}
              </button>
            </div>
          </form>
        ) : (
          <section className="panel">
            <EmptyState
              icon={ClipboardCheck}
              title="No data template"
              description="A project owner needs to create the extraction template before reviewers can extract data."
            />
          </section>
        )}
      </div>
    );
  }

  if (projectExtractionReports.length === 0) {
    return (
      <div className="viewStack">
        <section className="overviewBand compactBand">
          <div>
            <p className="eyebrow">Data extraction</p>
            <h1>Dual Independent Extraction</h1>
            <p className="subtle">{activeExtractionTemplate.title} · version {activeExtractionTemplate.version}</p>
          </div>
          <div className="buttonRow">
            {totalExtractionReportCount > 0 ? (
              <button className="ghostButton" type="button" onClick={() => setActiveView("consensus")}>
                <GitMerge size={16} />
                Resolve Conflicts
              </button>
            ) : null}
            <button className="ghostButton" type="button" onClick={onOpenReviewed}>
              <History size={16} />
              Reviewed {reviewedCount}
            </button>
          </div>
        </section>
        <section className="panel">
          <EmptyState
            icon={ClipboardCheck}
            title={totalExtractionReportCount > 0 ? "No active extraction reports" : "No reports in extraction"}
            description={
              totalExtractionReportCount > 0
                ? "All included reports have enough submitted extractions or are currently checked out by other reviewers."
                : "Included reports appear here after full-text screening advances them to extraction."
            }
          />
        </section>
      </div>
    );
  }

  const activeReportForExtraction = activeExtractionReport ?? projectExtractionReports[0];
  const activeStudyForExtraction = activeReportForExtraction
    ? projectScreeningStudies.find((study) => study.id === activeReportForExtraction.studyId)
    : undefined;
  const activeExtractionReportIndex = projectExtractionReports.findIndex((report) => report.id === activeReportForExtraction?.id);
  const activeExtractionFallbackId = activeExtractionReportIndex >= 0 ? activeExtractionReportIndex + 1 : undefined;
  const extractionPdfUrl = activeReportForExtraction?.fileName
    ? `/api/projects/${selectedProject.id}/reports/${activeReportForExtraction.id}?pdf=1&checksum=${encodeURIComponent(activeReportForExtraction.checksum ?? "")}${pdfViewerPreferences}`
    : "";
  const submittedResponsesForActiveReport = activeReportForExtraction
    ? extractionResponses.filter(
        (response) =>
          response.projectId === selectedProject.id &&
          response.reportId === activeReportForExtraction.id &&
          response.templateId === activeExtractionTemplate.id &&
          response.isSubmitted
      )
    : [];
  const requiredExtractionVotes = selectedProject.extractionRequiredVotes;
  const hasMyExtraction = Boolean(activeExtractionResponse?.isSubmitted);
  const hasExtractionCheckout = Boolean(activeReportForExtraction?.extractionCheckedOutByCurrentUser);
  const canSubmitExtraction = Boolean(activeReportForExtraction && (hasExtractionCheckout || hasMyExtraction));

  return (
    <div className="viewStack">
      <section className="overviewBand compactBand">
        <div>
          <p className="eyebrow">Data extraction</p>
          <h1>Dual Independent Extraction</h1>
          <p className="subtle">{activeExtractionTemplate.title} · version {activeExtractionTemplate.version}</p>
        </div>
        <ReportPicker
          action={
            <div className="buttonRow">
              <button className="ghostButton" type="button" onClick={() => setActiveView("consensus")}>
                <GitMerge size={16} />
                Resolve Conflicts
              </button>
              <button className="ghostButton" type="button" onClick={onOpenReviewed}>
                <History size={16} />
                Reviewed {reviewedCount}
              </button>
            </div>
          }
          activeFallbackId={activeExtractionFallbackId}
          activeStudy={activeStudyForExtraction}
          detail={`At least ${requiredExtractionVotes} submitted extraction vote${requiredExtractionVotes === 1 ? "" : "s"} required.`}
          eyebrow="Included reports"
          id="extraction-report-picker"
          onSelectReport={setActiveExtractionReportId}
          reports={projectExtractionReports}
          selectLabel="Jump to report"
          selectedReportId={activeReportForExtraction?.id ?? ""}
          studies={projectScreeningStudies}
          summary={`${projectExtractionReports.length} active of ${totalExtractionReportCount} report${totalExtractionReportCount === 1 ? "" : "s"}`}
        />
      </section>

      {extractionMessage ? (
        <div className={extractionMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
          {extractionMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{extractionMessage}</span>
        </div>
      ) : null}

      <section className="extractionWorkspace">
        <div className="pdfPane">
          <div className="pdfToolbar">
            <strong className="pdfTitle" title={activeReportForExtraction?.fileName || activeReportForExtraction?.pdfName || "No PDF uploaded"}>
              {activeReportForExtraction?.fileName || activeReportForExtraction?.pdfName || "No PDF uploaded"}
            </strong>
            {activeReportForExtraction ? (
              <button
                className="ghostButton"
                type="button"
                onClick={() => {
                  setActiveReportId(activeReportForExtraction.id);
                  setActiveView("fullText");
                }}
              >
                <BookOpen size={16} />
                Full Text
              </button>
            ) : null}
          </div>
          <div className={extractionPdfUrl ? "pdfCanvas pdfCanvasViewer" : "pdfCanvas"} aria-label="Extraction PDF review pane">
            {extractionPdfUrl ? (
              <iframe className="pdfViewer" src={extractionPdfUrl} title={`${activeReportForExtraction?.title ?? "Included report"} PDF`} />
            ) : (
              <div className="paperPage emptyPdfPage">
                <p className="paperEyebrow">PDF unavailable</p>
                <h2>{activeReportForExtraction?.title ?? "No included report selected"}</h2>
                <div className="paperLine wide" />
                <div className="paperLine" />
                <div className="paperLine short" />
              </div>
            )}
          </div>
        </div>

        <aside className="panel extractionFormPanel">
          <SectionTitle
            icon={ClipboardCheck}
            title="Extraction Form"
            action={`${submittedResponsesForActiveReport.length}/${requiredExtractionVotes} submitted`}
          />
          <h2>{activeReportForExtraction?.title ?? "Included report"}</h2>
          <p className="subtle">
            {activeStudyForExtraction
              ? `${activeStudyForExtraction.authors.join(", ") || "No authors parsed"} · ${activeStudyForExtraction.journal} · ${
                  activeStudyForExtraction.year > 0 ? activeStudyForExtraction.year : "Year needs review"
                }`
              : "Select an included report to extract data."}
          </p>
          <div className="stateRows">
            <StatusRow label="Template" value={`${activeExtractionTemplate.fields.length} fields`} tone="info" />
            <StatusRow
              label="Extraction votes"
              value={
                submittedResponsesForActiveReport.length >= requiredExtractionVotes
                  ? "Ready for comparison"
                  : `${submittedResponsesForActiveReport.length}/${requiredExtractionVotes} submitted`
              }
              tone={submittedResponsesForActiveReport.length >= requiredExtractionVotes ? "secure" : "warning"}
            />
            <StatusRow label="My extraction" value={hasMyExtraction ? "Submitted" : "Open"} tone={hasMyExtraction ? "secure" : "warning"} />
            <StatusRow
              label="Reviewer slot"
              value={hasExtractionCheckout || hasMyExtraction ? "Checked out" : "Waiting"}
              tone={hasExtractionCheckout || hasMyExtraction ? "secure" : "warning"}
            />
          </div>

          <form className="extractionForm" onSubmit={submitExtractionResponse}>
            {activeExtractionTemplate.fields.map((field) => {
              const value = extractionFormValues[field.id];
              return (
                <fieldset className="extractionField" key={field.id}>
                  <legend>{field.title}</legend>
                  {field.type === "multiline_text" ? (
                    <textarea
                      disabled={!canSubmitExtraction || isSubmittingExtractionResponse}
                      value={typeof value === "string" ? value : ""}
                      onChange={(event) => updateExtractionValue(field.id, event.target.value)}
                    />
                  ) : null}
                  {field.type === "single_choice" ? (
                    <div className="choiceList">
                      {field.options.map((option) => (
                        <label key={option}>
                          <input
                            type="radio"
                            name={field.id}
                            disabled={!canSubmitExtraction || isSubmittingExtractionResponse}
                            checked={value === option}
                            onChange={() => updateExtractionValue(field.id, option)}
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {field.type === "multiple_choice" ? (
                    <div className="choiceList">
                      {field.options.map((option) => {
                        const checked = Array.isArray(value) && value.includes(option);
                        return (
                          <label key={option}>
                            <input
                              type="checkbox"
                              disabled={!canSubmitExtraction || isSubmittingExtractionResponse}
                              checked={checked}
                              onChange={(event) => toggleExtractionChoice(field.id, option, event.target.checked)}
                            />
                            <span>{option}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </fieldset>
              );
            })}

            {!canSubmitExtraction ? (
              <div className="validationBox">
                <AlertTriangle size={17} />
                <span>Waiting for an active reviewer slot before submitting extraction data.</span>
              </div>
            ) : null}

            <button className="primaryButton" type="submit" disabled={!canSubmitExtraction || isSubmittingExtractionResponse}>
              {isSubmittingExtractionResponse ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
              {isSubmittingExtractionResponse ? "Submitting..." : "Submit Extraction"}
            </button>
          </form>
        </aside>
      </section>
    </div>
  );
}
