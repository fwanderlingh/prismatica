"use client";

import type { LoadProgress as Progress } from "@/lib/loadProgress";

export function LoadProgress({ label, detail, percent }: Progress) {
  const value = percent === undefined ? undefined : Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="loadProgress" role="status" aria-live="polite">
      <div className="loadProgressHeading">
        <strong>{label}</strong>
        {value !== undefined ? <span>{value}% of this step</span> : null}
      </div>
      {detail ? <p>{detail}</p> : null}
      <div className={`loadProgressTrack${value === undefined ? " indeterminate" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <i style={value === undefined ? undefined : { width: `${value}%` }} />
      </div>
    </div>
  );
}
