"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { MaintenanceNotice } from "@/components/maintenance-notice";
import type { MaintenanceStatus } from "@/lib/maintenance";

export function MaintenancePage({ endsAt: initialEndsAt }: { endsAt: string | null }) {
  const [endsAt, setEndsAt] = useState(initialEndsAt);
  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    async function check() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const response = await fetch("/api/maintenance", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const status = await response.json() as MaintenanceStatus;
        if (controller.signal.aborted) return;
        if (!status.enabled) window.location.replace("/dashboard");
        else setEndsAt(status.endsAt);
      } catch {
        // The maintenance notice remains available during temporary network failures.
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
  }, []);

  return (
    <main className="loginShell maintenanceShell">
      <section className="loginPanel maintenancePanel" aria-label="Site maintenance">
        <div className="brandBlock loginBrand">
          <div className="brandMark brandMarkImage"><img src="/icon.svg" alt="PRISMATICA logo" width={30} height={30} /></div>
          <div><strong>PRISMATICA</strong><span>Open source PRISMA review platform</span></div>
        </div>
        <MaintenanceNotice endsAt={endsAt} />
        <div className="maintenanceActions">
          <button type="button" className="ghostButton" onClick={() => window.location.reload()}><RefreshCw size={17} />Check availability</button>
          <a href="/sign-in">Administrator sign in</a>
        </div>
      </section>
    </main>
  );
}
