"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { PageLink, ViewLink } from "@/components/navigation-link";
import { getMenuItemIndex } from "@/lib/keyboardNavigation";
import { LoadProgress } from "./load-progress";
import { ChevronDown, ChevronRight, Info, PanelRight, UserCircle } from "lucide-react";

type BreadcrumbItem = {
  label: string;
  current?: boolean;
  onClick?: () => void;
  href?: string;
};

type AppShellProps = {
  pageKey: string;
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
  pageKey,
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
  const userMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const navTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const previousPageRef = useRef(pageKey);
  const initialMenuFocus = useRef<"first" | "last">("first");
  const firstName = currentUser.name.trim().split(/\s+/)[0] ?? currentUser.name;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && isMobileNavOpen && window.matchMedia("(max-width: 860px)").matches) {
        event.preventDefault();
        onToggleMobileNav();
        navTriggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileNavOpen, onToggleMobileNav]);

  useEffect(() => {
    if (isUserMenuOpen) focusMenuItem(initialMenuFocus.current);
  }, [isUserMenuOpen]);

  useEffect(() => {
    if (isMobileNavOpen && window.matchMedia("(max-width: 860px)").matches) {
      document.querySelector<HTMLElement>('#project-navigation a.navItem')?.focus();
    }
  }, [isMobileNavOpen]);

  useEffect(() => {
    if (previousPageRef.current !== pageKey) {
      previousPageRef.current = pageKey;
      setIsUserMenuOpen(false);
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [pageKey]);

  function focusMenuItem(position: "first" | "last") {
    const items = userMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (items?.length) items[position === "first" ? 0 : items.length - 1].focus();
  }

  function openUserMenu(position: "first" | "last" = "first") {
    initialMenuFocus.current = position;
    if (isUserMenuOpen) focusMenuItem(position);
    setIsUserMenuOpen(true);
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === " ") {
      event.preventDefault();
      (document.activeElement as HTMLElement)?.click();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsUserMenuOpen(false);
      userMenuTriggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const focusable = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]'))
        .filter((element) => !element.closest('[role="menu"]') && element.getClientRects().length > 0);
      const triggerIndex = focusable.indexOf(userMenuTriggerRef.current!);
      setIsUserMenuOpen(false);
      (focusable[triggerIndex + (event.shiftKey ? -1 : 1)] ?? mainRef.current)?.focus();
      return;
    }
    const items = Array.from(userMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = getMenuItemIndex(event.key, items.indexOf(document.activeElement as HTMLElement), items.map((item) => item.textContent ?? ""));
    if (index !== undefined) {
      event.preventDefault();
      items[index]?.focus();
    }
  }

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
      <a className="skipLink" href="#main-content" onClick={() => mainRef.current?.focus()}>Skip to main content</a>
      <header className="contentHeader">
        <div className="contentHeaderNavCluster">
          <button
            className="ghostButton iconOnly topbarNavToggle"
            type="button"
            title={isMobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-label={isMobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={isMobileNavOpen}
            aria-controls="project-navigation"
            ref={navTriggerRef}
            onClick={onToggleMobileNav}
          >
            <PanelRight size={18} />
          </button>

          <nav className="breadcrumbBar" aria-label="Breadcrumb">
            {breadcrumbItems.map((item, index) => (
              <div className="breadcrumbItem" key={`${item.label}-${index}`}>
                {item.href && !item.current ? (
                  <PageLink className="breadcrumbLink" href={item.href} onNavigate={item.onClick}>
                    {item.label}
                  </PageLink>
                ) : (
                  <span className={item.current ? "breadcrumbCurrent" : "breadcrumbText"} aria-current={item.current ? "page" : undefined}>{item.label}</span>
                )}
                {index < breadcrumbItems.length - 1 ? <ChevronRight className="breadcrumbDivider" size={15} aria-hidden="true" /> : null}
              </div>
            ))}
          </nav>
        </div>

        <ViewLink className="brandButton topbarBrand" view="dashboard" title="Go to homepage" onNavigate={onGoDashboard}>
          <div className="brandMark brandMarkImage">
            <img src="/icon.svg" alt={brandLogoAlt} width={30} height={30} />
          </div>
        </ViewLink>

        <div className="contentHeaderActions">
          <div className={isUserMenuOpen ? "userMenu open" : "userMenu"} ref={userMenuRef} onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsUserMenuOpen(false);
          }}>
            <button
              className="ghostButton userMenuTrigger"
              type="button"
              aria-haspopup="menu"
              aria-label={`Account menu for ${currentUser.name}`}
              aria-expanded={isUserMenuOpen}
              aria-controls="user-navigation-menu"
              ref={userMenuTriggerRef}
              onClick={() => isUserMenuOpen ? setIsUserMenuOpen(false) : openUserMenu()}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  openUserMenu(event.key === "ArrowUp" ? "last" : "first");
                }
              }}
            >
              <span className="navAvatar" style={{ background: currentUser.avatarColor }}>{currentUser.initials}</span>
              <span className="userMenuLabel">{firstName}</span>
              <ChevronDown size={16} />
            </button>

            {isUserMenuOpen ? (
              <div className="userMenuPopover" id="user-navigation-menu" role="menu" aria-label="User menu" onKeyDown={handleMenuKeyDown}>
                <ViewLink className="userMenuItem" view="profile" role="menuitem" tabIndex={-1} onNavigate={handleProfileClick}>
                  <UserCircle size={17} />
                  Profile
                </ViewLink>
                <ViewLink className="userMenuItem" view="about" role="menuitem" tabIndex={-1} onNavigate={handleAboutClick}>
                  <Info size={17} />
                  About
                </ViewLink>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {sidebar}
      <main id="main-content" ref={mainRef} tabIndex={-1} className={isMainPending ? "mainArea mainAreaPending" : "mainArea"} aria-busy={isMainPending}>
        {children}
        {isMainPending ? (
          <div className="mainLoadingOverlay" role="status" aria-live="polite">
            <div className="mainLoadingPanel">
              <span className="mainLoadingSpinner" aria-hidden="true" />
              <LoadProgress label={mainPendingLabel} detail="Preparing the requested page. Larger reviews may take longer." />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
