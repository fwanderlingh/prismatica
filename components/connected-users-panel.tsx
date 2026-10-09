import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import type { UserPresenceSnapshot } from "@/lib/userPresence";
import { SectionTitle } from "@/components/prisma-review-ui";

export function ConnectedUsersPanel({ currentUserId }: { currentUserId: string }) {
  const [snapshot, setSnapshot] = useState<UserPresenceSnapshot | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        const response = await fetch("/api/admin/connected-users", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw new Error("Presence unavailable");
        const result = await response.json() as UserPresenceSnapshot;
        if (!controller.signal.aborted) { setSnapshot(result); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, []);

  const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, {
    timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date(value));
  const others = snapshot?.users.filter(user => user.id !== currentUserId).length ?? 0;
  return (
    <section className="panel">
      <SectionTitle icon={Users} title="Connected Users" action={error ? "Unavailable" : snapshot ? `${snapshot.users.length} signed in` : "Loading..."} />
      <p className="subtle">Signed-in browsers report once per minute and expire after five minutes without a report. This list refreshes every minute and includes you. Closed, disconnected, or sleeping browsers may remain briefly; anonymous visitors are not included.</p>
      {error ? <p role="status">Connection monitoring is unavailable. {snapshot ? `Last successful check: ${formatTime(snapshot.checkedAt)} (Rome time). The list below may be outdated.` : "The current number of connected users is unknown."}</p> : snapshot ? (
        <p role="status">{others === 0 ? "No other signed-in users have reported a connection in the last five minutes." : `${others} other signed-in user${others === 1 ? " has" : "s have"} reported a connection in the last five minutes.`} Checked at {formatTime(snapshot.checkedAt)} (Rome time).</p>
      ) : <p role="status">Checking connected users...</p>}
      {snapshot && snapshot.users.length > 0 ? (
        <div className="tableWrap">
          <table>
            <thead><tr><th>User</th><th>Email</th><th>Browser sessions</th><th>Last seen (Rome time)</th></tr></thead>
            <tbody>{snapshot.users.map(user => (
              <tr key={user.id}><td>{user.name}{user.id === currentUserId ? " (you)" : ""}</td><td>{user.email}</td><td>{user.sessions}</td><td>{formatTime(user.lastSeenAt)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
