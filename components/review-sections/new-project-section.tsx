import type { FormEvent } from "react";
import { ArrowLeft, FileText, Lock, Plus, Users } from "lucide-react";
import type { AppUser } from "@/lib/prismaData";
import { SectionTitle } from "@/components/prisma-review-ui";
import type { NewProjectForm } from "@/components/use-new-project-state";

type NewProjectSectionProps = {
  currentUser: AppUser;
  users: AppUser[];
  newProjectForm: NewProjectForm;
  canCreate: boolean;
  creationStatus: string;
  creationSummary: string;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
  onOrganizationChange: (value: string) => void;
  onProtocolIdChange: (value: string) => void;
  onDueDateChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSearchStrategiesChange: (value: string) => void;
  onBlindModeChange: (value: boolean) => void;
  onAbstractVotesChange: (value: number) => void;
  onFullTextVotesChange: (value: number) => void;
  onExtractionVotesChange: (value: number) => void;
  onMaybePolicyChange: (value: NewProjectForm["maybePolicy"]) => void;
  toggleProjectMember: (userId: string) => void;
};

export function NewProjectSection({
  currentUser,
  users,
  newProjectForm,
  canCreate,
  creationStatus,
  creationSummary,
  onBack,
  onSubmit,
  onTitleChange,
  onOrganizationChange,
  onProtocolIdChange,
  onDueDateChange,
  onDescriptionChange,
  onSearchStrategiesChange,
  onBlindModeChange,
  onAbstractVotesChange,
  onFullTextVotesChange,
  onExtractionVotesChange,
  onMaybePolicyChange,
  toggleProjectMember
}: NewProjectSectionProps) {
  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">New review</p>
          <h1>Create Review Project</h1>
          <p className="subtle">Set up the project shell, blind voting policy, and team membership before importing citations.</p>
        </div>
        <button className="ghostButton" type="button" onClick={onBack}>
          <ArrowLeft size={17} />
          Back
        </button>
      </section>

      <form className="projectForm" onSubmit={onSubmit}>
        <section className="panel formActions formActionsProminent">
          <div>
            <strong>{creationStatus}</strong>
            <span>{creationSummary}</span>
          </div>
          <button className="primaryButton" type="submit" disabled={!canCreate}>
            <Plus size={17} />
            Create Review
          </button>
        </section>

        <section className="panel">
          <SectionTitle icon={FileText} title="Review Details" action="Required setup" />
          <div className="formGrid">
            <label>
              <span>Review title</span>
              <input value={newProjectForm.title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Ultimate Question of Life, the Universe, and Everything" />
            </label>
            <label>
              <span>Organization</span>
              <input value={newProjectForm.organization} onChange={(event) => onOrganizationChange(event.target.value)} placeholder="Evidence Methods Unit" />
            </label>
            <label>
              <span>Protocol ID</span>
              <input value={newProjectForm.protocolId} onChange={(event) => onProtocolIdChange(event.target.value)} placeholder="PROSPERO or draft protocol" />
            </label>
            <label>
              <span>Due date (dd-mm-yyyy)</span>
              <input inputMode="numeric" pattern="[0-9]{2}-[0-9]{2}-[0-9]{4}" value={newProjectForm.dueDate} onChange={(event) => onDueDateChange(event.target.value)} placeholder="30-09-2026" />
            </label>
          </div>
          <label className="wideField">
            <span>Description</span>
            <textarea value={newProjectForm.description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Briefly describe the review question and scope." />
          </label>
          <label className="wideField">
            <span>Search strategies backup</span>
            <textarea
              className="strategyTextarea"
              value={newProjectForm.searchStrategies}
              onChange={(event) => onSearchStrategiesChange(event.target.value)}
              placeholder="Optional. Paste database names, keywords, Boolean strings, dates, filters, and search-platform notes."
            />
          </label>
        </section>

        <section className="settingsGrid">
          <div className="panel">
            <SectionTitle icon={Lock} title="Screening Policy" action="Workflow state machine" />
            <label className="toggleRow">
              <input type="checkbox" checked={newProjectForm.blindMode} onChange={(event) => onBlindModeChange(event.target.checked)} />
              <span />
              <strong>Enable blind mode</strong>
            </label>
            <div className="formGrid compactFormGrid">
              <label>
                <span>Title/abstract votes</span>
                <input type="number" min={1} max={4} value={newProjectForm.abstractRequiredVotes} onChange={(event) => onAbstractVotesChange(Number(event.target.value))} />
              </label>
              <label>
                <span>Full-text votes</span>
                <input type="number" min={2} max={4} value={newProjectForm.fullTextRequiredVotes} onChange={(event) => onFullTextVotesChange(Number(event.target.value))} />
              </label>
              <label>
                <span>Extraction votes</span>
                <input type="number" min={1} max={4} value={newProjectForm.extractionRequiredVotes} onChange={(event) => onExtractionVotesChange(Number(event.target.value))} />
              </label>
            </div>
            <label className="fieldLabel" htmlFor="new-project-maybe-policy">
              Maybe policy
            </label>
            <select id="new-project-maybe-policy" value={newProjectForm.maybePolicy} onChange={(event) => onMaybePolicyChange(event.target.value as NewProjectForm["maybePolicy"])}>
              <option value="advance_to_full_text">Advance to full text</option>
              <option value="third_vote">Request third vote</option>
              <option value="conflict">Treat as conflict</option>
            </select>
          </div>

          <div className="panel">
            <SectionTitle icon={Users} title="Team" action={`${newProjectForm.memberIds.length} selected`} />
            <div className="memberPicker">
              {users.map((user) => (
                <label className="memberOption" key={user.id}>
                  <input type="checkbox" checked={newProjectForm.memberIds.includes(user.id)} onChange={() => toggleProjectMember(user.id)} disabled={user.id === currentUser.id} />
                  <span className="avatar" style={{ background: user.avatarColor }}>
                    {user.initials}
                  </span>
                  <div>
                    <strong>{user.name}</strong>
                    <small>{user.title}</small>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="panel formActions">
          <div>
            <strong>{creationStatus}</strong>
            <span>{creationSummary}</span>
          </div>
          <button className="primaryButton" type="submit" disabled={!canCreate}>
            <Plus size={17} />
            Create Review
          </button>
        </section>
      </form>
    </div>
  );
}