import type { ReactNode } from "react";

type AppShellProps = {
  isSidebarCollapsed: boolean;
  sidebar: ReactNode;
  children: ReactNode;
};

export function AppShell({ isSidebarCollapsed, sidebar, children }: AppShellProps) {
  return (
    <div className={isSidebarCollapsed ? "appFrame sidebar-collapsed" : "appFrame"}>
      {sidebar}
      <main className="mainArea">{children}</main>
    </div>
  );
}
