"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Info, PanelRight, UserCircle } from "lucide-react";

type BreadcrumbItem = {
  label: string;
  current?: boolean;
  onClick?: () => void;
};

type AppShellProps = {
  isSidebarCollapsed: boolean;
  isMobileNavOpen: boolean;
  brandLogoAlt: string;
  isMainPending?: boolean;
  mainPendingLabel?: string;
  currentUser: {
    name: string;
    initials: string;
    avatarColor: string;
  };
  breadcrumbItems: BreadcrumbItem[];
  sidebar: ReactNode;
  children: ReactNode;
  onGoDashboard: () => void;
  onNavigateProfile: () => void;
  onNavigateAbout: () => void;
  onToggleMobileNav: () => void;
};

export function AppShell({
  isSidebarCollapsed,
  isMobileNavOpen,
  brandLogoAlt,
  isMainPending = false,
  mainPendingLabel = "Loading workspace",
  currentUser,
  breadcrumbItems,
  sidebar,
  children,
  onGoDashboard,
  onNavigateProfile,
  onNavigateAbout,
  onToggleMobileNav
}: AppShellProps) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const firstName = currentUser.name.trim().split(/\s+/)[0] ?? currentUser.name;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function handleProfileClick() {
    setIsUserMenuOpen(false);
    onNavigateProfile();
  }

  function handleAboutClick() {
    setIsUserMenuOpen(false);
    onNavigateAbout();
  }

  return (
    <div className={isSidebarCollapsed ? "appFrame sidebar-collapsed" : "appFrame"}>
      <header className="contentHeader">
        <div className="contentHeaderNavCluster">
          <button
            className="ghostButton iconOnly topbarNavToggle"
            type="button"
            title={isMobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-label={isMobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={isMobileNavOpen}
            onClick={onToggleMobileNav}
          >
            <PanelRight size={18} />
          </button>

          <nav className="breadcrumbBar" aria-label="Breadcrumb">
            {breadcrumbItems.map((item, index) => (
              <div className="breadcrumbItem" key={`${item.label}-${index}`}>
                {item.onClick && !item.current ? (
                  <button className="breadcrumbLink" type="button" onClick={item.onClick}>
                    {item.label}
                  </button>
                ) : (
                  <span className={item.current ? "breadcrumbCurrent" : "breadcrumbText"}>{item.label}</span>
                )}
                {index < breadcrumbItems.length - 1 ? <ChevronRight className="breadcrumbDivider" size={15} aria-hidden="true" /> : null}
              </div>
            ))}
          </nav>
        </div>

        <button className="brandButton topbarBrand" type="button" title="Go to homepage" onClick={onGoDashboard}>
          <div className="brandMark brandMarkImage">
            <img src="/icon.svg" alt={brandLogoAlt} width={30} height={30} />
          </div>
        </button>

        <div className="contentHeaderActions">
          <div className={isUserMenuOpen ? "userMenu open" : "userMenu"} ref={userMenuRef}>
            <button
              className="ghostButton userMenuTrigger"
              type="button"
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              onClick={() => setIsUserMenuOpen((open) => !open)}
            >
              <span className="navAvatar" style={{ background: currentUser.avatarColor }}>{currentUser.initials}</span>
              <span className="userMenuLabel">{firstName}</span>
              <ChevronDown size={16} />
            </button>

            {isUserMenuOpen ? (
              <div className="userMenuPopover" role="menu" aria-label="User menu">
                <button className="userMenuItem" type="button" role="menuitem" onClick={handleProfileClick}>
                  <UserCircle size={17} />
                  Profile
                </button>
                <button className="userMenuItem" type="button" role="menuitem" onClick={handleAboutClick}>
                  <Info size={17} />
                  About
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {sidebar}
      <main className={isMainPending ? "mainArea mainAreaPending" : "mainArea"} aria-busy={isMainPending}>
        {children}
        {isMainPending ? (
          <div className="mainLoadingOverlay" role="status" aria-live="polite">
            <div className="mainLoadingPanel">
              <span className="mainLoadingSpinner" aria-hidden="true" />
              {/*<div>
                <strong>{mainPendingLabel}</strong>
                <span>Preparing the next view</span>
              </div>*/}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
