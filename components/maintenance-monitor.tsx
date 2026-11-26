"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { MaintenanceStatus } from "@/lib/maintenance";

// Catch maintenance changes even in tabs that are already open or use cached routes.
export function MaintenanceMonitor() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === "/sign-in") return;
    const controller = new AbortController();
    let checking = false;
    async function check() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const response = await fetch("/api/maintenance", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const status = await response.json() as MaintenanceStatus;
        if (!controller.signal.aborted && status.enabled && !status.canBypass) window.location.replace("/maintenance");
      } catch {
        // Keep the current page if the network is temporarily unavailable.
      } finally {
        checking = false;
      }
    }
    void check();
    const interval = window.setInterval(() => void check(), 30_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [pathname]);
  return null;
}
