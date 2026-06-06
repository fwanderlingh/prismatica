import { useState } from "react";
import { AlertTriangle, Check, FileText, Lock, Plus, Settings, UserRoundCheck, Users, X } from "lucide-react";
import { type AppUser, type ReviewProject, roleRows } from "@/lib/prismaData";
import { Badge, SectionTitle, StatusRow } from "@/components/prisma-review-ui";

type ProjectSettingsFormShape = {
  title: string;
  organization: string;
  protocolId: string;
  description: string;
  searchStrategies: string;
  dueDate: string;
  blindMode: boolean;
  abstractRequiredVotes: number;
  fullTextRequiredVotes: number;
  extractionRequiredVotes: number;
  exclusionReasonsText: string;
  maybePolicy: "advance_to_full_text" | "conflict" | "third_vote";
  requireSequentialPhases: boolean;
};

type InviteFormShape = {
  name: string;
  email: string;
  title: string;
};

type FormSubmitEvent = {
  preventDefault: () => void;
};

type SettingsSectionProps = {
  selectedProject: ReviewProject;
  currentUser: AppUser;
  users: AppUser[];
  projectSettingsForm: ProjectSettingsFormShape;
  projectSettingsMessage: string;
  updateProjectSettings: (event: FormSubmitEvent) => void;
  onSettingsTitleChange: (value: string) => void;
  onSettingsOrganizationChange: (value: string) => void;
  onSettingsProtocolIdChange: (value: string) => void;
  onSettingsDueDateChange: (value: string) => void;
  onSettingsDescriptionChange: (value: string) => void;
  onSettingsSearchStrategiesChange: (value: string) => void;
  onSettingsBlindModeChange: (value: boolean) => void;
  onSettingsAbstractVotesChange: (value: number) => void;
  onSettingsFullTextVotesChange: (value: number) => void;
  onSettingsExtractionVotesChange: (value: number) => void;
  onSettingsExclusionReasonsTextChange: (value: string) => void;
  onSettingsMaybePolicyChange: (value: ProjectSettingsFormShape["maybePolicy"]) => void;
  onSettingsRequireSequentialPhasesChange: (value: boolean) => void;
  teamUserSearch: string;
  setTeamUserSearch: (value: string) => void;
  teamUserSearchResults: AppUser[];
  addExistingUserToProject: (userId: string) => void;
  inviteForm: InviteFormShape;
  onInviteNameChange: (value: string) => void;
  onInviteEmailChange: (value: string) => void;
  onInviteTitleChange: (value: string) => void;
  inviteUserToProject: (event: FormSubmitEvent) => void;
  teamMessage: string;
  toggleProjectOwner: (userId: string) => void;
  removeUserFromProject: (userId: string) => void;
  teamAddPendingUserId: string | null;
  teamRolePendingUserId: string | null;
  teamRemovePendingUserId: string | null;
  isInvitingProjectUser: boolean;
  isSavingProjectSettings: boolean;
  hasProjectSeedData: boolean;
  deleteProjectMessage: string;
  isDeletingProject: boolean;
  onDeleteProject: () => void;
};

const DELETE_CONFIRMATION_TEXT = "I want to delete this review";

