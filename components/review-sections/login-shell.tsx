import { AlertTriangle, Eye, EyeOff, Info, LogIn, PenLine } from "lucide-react";
import type { FormEvent } from "react";
import type { AuthMode, RegisterForm } from "@/components/use-auth-state";

type LoginShellProps = {
  registrationEnabled: boolean;
  authMode: AuthMode;
  loginEmail: string;
  loginPassword: string;
  showLoginPassword: boolean;
  showRegisterPassword: boolean;
  loginError: string;
  registerForm: RegisterForm;
  captchaQuestion?: string;
  brandName: string;
  brandTagline: string;
  brandLogoAlt: string;
  onSwitchAuthMode: (mode: AuthMode) => void;
  onLoginSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRegisterSubmit: (event: FormEvent<HTMLFormElement>) => void;
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
          <button className={authMode === "signIn" ? "active" : ""} type="button" onClick={() => onSwitchAuthMode("signIn")}>
            Sign In
          </button>
          {registrationEnabled ? (
            <button className={authMode === "register" ? "active" : ""} type="button" onClick={() => onSwitchAuthMode("register")}>
              Register
            </button>
          ) : null}
        </div>

        {authMode === "signIn" ? (
          <form className="loginForm" onSubmit={onLoginSubmit}>
            <div>
              <p className="eyebrow">Sign in</p>
              <h1>Continue to your review dashboard</h1>
              <p className="subtle">Use an existing account to see review memberships, profiles, and project access.</p>
            </div>
            <label>
              <span>Email</span>
              <input value={loginEmail} onChange={(event) => onLoginEmailChange(event.target.value)} />
            </label>
            <label>
              <span>Password</span>
              <div className="passwordField">
                <input type={showLoginPassword ? "text" : "password"} value={loginPassword} onChange={(event) => onLoginPasswordChange(event.target.value)} />
                <button
                  type="button"
                  title={showLoginPassword ? "Hide password" : "Show password"}
                  aria-label={showLoginPassword ? "Hide password" : "Show password"}
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
            <button className="primaryButton" type="submit">
              <LogIn size={17} />
              Sign In
            </button>
          </form>
        ) : (
          <form className="loginForm" onSubmit={onRegisterSubmit}>
            <div>
              <p className="eyebrow">Register</p>
              <h1>Create a reviewer account</h1>
              <p className="subtle">Registration creates a server account. You can create a review immediately after signing up.</p>
            </div>
            <label>
              <span>Name</span>
              <input value={registerForm.name} onChange={(event) => onRegisterFormChange("name", event.target.value)} />
            </label>
            <label>
              <span>Email</span>
              <input value={registerForm.email} onChange={(event) => onRegisterFormChange("email", event.target.value)} />
            </label>
            <label>
              <span>Organization</span>
              <input value={registerForm.organization} onChange={(event) => onRegisterFormChange("organization", event.target.value)} />
            </label>
            <label>
              <span>Role title</span>
              <input value={registerForm.title} onChange={(event) => onRegisterFormChange("title", event.target.value)} />
            </label>
            <label>
              <span>Password</span>
              <div className="passwordField">
                <input
                  type={showRegisterPassword ? "text" : "password"}
                  value={registerForm.password}
                  onChange={(event) => onRegisterFormChange("password", event.target.value)}
                />
                <button
                  type="button"
                  title={showRegisterPassword ? "Hide password" : "Show password"}
                  aria-label={showRegisterPassword ? "Hide password" : "Show password"}
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
                <input inputMode="numeric" value={registerForm.captchaAnswer} onChange={(event) => onRegisterFormChange("captchaAnswer", event.target.value)} />
                <button type="button" onClick={onRefreshCaptcha}>
                  Refresh
                </button>
              </div>
            </label>
            {loginError ? (
              <div className="validationItem blocked">
                <AlertTriangle size={17} />
                <span>{loginError}</span>
              </div>
            ) : null}
            <button className="primaryButton" type="submit">
              <PenLine size={17} />
              Register
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
