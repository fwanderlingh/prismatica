import { AlertTriangle, Check, Clock, ShieldCheck } from "lucide-react";
import type { AppAuthSettings, AppReviewSettings } from "@/lib/apiTypes";
import { SectionTitle, StatusRow } from "@/components/prisma-review-ui";
import { TransactionalEmailSettings } from "@/components/transactional-email-settings";

type FormSubmitEvent = { preventDefault: () => void };

export type ReviewSettingsForm = {
  screeningCheckoutWindowMinutes: number;
  extractionCheckoutWindowMinutes: number;
  pdfUploadMaxSizeMb: number;
  auditHistoryLimit: number;
};

type SystemSettingsSectionProps = {
  authSettings: AppAuthSettings;
  authSettingsMessage: string;
  reviewSettings: AppReviewSettings;
  reviewSettingsForm: ReviewSettingsForm;
  reviewSettingsMessage: string;
  isUpdatingRegistrationSetting: boolean;
  isUpdatingReviewSettings: boolean;
  updateRegistrationSetting: (enabled: boolean) => void;
  updateTransactionalEmailSetting: (enabled: boolean) => void;
  onScreeningCheckoutWindowChange: (value: number) => void;
  onExtractionCheckoutWindowChange: (value: number) => void;
  onPdfUploadMaxSizeMbChange: (value: number) => void;
  onAuditHistoryLimitChange: (value: number) => void;
  updateReviewSettings: (event: FormSubmitEvent) => void;
};

export function SystemSettingsSection({
  authSettings,
  authSettingsMessage,
  reviewSettings,
  reviewSettingsForm,
  reviewSettingsMessage,
  isUpdatingRegistrationSetting,
  isUpdatingReviewSettings,
  updateRegistrationSetting,
  updateTransactionalEmailSetting,
  onScreeningCheckoutWindowChange,
  onExtractionCheckoutWindowChange,
  onPdfUploadMaxSizeMbChange,
  onAuditHistoryLimitChange,
  updateReviewSettings
}: SystemSettingsSectionProps) {
  const authSettingsMessageIsSuccess = /saved|disabled|enabled/i.test(authSettingsMessage);
  const reviewSettingsMessageIsSuccess = /saved/i.test(reviewSettingsMessage);

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>System Settings</h1>
          <p className="subtle">Manage registration, transactional email, and website-wide review settings.</p>
        </div>
      </section>

      {authSettingsMessage ? (
        <div role="status" className={authSettingsMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
          {authSettingsMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{authSettingsMessage}</span>
        </div>
      ) : null}

      <section className="settingsGrid">
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
              <small>Default: 100. Lowering this limit removes older events.</small>
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
            <StatusRow label="Audit history" value={`${reviewSettings.auditHistoryLimit} events`} tone="info" />
            <StatusRow label="PDF upload limit" value={`${reviewSettings.pdfUploadMaxSizeMb} MB`} tone="info" />
          </div>
          {reviewSettingsMessage ? (
            <div className={reviewSettingsMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
              {reviewSettingsMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{reviewSettingsMessage}</span>
            </div>
          ) : null}
        </div>

        <TransactionalEmailSettings enabled={authSettings.transactionalEmailEnabled} pending={isUpdatingRegistrationSetting} onChange={updateTransactionalEmailSetting} />

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
        </div>
      </section>
    </div>
  );
}
