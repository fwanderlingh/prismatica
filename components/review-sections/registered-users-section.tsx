import { useMemo, useState } from "react";
import { AlertTriangle, Check, Clock, ShieldCheck, UserPlus, Users } from "lucide-react";
import type { AppAuthSettings, AppReviewSettings } from "@/lib/apiTypes";
import type { AppUser } from "@/lib/prismaData";
import { SectionTitle, StatusRow } from "@/components/prisma-review-ui";

type FormSubmitEvent = {
  preventDefault: () => void;
};

type AdminCreateUserForm = {
  name: string;
  email: string;
  organization: string;
  title: string;
};

export type ReviewSettingsForm = {
  screeningCheckoutWindowMinutes: number;
  extractionCheckoutWindowMinutes: number;
  pdfUploadMaxSizeMb: number;
  auditHistoryLimit: number;
};

type RegisteredUsersSectionProps = {
  users: AppUser[];
  currentUser: AppUser;
  adminDirectoryMessage: string;
  authSettings: AppAuthSettings;
  authSettingsMessage: string;
  reviewSettings: AppReviewSettings;
  reviewSettingsForm: ReviewSettingsForm;
  reviewSettingsMessage: string;
  adminResetUserPassword: (user: AppUser) => void;
  adminDeleteUser: (user: AppUser) => void;
  createUserForm: AdminCreateUserForm;
  onCreateUserFormNameChange: (value: string) => void;
  onCreateUserFormEmailChange: (value: string) => void;
  onCreateUserFormOrganizationChange: (value: string) => void;
  onCreateUserFormTitleChange: (value: string) => void;
  onCreateUser: (event: FormSubmitEvent) => void;
  isCreatingUser: boolean;
  pendingUserAction: { userId: string; action: "reset" | "delete" } | null;
  isUpdatingRegistrationSetting: boolean;
  isUpdatingReviewSettings: boolean;
  updateRegistrationSetting: (enabled: boolean) => void;
  onScreeningCheckoutWindowChange: (value: number) => void;
  onExtractionCheckoutWindowChange: (value: number) => void;
  onPdfUploadMaxSizeMbChange: (value: number) => void;
  onAuditHistoryLimitChange: (value: number) => void;
  updateReviewSettings: (event: FormSubmitEvent) => void;
};

const adminUsersPageSize = 10;

