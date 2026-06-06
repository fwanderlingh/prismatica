import { AlertTriangle, Check, LogOut, Settings, UserCircle } from "lucide-react";
import { type AppUser, type WebsiteTheme } from "@/lib/prismaData";
import { SectionTitle, StatusRow } from "@/components/prisma-review-ui";

type FormSubmitEvent = {
  preventDefault: () => void;
};

export type ProfileSaveAction = "account" | "preferences";

type AccountFormShape = {
  name: string;
  organization: string;
  title: string;
  currentPassword: string;
  newPassword: string;
  websiteTheme: WebsiteTheme;
};

type ProfileSectionProps = {
  currentUser: AppUser;
  handleLogout: () => void;
  updateAccount: (event: FormSubmitEvent, action: ProfileSaveAction) => void;
  accountForm: AccountFormShape;
  onAccountNameChange: (value: string) => void;
  onAccountOrganizationChange: (value: string) => void;
  onAccountTitleChange: (value: string) => void;
  onAccountCurrentPasswordChange: (value: string) => void;
  onAccountNewPasswordChange: (value: string) => void;
  onAccountThemeChange: (value: WebsiteTheme) => void;
  accountMessage: string;
  accountMessageTarget: ProfileSaveAction;
  pendingAccountAction: ProfileSaveAction | null;
};

export function ProfileSection({
  currentUser,
  handleLogout,
  updateAccount,
  accountForm,
  onAccountNameChange,
  onAccountOrganizationChange,
  onAccountTitleChange,
  onAccountCurrentPasswordChange,
  onAccountNewPasswordChange,
  onAccountThemeChange,
  accountMessage,
  accountMessageTarget,
  pendingAccountAction
}: ProfileSectionProps) {
  const isSavingAccount = pendingAccountAction === "account";
  const isSavingPreferences = pendingAccountAction === "preferences";
  const isSavingProfile = pendingAccountAction !== null;
  const accountMessageIsSuccess = accountMessage === "Account details saved." || accountMessage === "Preferences saved.";

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div className="profileHero">
          <span className="avatar largeAvatar" style={{ background: currentUser.avatarColor }}>
            {currentUser.initials}
          </span>
          <div>
            <p className="eyebrow">Profile</p>
            <h1>{currentUser.name}</h1>
            <p className="subtle">
              {currentUser.title} · {currentUser.email}
            </p>
          </div>
        </div>
        <button className="ghostButton" type="button" onClick={handleLogout}>
          <LogOut size={17} />
          Sign Out
        </button>
      </section>

      <div className="profileSplit">
        <section className="panel">
          <SectionTitle icon={UserCircle} title="Account" action="Server session" />
          <form className="accountForm" aria-busy={isSavingAccount} onSubmit={(event) => updateAccount(event, "account")}>
            <label>
              <span>Display name</span>
              <input
                autoComplete="name"
                value={accountForm.name}
                disabled={isSavingProfile}
                onChange={(event) => onAccountNameChange(event.target.value)}
              />
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={currentUser.email} disabled readOnly />
            </label>
            <label>
              <span>Organization</span>
              <input
                autoComplete="organization"
                value={accountForm.organization}
                disabled={isSavingProfile}
                onChange={(event) => onAccountOrganizationChange(event.target.value)}
              />
            </label>
            <label>
              <span>Role title</span>
              <input
                autoComplete="organization-title"
                value={accountForm.title}
                disabled={isSavingProfile}
                onChange={(event) => onAccountTitleChange(event.target.value)}
              />
            </label>
            <label>
              <span>Current password</span>
              <input
                type="password"
                value={accountForm.currentPassword}
                disabled={isSavingProfile}
                onChange={(event) => onAccountCurrentPasswordChange(event.target.value)}
              />
            </label>
            <label>
              <span>New password</span>
              <input
                type="password"
                value={accountForm.newPassword}
                disabled={isSavingProfile}
                onChange={(event) => onAccountNewPasswordChange(event.target.value)}
              />
            </label>
            <div className="profileRows">
              <StatusRow label="Timezone" value={currentUser.timezone} tone="secure" />
            </div>
            {accountMessage && accountMessageTarget === "account" ? (
              <div className={accountMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
                {accountMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
                <span>{accountMessage}</span>
              </div>
            ) : null}
            <button className="primaryButton" type="submit" disabled={isSavingProfile}>
              {isSavingAccount ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
              {isSavingAccount ? "Saving..." : "Save Account"}
            </button>
          </form>
        </section>

        <section className="panel">
          <SectionTitle icon={Settings} title="Profile Preferences" action="Interface" />
          <form className="accountForm" aria-busy={isSavingPreferences} onSubmit={(event) => updateAccount(event, "preferences")}>
            <label>
              <span>Website theme</span>
              <select
                value={accountForm.websiteTheme}
                disabled={isSavingProfile}
                onChange={(event) => onAccountThemeChange(event.target.value as WebsiteTheme)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </label>
            {accountMessage && accountMessageTarget === "preferences" ? (
              <div className={accountMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
                {accountMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
                <span>{accountMessage}</span>
              </div>
            ) : null}
            <button className="primaryButton" type="submit" disabled={isSavingProfile}>
              {isSavingPreferences ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={17} />}
              {isSavingPreferences ? "Saving..." : "Save Preferences"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
