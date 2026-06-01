import type { FormEvent } from "react";
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
  maybePolicy: "advance_to_full_text" | "conflict" | "third_vote";
};

type InviteFormShape = {
  name: string;
  email: string;
  title: string;
};

type SettingsSectionProps = {
  selectedProject: ReviewProject;
  currentUser: AppUser;
  users: AppUser[];
  projectSettingsForm: ProjectSettingsFormShape;
  projectSettingsMessage: string;
  updateProjectSettings: (event: FormEvent<HTMLFormElement>) => void;
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
  onSettingsMaybePolicyChange: (value: ProjectSettingsFormShape["maybePolicy"]) => void;
  teamUserSearch: string;
  setTeamUserSearch: (value: string) => void;
  teamUserSearchResults: AppUser[];
  addExistingUserToProject: (userId: string) => void;
  inviteForm: InviteFormShape;
  onInviteNameChange: (value: string) => void;
  onInviteEmailChange: (value: string) => void;
  onInviteTitleChange: (value: string) => void;
  inviteUserToProject: (event: FormEvent<HTMLFormElement>) => void;
  teamMessage: string;
  toggleProjectOwner: (userId: string) => void;
  removeUserFromProject: (userId: string) => void;
  teamRolePendingUserId: string | null;
  teamRemovePendingUserId: string | null;
  isSavingProjectSettings: boolean;
  hasProjectSeedData: boolean;
};

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
  onSettingsMaybePolicyChange,
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
  teamRolePendingUserId,
  teamRemovePendingUserId,
  isSavingProjectSettings,
  hasProjectSeedData
}: SettingsSectionProps) {
  const projectMembers = selectedProject.memberIds
    .map((memberId) => users.find((user) => user.id === memberId))
    .filter((user): user is AppUser => Boolean(user));
  const canManageProject = selectedProject.ownerIds.includes(currentUser.id) || selectedProject.ownerId === currentUser.id;
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
        <section className="panel">
          <div className={settingsMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
            {settingsMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
            <span>{projectSettingsMessage}</span>
          </div>
        </section>
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
          </div>
        </section>
      </form>

      <section className="settingsGrid">
        <div className="panel">
          <SectionTitle icon={Users} title="Project Team" action={`${projectMembers.length} members`} />
          <div className="teamList">
            {projectMembers.map((member) => {
              const isRoleActionPending = teamRolePendingUserId === member.id;
              const isRemoveActionPending = teamRemovePendingUserId === member.id;
              const isAnyActionPending = isRoleActionPending || isRemoveActionPending;

              return (
                <article className="teamMember" key={member.id}>
                <span className="avatar" style={{ background: member.avatarColor }}>
                  {member.initials}
                </span>
                <div>
                  <strong>{member.name}</strong>
                  <span>{member.title} · {member.email}</span>
                </div>
                <Badge label={selectedProject.ownerIds.includes(member.id) ? "owner" : "reviewer"} tone={selectedProject.ownerIds.includes(member.id) ? "info" : "neutral"} />
                <div className="teamMemberActions">
                  <button
                    className="ghostButton"
                    type="button"
                    title={selectedProject.ownerIds.includes(member.id) && selectedProject.ownerIds.length === 1 ? "At least one owner is required" : selectedProject.ownerIds.includes(member.id) ? "Change role to reviewer" : "Change role to owner"}
                    disabled={(selectedProject.ownerIds.includes(member.id) && selectedProject.ownerIds.length === 1) || isAnyActionPending}
                    onClick={() => toggleProjectOwner(member.id)}
                  >
                    {isRoleActionPending ? (
                      <>
                        <span className="inlineSpinner" aria-hidden="true" />
                        Saving...
                      </>
                    ) : selectedProject.ownerIds.includes(member.id) ? "Make reviewer" : "Make owner"}
                  </button>
                  <button
                    className="dangerButton"
                    type="button"
                    title={selectedProject.ownerIds.includes(member.id) && selectedProject.ownerIds.length === 1 ? "Last owner cannot be removed" : "Remove member"}
                    disabled={(selectedProject.ownerIds.includes(member.id) && selectedProject.ownerIds.length === 1) || isAnyActionPending}
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
          <SectionTitle icon={UserRoundCheck} title="Add People" action="Existing or invite" />
          <div className="addMemberSearch">
            <div className="addMemberBox addMemberBoxSearch">
              <label>
                <span>Search users</span>
                <input value={teamUserSearch} onChange={(event) => setTeamUserSearch(event.target.value)} placeholder="Name or email" />
              </label>
            </div>

            {teamUserSearchResults.length > 0 ? (
              <div className="teamSearchResultsOverlay">
                <div className="teamList teamSearchResultsList">
                  {teamUserSearchResults.map((user) => (
                    <div className="teamMember" key={user.id}>
                      <span className="avatar" style={{ background: user.avatarColor }}>
                        {user.initials}
                      </span>
                      <div>
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                      </div>
                      <span>{user.title}</span>
                      <button className="ghostButton" type="button" onClick={() => addExistingUserToProject(user.id)} disabled={!canManageProject}>
                        <Plus size={16} />
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <form className="inviteForm" onSubmit={inviteUserToProject}>
            <label>
              <span>Invite name</span>
              <input value={inviteForm.name} onChange={(event) => onInviteNameChange(event.target.value)} />
            </label>
            <label>
              <span>Invite email</span>
              <input value={inviteForm.email} onChange={(event) => onInviteEmailChange(event.target.value)} />
            </label>
            <label>
              <span>Role title</span>
              <input value={inviteForm.title} onChange={(event) => onInviteTitleChange(event.target.value)} />
            </label>
            <button className="ghostButton" type="submit">
              <UserRoundCheck size={17} />
              Invite
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
    </div>
  );
}
