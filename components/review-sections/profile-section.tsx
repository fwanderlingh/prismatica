import { AlertTriangle, Check, LogOut, Settings, UserCircle } from "lucide-react";
import { type AppUser, type WebsiteTheme } from "@/lib/prismaData";
import { SectionTitle, StatusRow } from "@/components/prisma-review-ui";

type FormSubmitEvent = {
  preventDefault: () => void;
};

type AccountFormShape = {
  organization: string;
  title: string;
  currentPassword: string;
  newPassword: string;
  websiteTheme: WebsiteTheme;
};

type ProfileSectionProps = {
  currentUser: AppUser;
  handleLogout: () => void;
  updateAccount: (event: FormSubmitEvent) => void;
  accountForm: AccountFormShape;
  onAccountOrganizationChange: (value: string) => void;
  onAccountTitleChange: (value: string) => void;
  onAccountCurrentPasswordChange: (value: string) => void;
  onAccountNewPasswordChange: (value: string) => void;
  onAccountThemeChange: (value: WebsiteTheme) => void;
  accountMessage: string;
};

export function ProfileSection({
  currentUser,
  handleLogout,
  updateAccount,
  accountForm,
  onAccountOrganizationChange,
  onAccountTitleChange,
  onAccountCurrentPasswordChange,
  onAccountNewPasswordChange,
  onAccountThemeChange,
  accountMessage
}: ProfileSectionProps) {
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

      <section className="panel">
        <SectionTitle icon={UserCircle} title="Account" action="Server session" />
        <form className="accountForm" onSubmit={updateAccount}>
          <label>
            <span>Organization</span>
            <input
              value={accountForm.organization}
              onChange={(event) => onAccountOrganizationChange(event.target.value)}
            />
          </label>
          <label>
            <span>Role title</span>
            <input
              value={accountForm.title}
              onChange={(event) => onAccountTitleChange(event.target.value)}
            />
          </label>
          <label>
            <span>Current password</span>
            <input
              type="password"
              value={accountForm.currentPassword}
              onChange={(event) => onAccountCurrentPasswordChange(event.target.value)}
            />
          </label>
          <label>
            <span>New password</span>
            <input
              type="password"
              value={accountForm.newPassword}
              onChange={(event) => onAccountNewPasswordChange(event.target.value)}
            />
          </label>
          <div className="profileRows">
            <StatusRow label="Timezone" value={currentUser.timezone} tone="secure" />
          </div>
          {accountMessage ? (
            <div className={accountMessage === "Account updated." ? "validationItem ok" : "validationItem blocked"}>
              {accountMessage === "Account updated." ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{accountMessage}</span>
            </div>
          ) : null}
          <button className="primaryButton" type="submit">
            <Check size={17} />
            Save Account
          </button>
        </form>
      </section>

      <section className="panel">
        <SectionTitle icon={Settings} title="Profile Preferences" action="Interface" />
        <form className="accountForm" onSubmit={updateAccount}>
          <label>
            <span>Website theme</span>
            <select
              value={accountForm.websiteTheme}
              onChange={(event) => onAccountThemeChange(event.target.value as WebsiteTheme)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </label>
          <button className="primaryButton" type="submit">
            <Check size={17} />
            Save Preferences
          </button>
        </form>
      </section>
    </div>
  );
}
