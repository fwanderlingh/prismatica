import type { LucideIcon } from "lucide-react";
import { PanelRight } from "lucide-react";
import type { AppUser, ReviewProject, ViewKey } from "@/lib/prismaData";
import { Badge } from "@/components/prisma-review-ui";

type NavItem = {
  key: ViewKey;
  label: string;
  path: string;
  Icon?: LucideIcon;
};

type AppSidebarProps = {
  brandName: string;
  brandTagline: string;
  brandLogoAlt: string;
  isSidebarCollapsed: boolean;
  isMobileNavOpen: boolean;
  isProjectView: boolean;
  activeView: ViewKey;
  currentUser: AppUser;
  selectedProject: ReviewProject;
  globalNavItems: NavItem[];
  projectNavItems: NavItem[];
  reviewPhaseNavKeys: Set<ViewKey>;
  exportFailedCount: number;
  getPhaseNavState: (key: ViewKey, stage: ReviewProject["stage"]) => "done" | "current" | "pending" | null;
  canNavigateToProjectView: (key: ViewKey) => boolean;
  formatProjectPhase: (stage: ReviewProject["stage"]) => string;
  projectPhaseBadgeTone: (stage: ReviewProject["stage"]) => "success" | "warning" | "danger" | "info" | "neutral";
  onGoDashboard: () => void;
  onNavigate: (view: ViewKey) => void;
  onToggleSidebar: () => void;
  onToggleMobileNav: () => void;
};

export function AppSidebar({
  brandName,
  brandTagline,
  brandLogoAlt,
  isSidebarCollapsed,
  isMobileNavOpen,
  isProjectView,
  activeView,
  currentUser,
  selectedProject,
  globalNavItems,
  projectNavItems,
  reviewPhaseNavKeys,
  exportFailedCount,
  getPhaseNavState,
  canNavigateToProjectView,
  formatProjectPhase,
  projectPhaseBadgeTone,
  onGoDashboard,
  onNavigate,
  onToggleSidebar,
  onToggleMobileNav
}: AppSidebarProps) {
  const homeItem = globalNavItems.find((item) => item.key === "dashboard");
  const activeProjectNavKey = getProjectNavKey(activeView);

  return (
    <aside className={["sidebar", isMobileNavOpen ? "open" : "", isSidebarCollapsed ? "collapsed" : ""].filter(Boolean).join(" ")} aria-label="Project navigation">
      <div className="sidebarHeader">
        <button className="brandBlock brandButton" type="button" title="Go to homepage" onClick={onGoDashboard}>
          <div className="brandMark brandMarkImage">
            <img src="/icon.svg" alt={brandLogoAlt} width={30} height={30} />
          </div>
          <div>
            <strong>{brandName}</strong>
            <span>{brandTagline}</span>
          </div>
        </button>
        <button
          className="ghostButton iconOnly desktopNavToggle"
          type="button"
          title={isSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={isSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!isSidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <PanelRight size={18} />
        </button>
        <button
          className="ghostButton iconOnly mobileNavToggle"
          type="button"
          title={isMobileNavOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={isMobileNavOpen}
          onClick={onToggleMobileNav}
        >
          <PanelRight size={18} />
        </button>
      </div>

      <nav className="navList">
        {isProjectView ? (
          <>
            {homeItem ? (
              <button
                className={["navItem", "navItemUtility", activeView === "dashboard" ? "active" : ""].filter(Boolean).join(" ")}
                type="button"
                data-tooltip="Home"
                aria-current={activeView === "dashboard" ? "page" : undefined}
                onClick={onGoDashboard}
                title={homeItem.path}
              >
                {homeItem.Icon ? <homeItem.Icon size={18} /> : <span className="navAvatar" style={{ background: currentUser.avatarColor }}>{currentUser.initials}</span>}
                <span className="navLabel">Home</span>
              </button>
            ) : null}

            <div className="navSection">
              <span className="navSectionTitle">Review Phases</span>
              {projectNavItems
                .filter((item) => reviewPhaseNavKeys.has(item.key))
                .map(({ key, label, path, Icon }) => {
                  const phaseState = getPhaseNavState(key, selectedProject.stage);
                  const isLocked = !canNavigateToProjectView(key);
                  const effectivePhaseState = isLocked ? "pending" : phaseState;
                  const navClassName = ["navItem", "navItemPhase", activeProjectNavKey === key ? "active" : "", effectivePhaseState ? `phase-${effectivePhaseState}` : "", isLocked ? "phase-locked" : ""]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      className={navClassName}
                      type="button"
                      key={key}
                      data-tooltip={label}
                      aria-current={activeProjectNavKey === key ? "page" : undefined}
                      aria-disabled={isLocked || undefined}
                      disabled={isLocked}
                      onClick={() => onNavigate(key)}
                      title={isLocked ? `Previous phase incomplete` : phaseState ? `${phaseState === "current" ? "Current phase" : phaseState}` : path}
                    >
                      {Icon ? <Icon size={18} /> : <span className="navAvatar" style={{ background: currentUser.avatarColor }}>{currentUser.initials}</span>}
                      <span className="navLabel">{label}</span>
                      {effectivePhaseState ? <i className="navPhaseMarker" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
            </div>

            <div className="navSection">
              <span className="navSectionTitle">Project Utilities</span>
              {projectNavItems
                .filter((item) => !reviewPhaseNavKeys.has(item.key))
                .map(({ key, label, path, Icon }) => {
                  const phaseState = getPhaseNavState(key, selectedProject.stage);
                  const navClassName = ["navItem", "navItemUtility", activeProjectNavKey === key ? "active" : "", phaseState ? `phase-${phaseState}` : ""]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      className={navClassName}
                      type="button"
                      key={key}
                      data-tooltip={label}
                      aria-current={activeProjectNavKey === key ? "page" : undefined}
                      onClick={() => onNavigate(key)}
                      title={phaseState ? `${path} · ${phaseState === "current" ? "current phase" : phaseState}` : path}
                    >
                      {Icon ? <Icon size={18} /> : <span className="navAvatar" style={{ background: currentUser.avatarColor }}>{currentUser.initials}</span>}
                      <span className="navLabel">{label}</span>
                      {key === "exports" && exportFailedCount > 0 ? <span className="navWarnBadge">{exportFailedCount}</span> : null}
                      {phaseState ? <i className="navPhaseMarker" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
            </div>
          </>
        ) : (
          globalNavItems
            .filter((item) => !["profile", "about"].includes(item.key))
            .filter((item) => !["adminReviews", "registeredUsers"].includes(item.key) || currentUser.isAdmin)
            .map(({ key, label, path, Icon }) => {
              const navClassName = ["navItem", activeView === key ? "active" : ""].filter(Boolean).join(" ");
              return (
                <button
                  className={navClassName}
                  type="button"
                  key={key}
                  data-tooltip={label}
                  aria-current={activeView === key ? "page" : undefined}
                  onClick={() => onNavigate(key)}
                  title={path}
                >
                  {Icon ? <Icon size={18} /> : <span className="navAvatar" style={{ background: currentUser.avatarColor }}>{currentUser.initials}</span>}
                  <span className="navLabel">{label}</span>
                </button>
              );
            })
        )}
      </nav>
    </aside>
  );
}

function getProjectNavKey(view: ViewKey) {
  if (view === "screeningReviewed") {
    return "screening";
  }
  if (view === "fullTextReviewed") {
    return "fullText";
  }
  if (view === "extractionReviewed") {
    return "extraction";
  }
  return view;
}