export function RegisteredUsersSection({
  users,
  currentUser,
  adminDirectoryMessage,
  authSettings,
  reviewSettings,
  reviewSettingsForm,
  authSettingsMessage,
  reviewSettingsMessage,
  adminResetUserPassword,
  adminDeleteUser,
  createUserForm,
  onCreateUserFormNameChange,
  onCreateUserFormEmailChange,
  onCreateUserFormOrganizationChange,
  onCreateUserFormTitleChange,
  onCreateUser,
  isCreatingUser,
  pendingUserAction,
  isUpdatingRegistrationSetting,
  isUpdatingReviewSettings,
  updateRegistrationSetting,
  onScreeningCheckoutWindowChange,
  onExtractionCheckoutWindowChange,
  onPdfUploadMaxSizeMbChange,
  onAuditHistoryLimitChange,
  updateReviewSettings
}: RegisteredUsersSectionProps) {
  const adminDirectoryMessageIsSuccess = /^(Temporary password|Deleted account|Created account|User account created)/i.test(adminDirectoryMessage);
  const authSettingsMessageIsSuccess = /saved|disabled|enabled/i.test(authSettingsMessage);
  const reviewSettingsMessageIsSuccess = /saved/i.test(reviewSettingsMessage);
  const userPageCount = Math.max(1, Math.ceil(users.length / adminUsersPageSize));
  const [userPage, setUserPage] = useState(1);
  const currentUserPage = Math.min(userPage, userPageCount);
  const userPageStart = (currentUserPage - 1) * adminUsersPageSize;
  const pagedUsers = useMemo(() => users.slice(userPageStart, userPageStart + adminUsersPageSize), [userPageStart, users]);
  const firstUserNumber = users.length === 0 ? 0 : userPageStart + 1;
  const lastUserNumber = Math.min(userPageStart + pagedUsers.length, users.length);

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Registered Users</h1>
          <p className="subtle">Review server accounts, reset access for non-admin users, delete spam accounts, and control public registration.</p>
        </div>
      </section>

      <section className="settingsGrid">
        <div className="panel">
          <SectionTitle icon={Users} title="User Accounts" action={`${users.length} registered`} />
          <div className="memberPicker">
            {pagedUsers.map((user) => {
              const isResettingUser = pendingUserAction?.userId === user.id && pendingUserAction.action === "reset";
              const isDeletingUser = pendingUserAction?.userId === user.id && pendingUserAction.action === "delete";
              const disableUserActions = user.id === currentUser.id || user.isAdmin || pendingUserAction !== null;

              return (
                <div className={`${user.id === currentUser.id ? "userSwitch active" : "userSwitch"} adminManagedUserSwitch`} key={user.id}>
                  <span className="avatar" style={{ background: user.avatarColor }}>
                    {user.initials}
                  </span>
                  <div>
                    <strong>{user.name}</strong>
                    <small>
                      {user.email} · {user.title}
                      {user.isAdmin ? " · administrator" : ""}
                    </small>
                  </div>
                  <div className="userSwitchActions">
                    <button
                      className="ghostButton"
                      type="button"
                      disabled={disableUserActions}
                      onClick={() => adminResetUserPassword(user)}
                    >
                      {isResettingUser ? <span className="inlineSpinner" aria-hidden="true" /> : null}
                      {isResettingUser ? "Resetting..." : "Reset password"}
                    </button>
                    <button
                      className="dangerButton"
                      type="button"
                      disabled={disableUserActions}
                      onClick={() => adminDeleteUser(user)}
                    >
                      {isDeletingUser ? <span className="inlineSpinner" aria-hidden="true" /> : null}
                      {isDeletingUser ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {userPageCount > 1 ? (
            <div className="paginationBar" aria-label="User directory pagination">
              <button className="ghostButton" type="button" disabled={currentUserPage <= 1} onClick={() => setUserPage(Math.max(currentUserPage - 1, 1))}>
                Previous
              </button>
              <span>{`Showing ${firstUserNumber}-${lastUserNumber} of ${users.length}`}</span>
              <button className="ghostButton" type="button" disabled={currentUserPage >= userPageCount} onClick={() => setUserPage(Math.min(currentUserPage + 1, userPageCount))}>
                Next
              </button>
            </div>
          ) : null}
          {adminDirectoryMessage ? (
            <div className={adminDirectoryMessageIsSuccess ? "validationItem ok adminDirectoryFeedback" : "validationItem blocked adminDirectoryFeedback"}>
              {adminDirectoryMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{adminDirectoryMessage}</span>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <SectionTitle icon={UserPlus} title="Create User" action="Admin only" />
          <p className="subtle">Create a reviewer account directly. A temporary password will be generated and shown after creation.</p>
          <form className="inviteForm" onSubmit={onCreateUser}>
            <label>
              <span>Name</span>
              <input value={createUserForm.name} onChange={(event) => onCreateUserFormNameChange(event.target.value)} />
            </label>
            <label>
              <span>Email</span>
              <input value={createUserForm.email} onChange={(event) => onCreateUserFormEmailChange(event.target.value)} />
            </label>
            <label>
              <span>Organization</span>
              <input value={createUserForm.organization} onChange={(event) => onCreateUserFormOrganizationChange(event.target.value)} />
            </label>
            <label>
              <span>Role title</span>
              <input value={createUserForm.title} onChange={(event) => onCreateUserFormTitleChange(event.target.value)} />
            </label>
            <button className="ghostButton" type="submit" disabled={isCreatingUser}>
              {isCreatingUser ? (
                <>
                  <span className="inlineSpinner" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus size={17} />
                  Create user
                </>
              )}
            </button>
          </form>
        </div>

        <div className="panel">
          <SectionTitle icon={ShieldCheck} title="Registration Security" action={authSettings.registrationEnabled ? "Open" : "Sign-in only"} />
          <p className="subtle">Control whether new users can self-register.</p>
          <label className="toggleRow">
            <input
              type="checkbox"
              checked={authSettings.registrationEnabled}
              disabled={isUpdatingRegistrationSetting}
              onChange={(event) => updateRegistrationSetting(event.target.checked)}
            />
            <span />
            <strong>{isUpdatingRegistrationSetting ? "Saving registration policy..." : "Allow public registration"}</strong>
          </label>
          <div className="stateRows">
            <StatusRow label="Registration screen" value={authSettings.registrationEnabled ? "Enabled" : "Disabled"} tone={authSettings.registrationEnabled ? "warning" : "secure"} />
            <StatusRow label="Captcha" value="Required for new accounts" tone="secure" />
          </div>
          {authSettingsMessage ? (
            <div className={authSettingsMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
              {authSettingsMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{authSettingsMessage}</span>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <SectionTitle icon={Clock} title="Review Settings" action="Global" />
          <p className="subtle">Set review checkout windows, the maximum PDF upload size, and audit history retention.</p>
          <form className="inviteForm" onSubmit={updateReviewSettings}>
            <label>
              <span>Screening/full-text minutes</span>
              <input
                type="number"
                min={1}
                max={600}
                value={reviewSettingsForm.screeningCheckoutWindowMinutes}
                disabled={isUpdatingReviewSettings}
                onChange={(event) => onScreeningCheckoutWindowChange(Number(event.target.value))}
              />
            </label>
            <label>
              <span>Extraction minutes</span>
              <input
                type="number"
                min={1}
                max={600}
                value={reviewSettingsForm.extractionCheckoutWindowMinutes}
                disabled={isUpdatingReviewSettings}
                onChange={(event) => onExtractionCheckoutWindowChange(Number(event.target.value))}
              />
            </label>
            <label>
              <span>PDF upload limit (MB)</span>
              <input
                type="number"
                min={1}
                max={100}
                value={reviewSettingsForm.pdfUploadMaxSizeMb}
                disabled={isUpdatingReviewSettings}
                onChange={(event) => onPdfUploadMaxSizeMbChange(Number(event.target.value))}
              />
            </label>
            <label>
              <span>Audit history limit (events)</span>
              <input
                type="number"
                min={1}
                max={10000}
                step={1}
                required
                value={reviewSettingsForm.auditHistoryLimit}
                disabled={isUpdatingReviewSettings}
                onChange={(event) => onAuditHistoryLimitChange(Number(event.target.value))}
              />
              <small>Across all reviews. Default: 100. Lowering this limit removes older events.</small>
            </label>
            <button className="ghostButton" type="submit" disabled={isUpdatingReviewSettings}>
              {isUpdatingReviewSettings ? (
                <>
                  <span className="inlineSpinner" aria-hidden="true" />
                  Saving settings...
                </>
              ) : (
                <>
                  <Check size={17} />
                  Save settings
                </>
              )}
            </button>
          </form>
          <div className="stateRows">
            <StatusRow label="Screening/full text" value={`${reviewSettings.screeningCheckoutWindowMinutes} min`} tone="info" />
            <StatusRow label="Extraction" value={`${reviewSettings.extractionCheckoutWindowMinutes} min`} tone="info" />
            <StatusRow label="Audit history" value={`${reviewSettings.auditHistoryLimit} events globally`} tone="info" />
            <StatusRow label="PDF upload limit" value={`${reviewSettings.pdfUploadMaxSizeMb} MB`} tone="info" />
          </div>
          {reviewSettingsMessage ? (
            <div className={reviewSettingsMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
              {reviewSettingsMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{reviewSettingsMessage}</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
