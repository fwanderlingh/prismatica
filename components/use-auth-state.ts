import { useEffect, useState } from "react";

export type AuthMode = "signIn" | "register";

export type RegisterForm = {
  name: string;
  email: string;
  organization: string;
  title: string;
  password: string;
  captchaAnswer: string;
};

const emptyRegisterForm: RegisterForm = {
  name: "",
  email: "",
  organization: "",
  title: "Reviewer",
  password: "",
  captchaAnswer: ""
};

type UseAuthStateOptions = {
  registrationEnabled: boolean;
  isAuthenticated: boolean;
  hasCaptchaChallenge: boolean;
  loadAuthConfig: () => Promise<void>;
};

export function useAuthState({ registrationEnabled, isAuthenticated, hasCaptchaChallenge, loadAuthConfig }: UseAuthStateOptions) {
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [registerForm, setRegisterForm] = useState<RegisterForm>(emptyRegisterForm);

  useEffect(() => {
    if (!registrationEnabled && authMode === "register") {
      setAuthMode("signIn");
      setLoginError("");
    }
  }, [authMode, registrationEnabled]);

  useEffect(() => {
    if (!isAuthenticated && authMode === "register" && registrationEnabled && !hasCaptchaChallenge) {
      loadAuthConfig().catch(() => undefined);
    }
  }, [authMode, hasCaptchaChallenge, isAuthenticated, loadAuthConfig, registrationEnabled]);

  function switchAuthMode(mode: AuthMode) {
    setAuthMode(mode);
    setLoginError("");
  }

  function toggleLoginPasswordVisibility() {
    setShowLoginPassword((visible) => !visible);
  }

  function toggleRegisterPasswordVisibility() {
    setShowRegisterPassword((visible) => !visible);
  }

  function updateRegisterForm<Key extends keyof RegisterForm>(key: Key, value: RegisterForm[Key]) {
    setRegisterForm((previous) => ({
      ...previous,
      [key]: value
    }));
  }

  function resetRegisterForm() {
    setRegisterForm(emptyRegisterForm);
  }

  function clearRegisterCaptcha() {
    setRegisterForm((previous) => ({ ...previous, captchaAnswer: "" }));
  }

  function applySuccessfulRegistration(email: string, password: string) {
    setLoginEmail(email);
    setLoginPassword(password);
    resetRegisterForm();
  }

  function clearLoginPassword() {
    setLoginPassword("");
  }

  return {
    authMode,
    loginEmail,
    loginPassword,
    showLoginPassword,
    showRegisterPassword,
    loginError,
    registerForm,
    setLoginEmail,
    setLoginPassword,
    setLoginError,
    switchAuthMode,
    toggleLoginPasswordVisibility,
    toggleRegisterPasswordVisibility,
    updateRegisterForm,
    resetRegisterForm,
    clearRegisterCaptcha,
    applySuccessfulRegistration,
    clearLoginPassword
  };
}