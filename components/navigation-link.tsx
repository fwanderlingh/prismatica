"use client";

import Link from "next/link";
import { createContext, useContext, type AnchorHTMLAttributes, type ReactNode } from "react";
import { buildPathForState } from "@/lib/navigation";
import type { ViewKey } from "@/lib/prismaData";

const ProjectNavigationContext = createContext<{ projectId: string; homeView: ViewKey }>({ projectId: "", homeView: "dashboard" });

export function NavigationProvider({ projectId, homeView = "dashboard", children }: { projectId: string; homeView?: "dashboard" | "adminReviews"; children: ReactNode }) {
  return <ProjectNavigationContext.Provider value={{ projectId, homeView }}>{children}</ProjectNavigationContext.Provider>;
}

type PageLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
  href: string;
  onNavigate?: () => void;
  disabled?: boolean;
};

export function PageLink({ href, onNavigate, disabled, children, ...props }: PageLinkProps) {
  if (disabled) return <span {...props} role={props.role ?? "link"} aria-disabled="true" tabIndex={-1}>{children}</span>;
  return (
    <Link {...props} href={href} prefetch={false} onNavigate={(event) => {
      if (onNavigate) {
        event.preventDefault();
        onNavigate();
      }
    }}>{children}</Link>
  );
}

export function ViewLink({ view, projectId, ...props }: Omit<PageLinkProps, "href"> & { view: ViewKey; projectId?: string }) {
  const navigation = useContext(ProjectNavigationContext);
  return <PageLink {...props} href={buildPathForState(view === "dashboard" ? navigation.homeView : view, projectId ?? navigation.projectId)} />;
}
