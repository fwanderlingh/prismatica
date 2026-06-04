import { AlertTriangle, Check, Clock, ShieldCheck, UserPlus, Users } from "lucide-react";
import type { AppAuthSettings } from "@/lib/apiTypes";
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

type AuthSettingsForm = {
  screeningCheckoutWindowMinutes: number;
  extractionCheckoutWindowMinutes: number;
};

type RegisteredUsersSectionProps = {
  users: AppUser[];
  currentUser: AppUser;
  adminDirectoryMessage: string;
  authSettings: AppAuthSettings;
  authSettingsForm: AuthSettingsForm;
  authSettingsMessage: string;
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
  updateRegistrationSetting: (enabled: boolean) => void;
  onScreeningCheckoutWindowChange: (value: number) => void;
  onExtractionCheckoutWindowChange: (value: number) => void;
  updateCheckoutWindowSettings: (event: FormSubmitEvent) => void;
};

export function RegisteredUsersSection({
  users,
  currentUser,
  adminDirectoryMessage,
  authSettings,
  authSettingsForm,
  authSettingsMessage,
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
  updateRegistrationSetting,
  onScreeningCheckoutWindowChange,
  onExtractionCheckoutWindowChange,
  updateCheckoutWindowSettings
}: RegisteredUsersSectionProps) {
  const adminDirectoryMessageIsSuccess = /^(Temporary password|Deleted account|Created account|User account created)/i.test(adminDirectoryMessage);
  const authSettingsMessageIsSuccess = /saved|disabled|enabled/i.test(authSettingsMessage);

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
            {users.map((user) => {
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
          <label className="toggleRow">
            <input
              type="checkbox"
              checked={authSettings.registrationEnabled}
              disabled={isUpdatingRegistrationSetting}
              onChange={(event) => updateRegistrationSetting(event.target.checked)}
            />
            <span />
            <strong>{isUpdatingRegistrationSetting ? "Updating settings..." : "Allow public registration"}</strong>
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
          <SectionTitle icon={Clock} title="Queue Checkout Windows" action="Global" />
          <form className="inviteForm" onSubmit={updateCheckoutWindowSettings}>
            <label>
              <span>Screening/full-text minutes</span>
              <input
                type="number"
                min={1}
                max={120}
                value={authSettingsForm.screeningCheckoutWindowMinutes}
                disabled={isUpdatingRegistrationSetting}
                onChange={(event) => onScreeningCheckoutWindowChange(Number(event.target.value))}
              />
            </label>
            <label>
              <span>Extraction minutes</span>
              <input
                type="number"
                min={1}
                max={120}
                value={authSettingsForm.extractionCheckoutWindowMinutes}
                disabled={isUpdatingRegistrationSetting}
                onChange={(event) => onExtractionCheckoutWindowChange(Number(event.target.value))}
              />
            </label>
            <button className="ghostButton" type="submit" disabled={isUpdatingRegistrationSetting}>
              {isUpdatingRegistrationSetting ? (
                <>
                  <span className="inlineSpinner" aria-hidden="true" />
                  Saving...
                </>
              ) : (
                <>
                  <Check size={17} />
                  Save windows
                </>
              )}
            </button>
          </form>
          <div className="stateRows">
            <StatusRow label="Screening/full text" value={`${authSettings.screeningCheckoutWindowMinutes} min`} tone="info" />
            <StatusRow label="Extraction" value={`${authSettings.extractionCheckoutWindowMinutes} min`} tone="info" />
          </div>
        </div>
      </section>
    </div>
  );
}
