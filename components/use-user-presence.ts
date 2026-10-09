import { useEffect } from "react";

export function useUserPresence(userId: string | null) {
  useEffect(() => {
    if (!userId) return;
    let pending = false;
    const controller = new AbortController();
    const heartbeat = async () => {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        await fetch("/api/presence", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal });
      } catch {
        // Retry on the next heartbeat without interrupting review work.
      } finally {
        pending = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void heartbeat(); };
    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", heartbeat);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", heartbeat);
    };
  }, [userId]);
}
