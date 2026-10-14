"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export type AccountEmailAction = "forgot-password" | "resend-confirmation" | "verify-email" | "reset-password";

export function AccountEmailForm({ action }: { action: AccountEmailAction }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [token, setToken] = useState("");
  const tokenRead = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const redeem = action === "verify-email" || action === "reset-password";
  const verification = action === "verify-email" || action === "resend-confirmation";
  const title = {
    "forgot-password": "Reset your password",
    "resend-confirmation": "Resend confirmation",
    "verify-email": "Confirm your email",
    "reset-password": "Choose a new password"
  }[action];

  useEffect(() => {
    if (!tokenRead.current) {
      setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
      window.history.replaceState(null, "", window.location.pathname);
      tokenRead.current = true;
    }
    let cancelled = false;
    fetch("/api/auth/config", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const payload = await response.json();
        if (!cancelled) setEnabled(payload.authSettings.transactionalEmailEnabled === true);
      })
      .catch(() => { if (!cancelled) setError("Unable to load account settings. Reload this page to try again."); });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setMessage("");
    if (action === "reset-password" && password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/auth/email/${redeem ? "complete" : "request"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: verification ? "verification" : "password-reset", email, token, password })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to complete the request. Try again.");
      setMessage(payload.message);
      if (redeem) {
        setComplete(true);
        setToken("");
        setPassword("");
        setConfirmation("");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to complete the request. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="loginShell">
      <section className="loginPanel">
        <form className="loginForm" onSubmit={submit} aria-busy={pending}>
          <div><p className="eyebrow">PRISMATICA</p><h1>{title}</h1></div>
          {enabled === null && !error ? <p role="status">Loading account settings...</p> : null}
          {enabled === false ? <p>Email confirmation and recovery are currently disabled. Contact an administrator for password assistance.</p> : null}
          {enabled && !complete ? <>
            {redeem ? (
              !token ? <p>This link is missing its token. Request a new email below.</p> : <p>{verification ? "Confirm that this email address belongs to you." : "Enter your new password. This will sign out your other sessions."}</p>
            ) : <label><span>Email</span><input type="email" autoComplete="email" required maxLength={254} value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} /></label>}
            {action === "reset-password" && token ? <>
              <label><span>New password</span><input type="password" autoComplete="new-password" required minLength={8} maxLength={1024} value={password} disabled={pending} onChange={(event) => setPassword(event.target.value)} /></label>
              <label><span>Confirm new password</span><input type="password" autoComplete="new-password" required minLength={8} maxLength={1024} value={confirmation} disabled={pending} onChange={(event) => setConfirmation(event.target.value)} /></label>
            </> : null}
            <button type="submit" className="primaryButton" disabled={pending || (redeem && !token)}>
              {pending ? "Please wait..." : redeem ? verification ? "Confirm email" : "Save password" : "Send email"}
            </button>
          </> : null}
          {error ? <p className="validationItem blocked" role="alert">{error}</p> : null}
          {message ? <p className="validationItem ok" role="status">{message}</p> : null}
          {enabled && redeem && !complete ? <Link href={verification ? "/account/resend-confirmation" : "/account/forgot-password"}>Request a new email</Link> : null}
          <Link href="/sign-in">Back to sign in</Link>
        </form>
      </section>
    </main>
  );
}
