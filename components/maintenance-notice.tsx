"use client";

import { useEffect, useState } from "react";
import { Clock, Wrench } from "lucide-react";
import { formatMaintenanceEnd } from "@/lib/maintenance";

export function MaintenanceNotice({ endsAt }: { endsAt: string | null }) {
  const [timeZone, setTimeZone] = useState("UTC");
  useEffect(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);

  return (
    <div className="maintenanceNotice">
      <span className="maintenanceIcon" aria-hidden="true"><Wrench size={30} /></span>
      <p className="eyebrow">Maintenance in progress</p>
      <h1>We’ll be back soon</h1>
      <p>PRISMATICA is temporarily unavailable while we carry out maintenance. Thank you for your patience.</p>
      {endsAt ? (
        <div className="maintenanceEnd">
          <Clock size={19} aria-hidden="true" />
          <div>
            <strong>Expected to be available again</strong>
            <time dateTime={endsAt}>{formatMaintenanceEnd(endsAt, timeZone)}</time>
          </div>
        </div>
      ) : null}
      <p className="subtle">This is an estimated completion time. This page will check automatically for updates.</p>
    </div>
  );
}
