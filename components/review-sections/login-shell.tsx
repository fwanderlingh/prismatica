import { AlertTriangle, Eye, EyeOff, Info, LogIn, PenLine } from "lucide-react";
import type { AuthMode, RegisterForm } from "@/components/use-auth-state";

type FormSubmitEvent = {
  preventDefault: () => void;
};

type LoginShellProps = {
  registrationEnabled: boolean;
  authMode: AuthMode;
  loginEmail: string;
  loginPassword: string;
  showLoginPassword: boolean;
  showRegisterPassword: boolean;
  loginError: string;
  isLoginPending: boolean;
  isRegistrationPending: boolean;
  registerForm: RegisterForm;
  captchaQuestion?: string;
  brandName: string;
  brandTagline: string;
  brandLogoAlt: string;
  onSwitchAuthMode: (mode: AuthMode) => void;
  onLoginSubmit: (event: FormSubmitEvent) => void;
  onRegisterSubmit: (event: FormSubmitEvent) => void;
  onLoginEmailChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onToggleLoginPassword: () => void;
  onToggleRegisterPassword: () => void;
  onRegisterFormChange: <Key extends keyof RegisterForm>(key: Key, value: RegisterForm[Key]) => void;
  onRefreshCaptcha: () => void;
};

export function LoginShell({
  registrationEnabled,
  authMode,
  loginEmail,
  loginPassword,
  showLoginPassword,
  showRegisterPassword,
  loginError,
  isLoginPending,
  isRegistrationPending,
  registerForm,
  captchaQuestion,
  brandName,
  brandTagline,
  brandLogoAlt,
  onSwitchAuthMode,
  onLoginSubmit,
  onRegisterSubmit,
  onLoginEmailChange,
  onLoginPasswordChange,
  onToggleLoginPassword,
  onToggleRegisterPassword,
  onRegisterFormChange,
  onRefreshCaptcha
}: LoginShellProps) {
  const isAuthPending = isLoginPending || isRegistrationPending;

  return (
    <main className="loginShell">
      {!registrationEnabled ? (
        <div className="loginNotice" role="status" aria-live="polite">
          <Info size={17} />
          <span>
            The website is currently invitation only. To request an invitation, write to{" "}
            <a href="mailto:francesco.wanderlingh@unige.it">francesco.wanderlingh@unige.it</a>.
          </span>
        </div>
      ) : null}

      <section className="loginPanel">
        <div className="brandBlock loginBrand">
          <div className="brandMark brandMarkImage">
            <img src="/icon.svg" alt={brandLogoAlt} width={30} height={30} />
          </div>
          <div>
            <strong>{brandName}</strong>
            <span>{brandTagline}</span>
          </div>
        </div>

        <div className={registrationEnabled ? "segmented authTabs" : "segmented authTabs singleAuthTab"}>
          <button className={authMode === "signIn" ? "active" : ""} type="button" disabled={isAuthPending} onClick={() => onSwitchAuthMode("signIn")}>
            Sign In
          </button>
          {registrationEnabled ? (
            <button className={authMode === "register" ? "active" : ""} type="button" disabled={isAuthPending} onClick={() => onSwitchAuthMode("register")}>
              Register
            </button>
          ) : null}
        </div>

        {authMode === "signIn" ? (
          <form className="loginForm" aria-busy={isLoginPending} onSubmit={onLoginSubmit}>
            <div>
              <p className="eyebrow">Sign in</p>
              <h1>Continue to your review dashboard</h1>
              <p className="subtle">Use an existing account to see review memberships, profiles, and project access.</p>
            </div>
            <label>
              <span>Email</span>
              <input value={loginEmail} autoComplete="email" disabled={isLoginPending} onChange={(event) => onLoginEmailChange(event.target.value)} />
            </label>
            <label>
              <span>Password</span>
              <div className="passwordField">
                <input
                  type={showLoginPassword ? "text" : "password"}
                  value={loginPassword}
                  autoComplete="current-password"
                  disabled={isLoginPending}
                  onChange={(event) => onLoginPasswordChange(event.target.value)}
                />
                <button
                  type="button"
                  title={showLoginPassword ? "Hide password" : "Show password"}
                  aria-label={showLoginPassword ? "Hide password" : "Show password"}
                  disabled={isLoginPending}
                  onClick={onToggleLoginPassword}
                >
                  {showLoginPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {loginError ? (
              <div className="validationItem blocked">
                <AlertTriangle size={17} />
                <span>{loginError}</span>
              </div>
            ) : null}
            <button className="primaryButton" type="submit" disabled={isLoginPending}>
              {isLoginPending ? <span className="inlineSpinner" aria-hidden="true" /> : <LogIn size={17} />}
              {isLoginPending ? "Signing in..." : "Sign In"}
            </button>
          </form>
        ) : (
          <form className="loginForm" aria-busy={isRegistrationPending} onSubmit={onRegisterSubmit}>
            <div>
              <p className="eyebrow">Register</p>
              <h1>Create a reviewer account</h1>
              <p className="subtle">Registration creates a server account. You can create a review immediately after signing up.</p>
            </div>
            <label>
              <span>Name</span>
              <input value={registerForm.name} autoComplete="name" disabled={isRegistrationPending} onChange={(event) => onRegisterFormChange("name", event.target.value)} />
            </label>
            <label>
              <span>Email</span>
              <input value={registerForm.email} autoComplete="email" disabled={isRegistrationPending} onChange={(event) => onRegisterFormChange("email", event.target.value)} />
            </label>
            <label>
              <span>Organization</span>
              <input value={registerForm.organization} autoComplete="organization" disabled={isRegistrationPending} onChange={(event) => onRegisterFormChange("organization", event.target.value)} />
            </label>
            <label>
              <span>Role title</span>
              <input value={registerForm.title} disabled={isRegistrationPending} onChange={(event) => onRegisterFormChange("title", event.target.value)} />
            </label>
            <label>
              <span>Password</span>
              <div className="passwordField">
                <input
                  type={showRegisterPassword ? "text" : "password"}
                  value={registerForm.password}
                  autoComplete="new-password"
                  disabled={isRegistrationPending}
                  onChange={(event) => onRegisterFormChange("password", event.target.value)}
                />
                <button
                  type="button"
                  title={showRegisterPassword ? "Hide password" : "Show password"}
                  aria-label={showRegisterPassword ? "Hide password" : "Show password"}
                  disabled={isRegistrationPending}
                  onClick={onToggleRegisterPassword}
                >
                  {showRegisterPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            <label>
              <span>Captcha</span>
              <div className="captchaField">
                <strong>{captchaQuestion ?? "Loading..."}</strong>
                <input inputMode="numeric" value={registerForm.captchaAnswer} disabled={isRegistrationPending} onChange={(event) => onRegisterFormChange("captchaAnswer", event.target.value)} />
                <button type="button" disabled={isRegistrationPending} onClick={onRefreshCaptcha}>
                  Refresh
                </button>
              </div>
            </label>
            {isRegistrationPending ? (
              <div className="validationItem muted" role="status" aria-live="polite">
                <span className="inlineSpinner" aria-hidden="true" />
                <span>Creating account...</span>
              </div>
            ) : loginError ? (
              <div className="validationItem blocked">
                <AlertTriangle size={17} />
                <span>{loginError}</span>
              </div>
            ) : null}
            <button className="primaryButton" type="submit" disabled={isRegistrationPending}>
              {isRegistrationPending ? <span className="inlineSpinner" aria-hidden="true" /> : <PenLine size={17} />}
              {isRegistrationPending ? "Creating account..." : "Register"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
