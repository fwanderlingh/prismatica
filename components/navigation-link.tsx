"use client";

import Link from "next/link";
import { createContext, useContext, type AnchorHTMLAttributes, type ReactNode } from "react";
import { buildPathForState } from "@/lib/navigation";
import type { ViewKey } from "@/lib/prismaData";

const ProjectNavigationContext = createContext("");

export function NavigationProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  return <ProjectNavigationContext.Provider value={projectId}>{children}</ProjectNavigationContext.Provider>;
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
  const currentProjectId = useContext(ProjectNavigationContext);
  return <PageLink {...props} href={buildPathForState(view, projectId ?? currentProjectId)} />;
}