export function SettingsSection({
  selectedProject,
  currentUser,
  users,
  projectSettingsForm,
  projectSettingsMessage,
  updateProjectSettings,
  onSettingsTitleChange,
  onSettingsOrganizationChange,
  onSettingsProtocolIdChange,
  onSettingsDueDateChange,
  onSettingsDescriptionChange,
  onSettingsSearchStrategiesChange,
  onSettingsBlindModeChange,
  onSettingsAbstractVotesChange,
  onSettingsFullTextVotesChange,
  onSettingsExtractionVotesChange,
  onSettingsExclusionReasonsTextChange,
  onSettingsMaybePolicyChange,
  onSettingsRequireSequentialPhasesChange,
  teamUserSearch,
  setTeamUserSearch,
  teamUserSearchResults,
  addExistingUserToProject,
  inviteForm,
  onInviteNameChange,
  onInviteEmailChange,
  onInviteTitleChange,
  inviteUserToProject,
  teamMessage,
  toggleProjectOwner,
  removeUserFromProject,
  teamAddPendingUserId,
  teamRolePendingUserId,
  teamRemovePendingUserId,
  isInvitingProjectUser,
  isSavingProjectSettings,
  hasProjectSeedData,
  deleteProjectMessage,
  isDeletingProject,
  onDeleteProject
}: SettingsSectionProps) {
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState("");
  const projectMembers = selectedProject.memberIds
    .map((memberId) => users.find((user) => user.id === memberId))
    .filter((user): user is AppUser => Boolean(user));
  const canManageProject = selectedProject.ownerIds.includes(currentUser.id) || selectedProject.ownerId === currentUser.id;
  const canSubmitDelete = canManageProject && deleteConfirmationInput.trim() === DELETE_CONFIRMATION_TEXT;
  const settingsMessageIsSuccess = projectSettingsMessage === "Project settings saved.";

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Project settings</p>
          <h1>Review Controls</h1>
          <p className="subtle">Authorization, blind-mode visibility, and transition policy are separate controls.</p>
        </div>
        <button className="primaryButton" type="submit" form="project-settings-form" title="Save settings" disabled={!canManageProject || isSavingProjectSettings}>
          {isSavingProjectSettings ? (
            <>
              <span className="inlineSpinner" aria-hidden="true" />
              Saving...
            </>
          ) : (
            <>
              <Check size={17} />
              Save
            </>
          )}
        </button>
      </section>

      {projectSettingsMessage ? (
        <div className={settingsMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
          {settingsMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{projectSettingsMessage}</span>
        </div>
      ) : null}

      <form className="projectForm" id="project-settings-form" onSubmit={updateProjectSettings}>
        <section className="panel">
          <SectionTitle icon={FileText} title="Review Details" action={canManageProject ? "Editable" : "Owner only"} />
          <div className="formGrid">
            <label>
              <span>Review title</span>
              <input
                value={projectSettingsForm.title}
                onChange={(event) => onSettingsTitleChange(event.target.value)}
                disabled={!canManageProject}
              />
            </label>
            <label>
              <span>Organization</span>
              <input
                value={projectSettingsForm.organization}
                onChange={(event) => onSettingsOrganizationChange(event.target.value)}
                disabled={!canManageProject}
              />
            </label>
            <label>
              <span>Protocol ID</span>
              <input
                value={projectSettingsForm.protocolId}
                onChange={(event) => onSettingsProtocolIdChange(event.target.value)}
                disabled={!canManageProject}
              />
            </label>
            <label>
              <span>Due date (dd-mm-yyyy)</span>
              <input
                inputMode="numeric"
                pattern="[0-9]{2}-[0-9]{2}-[0-9]{4}"
                value={projectSettingsForm.dueDate}
                onChange={(event) => onSettingsDueDateChange(event.target.value)}
                disabled={!canManageProject}
              />
            </label>
          </div>
          <label className="wideField">
            <span>Description</span>
            <textarea
              value={projectSettingsForm.description}
              onChange={(event) => onSettingsDescriptionChange(event.target.value)}
              disabled={!canManageProject}
            />
          </label>
          <label className="wideField">
            <span>Search strategies backup</span>
            <textarea
              className="strategyTextarea"
              value={projectSettingsForm.searchStrategies}
              onChange={(event) => onSettingsSearchStrategiesChange(event.target.value)}
              disabled={!canManageProject}
              placeholder={"Paste exact database searches, keywords, Boolean strings, dates, filters, and platform notes.\n\nExample:\nPubMed (2026-05-29)\n(\"underwater mapping\" OR sonar) AND (3D OR reconstruction)\nFilters: English; 2015-2026"}
            />
          </label>
        </section>

        <section className="settingsGrid">
          <div className="panel">
            <SectionTitle icon={Lock} title="Blind Mode" action={projectSettingsForm.blindMode ? "Enabled" : "Disabled"} />
            <label className="toggleRow">
              <input
                type="checkbox"
                checked={projectSettingsForm.blindMode}
                onChange={(event) => onSettingsBlindModeChange(event.target.checked)}
                disabled={!canManageProject}
              />
              <span />
              <strong>Reviewer endpoints hide other votes</strong>
            </label>
            <div className="stateRows">
              <StatusRow label="Reviewer API" value="Own decision only" tone="secure" />
              <StatusRow label="Admin API" value="Aggregate progress counts" tone="info" />
              <StatusRow label="Adjudication API" value="Role-gated vote disclosure" tone="warning" />
            </div>
          </div>

          <div className="panel">
            <SectionTitle icon={Settings} title="State Machine" action="Project policy" />
            <label className="toggleRow">
              <input
                type="checkbox"
                checked={projectSettingsForm.requireSequentialPhases}
                onChange={(event) => onSettingsRequireSequentialPhasesChange(event.target.checked)}
                disabled={!canManageProject}
              />
              <span />
              <strong>Lock future phases until the previous phase is complete</strong>
            </label>
            <div className="formGrid compactFormGrid">
              <label>
                <span>Title/abstract votes</span>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={projectSettingsForm.abstractRequiredVotes}
                  onChange={(event) => onSettingsAbstractVotesChange(Number(event.target.value))}
                  disabled={!canManageProject}
                />
              </label>
              <label>
                <span>Full-text votes</span>
                <input
                  type="number"
                  min={2}
                  max={4}
                  value={projectSettingsForm.fullTextRequiredVotes}
                  onChange={(event) => onSettingsFullTextVotesChange(Number(event.target.value))}
                  disabled={!canManageProject}
                />
              </label>
              <label>
                <span>Extraction votes</span>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={projectSettingsForm.extractionRequiredVotes}
                  onChange={(event) => onSettingsExtractionVotesChange(Number(event.target.value))}
                  disabled={!canManageProject}
                />
              </label>
            </div>
            <label className="fieldLabel" htmlFor="project-settings-maybe-policy">
              Maybe policy
            </label>
            <select
              id="project-settings-maybe-policy"
              value={projectSettingsForm.maybePolicy}
              onChange={(event) => onSettingsMaybePolicyChange(event.target.value as ProjectSettingsFormShape["maybePolicy"])}
              disabled={!canManageProject}
            >
              <option value="advance_to_full_text">Advance to full text</option>
              <option value="third_vote">Request third vote</option>
              <option value="conflict">Treat as conflict</option>
            </select>
            <label className="wideField">
              <span>Full-text exclusion reasons (one per line)</span>
              <textarea
                value={projectSettingsForm.exclusionReasonsText}
                onChange={(event) => onSettingsExclusionReasonsTextChange(event.target.value)}
                disabled={!canManageProject}
                placeholder={"Wrong population\nWrong intervention\nWrong comparator"}
              />
            </label>
          </div>
        </section>
      </form>

      <section className="settingsGrid">
        <div className="panel">
          <SectionTitle icon={Users} title="Project Team" action={`${projectMembers.length} members`} />
          <div className="teamList">
            {projectMembers.map((member) => {
              const isProjectOwner = selectedProject.ownerIds.includes(member.id);
              const isLastProjectOwner = isProjectOwner && selectedProject.ownerIds.length === 1;
              const isRoleActionPending = teamRolePendingUserId === member.id;
              const isRemoveActionPending = teamRemovePendingUserId === member.id;
              const isAnyActionPending = isRoleActionPending || isRemoveActionPending;
              const ownerActionTitle = !canManageProject
                ? "Only project owners can change roles"
                : isLastProjectOwner
                  ? "At least one owner is required"
                  : isProjectOwner
                    ? "Change role to reviewer"
                    : "Change role to owner";
              const removeActionTitle = !canManageProject
                ? "Only project owners can remove members"
                : isLastProjectOwner
                  ? "Last owner cannot be removed"
                  : "Remove member";

              return (
                <article className="teamMember" key={member.id}>
                <span className="avatar" style={{ background: member.avatarColor }}>
                  {member.initials}
                </span>
                <div>
                  <strong>{member.name}</strong>
                  <span>{member.title} · {member.email}</span>
                </div>
                <Badge label={isProjectOwner ? "owner" : "reviewer"} tone={isProjectOwner ? "info" : "neutral"} />
                <div className="teamMemberActions">
                  <button
                    className="ghostButton"
                    type="button"
                    title={ownerActionTitle}
                    disabled={!canManageProject || isLastProjectOwner || isAnyActionPending}
                    onClick={() => toggleProjectOwner(member.id)}
                  >
                    {isRoleActionPending ? (
                      <>
                        <span className="inlineSpinner" aria-hidden="true" />
                        Saving...
                      </>
                    ) : isProjectOwner ? "Make reviewer" : "Make owner"}
                  </button>
                  <button
                    className="dangerButton"
                    type="button"
                    title={removeActionTitle}
                    disabled={!canManageProject || isLastProjectOwner || isAnyActionPending}
                    onClick={() => removeUserFromProject(member.id)}
                  >
                    {isRemoveActionPending ? (
                      <>
                        <span className="inlineSpinner" aria-hidden="true" />
                        Removing...
                      </>
                    ) : (
                      <>
                        <X size={16} />
                        Remove
                      </>
                    )}
                  </button>
                </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <SectionTitle icon={UserRoundCheck} title="Add People" action={canManageProject ? "Existing or invite" : "Owner only"} />
          <div className="addMemberSearch">
            <div className="addMemberBox addMemberBoxSearch">
              <label>
                <span>Search users</span>
                <input
                  value={teamUserSearch}
                  disabled={!canManageProject || Boolean(teamAddPendingUserId) || isInvitingProjectUser}
                  onChange={(event) => setTeamUserSearch(event.target.value)}
                  placeholder="Name or email"
                />
              </label>
            </div>

            {teamUserSearchResults.length > 0 ? (
              <div className="teamSearchResultsOverlay">
                <div className="teamList teamSearchResultsList">
                  {teamUserSearchResults.map((user) => {
                    const isAddActionPending = teamAddPendingUserId === user.id;

                    return (
                    <div className="teamMember" key={user.id}>
                      <span className="avatar" style={{ background: user.avatarColor }}>
                        {user.initials}
                      </span>
                      <div>
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                      </div>
                      <span>{user.title}</span>
                      <button
                        className="ghostButton"
                        type="button"
                        onClick={() => addExistingUserToProject(user.id)}
                        disabled={!canManageProject || Boolean(teamAddPendingUserId) || isInvitingProjectUser}
                      >
                        {isAddActionPending ? <span className="inlineSpinner" aria-hidden="true" /> : <Plus size={16} />}
                        {isAddActionPending ? "Adding..." : "Add"}
                      </button>
                    </div>
                  );})}
                </div>
              </div>
            ) : null}
          </div>

          <form className="inviteForm" onSubmit={inviteUserToProject}>
            <label>
              <span>Invite name</span>
              <input value={inviteForm.name} onChange={(event) => onInviteNameChange(event.target.value)} disabled={!canManageProject || isInvitingProjectUser || Boolean(teamAddPendingUserId)} />
            </label>
            <label>
              <span>Invite email</span>
              <input value={inviteForm.email} onChange={(event) => onInviteEmailChange(event.target.value)} disabled={!canManageProject || isInvitingProjectUser || Boolean(teamAddPendingUserId)} />
            </label>
            <label>
              <span>Role title</span>
              <input value={inviteForm.title} onChange={(event) => onInviteTitleChange(event.target.value)} disabled={!canManageProject || isInvitingProjectUser || Boolean(teamAddPendingUserId)} />
            </label>
            <button className="ghostButton" type="submit" disabled={!canManageProject || isInvitingProjectUser || Boolean(teamAddPendingUserId)}>
              {isInvitingProjectUser ? <span className="inlineSpinner" aria-hidden="true" /> : <UserRoundCheck size={17} />}
              {isInvitingProjectUser ? "Inviting..." : "Invite"}
            </button>
          </form>

          {teamMessage ? (
            <div className="validationItem ok">
              <Check size={17} />
              <span>{teamMessage}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <SectionTitle icon={UserRoundCheck} title="Role Matrix" action={`${selectedProject.reviewers} active reviewers`} />
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                {hasProjectSeedData ? <th>Members</th> : null}
                <th>{hasProjectSeedData ? "Capabilities" : "User"}</th>
              </tr>
            </thead>
            <tbody>
              {hasProjectSeedData ? roleRows.map((row) => (
                <tr key={row.role}>
                  <td>
                    <strong>{row.role}</strong>
                  </td>
                  <td>{row.members}</td>
                  <td>{row.capabilities}</td>
                </tr>
              )) : selectedProject.memberIds.map((memberId) => {
                const member = users.find((user) => user.id === memberId);
                if (!member) {
                  return null;
                }
                return (
                  <tr key={member.id}>
                    <td>
                      <strong>{selectedProject.ownerIds.includes(member.id) ? "Owner" : "Reviewer"}</strong>
                    </td>
                    <td>{member.name} · {member.email}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {canManageProject ? (
        <section className="panel formActions">
          <div>
            <strong>Danger zone</strong>
            <span>This permanently deletes this review and all its imports, studies, reports, decisions, and audit history.</span>
          </div>
          <div className="projectDeleteActions">
            <label>
              <span>Type exactly: {DELETE_CONFIRMATION_TEXT}</span>
              <input
                value={deleteConfirmationInput}
                onChange={(event) => setDeleteConfirmationInput(event.target.value)}
                placeholder={DELETE_CONFIRMATION_TEXT}
                autoComplete="off"
              />
            </label>
            <button className="dangerButton" type="button" onClick={onDeleteProject} disabled={!canSubmitDelete || isDeletingProject}>
              {isDeletingProject ? (
                <>
                  <span className="inlineSpinner" aria-hidden="true" />
                  Deleting...
                </>
              ) : (
                <>
                  <X size={16} />
                  Delete review
                </>
              )}
            </button>
          </div>
        </section>
      ) : null}

      {deleteProjectMessage ? (
        <section className="panel">
          <div className="validationItem blocked">
            <AlertTriangle size={17} />
            <span>{deleteProjectMessage}</span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
