"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ClipboardCheck,
  Database,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FileSearch,
  FileText,
  FlaskConical,
  FolderPlus,
  GitMerge,
  History,
  Home,
  Info,
  Import,
  LayoutDashboard,
  ListChecks,
  LogIn,
  LogOut,
  Lock,
  MessageSquareText,
  Minus,
  PenLine,
  PanelRight,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  UserCircle,
  UserRoundCheck,
  Users,
  X,
  XCircle,
  ZoomIn
} from "lucide-react";
import {
  dedupCandidates as seedDedupCandidates,
  highlightRules,
  initialDecisions,
  initialWorkflowEvents,
  projectCounts as seedProjectCounts,
  prismaCounts,
  qualityDomains,
  reportQueue,
  roleRows,
  reviewProjects,
  type AppUser,
  screeningStudies,
  type DedupCandidate,
  type Decision,
  type ExtractionFieldType,
  type ExtractionConsensus,
  type ExtractionResponse,
  type ExtractionResponseValue,
  type ExtractionTemplate,
  type ImportBatch,
  type ProjectWorkflowConflict,
  type PrismaCounts,
  type ReviewProject,
  type Report,
  type Study,
  type WebsiteTheme,
  type ViewKey,
  type WorkflowEvent
} from "@/lib/prismaData";
import type { ApiErrorPayload, AppAuthSettings, AppMutationPayload, AppStatePayload, PublicAuthConfigPayload } from "@/lib/apiTypes";
import { evaluateStage, type DecisionValue, type StageEvaluation } from "@/lib/workflow";
import {
  Badge,
  EmptyState,
  Metric,
  PrismaFlow,
  RecordComparison,
  ScoreBar,
  SectionTitle,
  StatusRow,
  renderDoiLink
} from "./prisma-review-ui";
import { FullTextSection } from "./review-sections/full-text-section";
import { ExtractionSection } from "./review-sections/extraction-section";
import { ConsensusSection } from "./review-sections/consensus-section";
import { DashboardSection } from "./review-sections/dashboard-section";
import { ProjectDashboardSection } from "./review-sections/project-dashboard-section";
import { ExportsSection } from "./review-sections/exports-section";
import { AuditTrailSection } from "./review-sections/audit-trail-section";
import { AboutSection } from "./review-sections/about-section";
import { AdminReviewsSection } from "./review-sections/admin-reviews-section";
import { RegisteredUsersSection } from "./review-sections/registered-users-section";
import { ImportEditorSection } from "./review-sections/import-editor-section";
import { ImportsSection } from "./review-sections/imports-section";
import { DedupSection } from "./review-sections/dedup-section";
import { ScreeningSection } from "./review-sections/screening-section";
import { RiskSection } from "./review-sections/risk-section";
import { LoginShell } from "./review-sections/login-shell";
import { AppSidebar } from "./review-sections/app-sidebar";
import { AppShell } from "./review-sections/app-shell";
import { SettingsSection } from "./review-sections/settings-section";
import { ProfileSection, type ProfileSaveAction } from "./review-sections/profile-section";
import { NewProjectSection, type NewProjectInviteDraft } from "./review-sections/new-project-section";
import { useNewProjectState, type NewProjectForm } from "./use-new-project-state";
import { useAuthState } from "./use-auth-state";

type NavItem = {
  key: ViewKey;
  label: string;
  path: string;
  Icon?: LucideIcon;
};

type DecisionAction = {
  studyId: string;
  previousDecisionId?: string;
};

type FormSubmitEvent = {
  preventDefault: () => void;
};

type WorkflowConflict = ProjectWorkflowConflict & {
  studyIndex?: number;
};

const numberFormatter = new Intl.NumberFormat("en-US");
const AUDIT_PAGE_SIZE = 10;
const BRAND_NAME = "PRISMATICA";
const BRAND_TAGLINE = "Open source PRISMA review platform";
const BRAND_LOGO_ALT = `${BRAND_NAME} logo`;
const defaultAuthSettings: AppAuthSettings = {
  registrationEnabled: true,
  screeningCheckoutWindowMinutes: 2,
  extractionCheckoutWindowMinutes: 15
};

const globalNavItems: NavItem[] = [
  { key: "dashboard", label: "All Reviews", path: "/dashboard", Icon: Home },
  { key: "newProject", label: "New Review", path: "/projects/new", Icon: FolderPlus },
  { key: "adminReviews", label: "Review Admin", path: "/admin/reviews", Icon: LayoutDashboard },
  { key: "registeredUsers", label: "Registered Users", path: "/admin/users", Icon: Users },
  { key: "profile", label: "Profile", path: "/profile" },
  { key: "about", label: "About", path: "/about", Icon: Info }
];

const projectNavItems: NavItem[] = [
  { key: "projectDashboard", label: "Overview", path: "/project/current/dashboard", Icon: LayoutDashboard },
  { key: "imports", label: "Imports", path: "/project/current/imports", Icon: Import },
  { key: "dedup", label: "Dedup", path: "/project/current/dedup", Icon: GitMerge },
  { key: "screening", label: "Screening", path: "/project/current/screen/title-abstract", Icon: FileSearch },
  { key: "fullText", label: "Full Text", path: "/project/current/full-text", Icon: BookOpen },
  { key: "extraction", label: "Extraction", path: "/project/current/extraction", Icon: ClipboardCheck },
  { key: "consensus", label: "Consensus", path: "/project/current/extraction/consensus", Icon: GitMerge },
  //{ key: "risk", label: "Risk of Bias", path: "/project/current/risk-of-bias", Icon: ShieldCheck },
  { key: "exports", label: "Exports", path: "/project/current/exports", Icon: Download },
  { key: "audit", label: "Audit", path: "/project/current/audit", Icon: History },
  { key: "settings", label: "Settings", path: "/project/current/settings", Icon: Settings }
];

const globalViewKeys: ViewKey[] = ["dashboard", "newProject", "about", "adminReviews", "registeredUsers", "profile"];
const reviewPhaseNavKeys = new Set<ViewKey>(["imports", "dedup", "screening", "fullText", "extraction", "consensus"]);
const viewKeySet = new Set<ViewKey>([
  "dashboard",
  "projectDashboard",
  "imports",
  "dedup",
  "screening",
  "fullText",
  "extraction",
  "consensus",
  "risk",
  "exports",
  "audit",
  "settings",
  "newProject",
  "about",
  "adminReviews",
  "registeredUsers",
  "profile"
]);

function isViewKey(value: string | null): value is ViewKey {
  return value !== null && viewKeySet.has(value as ViewKey);
}

function isProjectScopedView(view: ViewKey) {
  return !globalViewKeys.includes(view);
}

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function buildPathForState(view: ViewKey, projectId: string) {
  switch (view) {
    case "dashboard":
      return "/";
    case "newProject":
      return "/projects/new";
    case "about":
      return "/about";
    case "adminReviews":
      return "/admin/reviews";
    case "registeredUsers":
      return "/admin/users";
    case "profile":
      return "/profile";
    case "projectDashboard":
      return `/projects/${encodeURIComponent(projectId)}`;
    case "imports":
      return `/projects/${encodeURIComponent(projectId)}/imports`;
    case "dedup":
      return `/projects/${encodeURIComponent(projectId)}/dedup`;
    case "screening":
      return `/projects/${encodeURIComponent(projectId)}/screening`;
    case "fullText":
      return `/projects/${encodeURIComponent(projectId)}/full-text`;
    case "extraction":
      return `/projects/${encodeURIComponent(projectId)}/extraction`;
    case "consensus":
      return `/projects/${encodeURIComponent(projectId)}/extraction/consensus`;
    case "risk":
      return `/projects/${encodeURIComponent(projectId)}/risk`;
    case "exports":
      return `/projects/${encodeURIComponent(projectId)}/exports`;
    case "audit":
      return `/projects/${encodeURIComponent(projectId)}/audit`;
    case "settings":
      return `/projects/${encodeURIComponent(projectId)}/settings`;
    default:
      return "/";
  }
}

function getViewLabel(view: ViewKey) {
  return globalNavItems.find((item) => item.key === view)?.label ?? projectNavItems.find((item) => item.key === view)?.label ?? "Review";
}

function parseRouteState(pathname: string, search: string): { view: ViewKey; projectId?: string } {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === "/") {
    return { view: "dashboard" };
  }
  if (normalizedPath === "/projects/new") {
    return { view: "newProject" };
  }
  if (normalizedPath === "/about") {
    return { view: "about" };
  }
  if (normalizedPath === "/admin/reviews") {
    return { view: "adminReviews" };
  }
  if (normalizedPath === "/admin/users") {
    return { view: "registeredUsers" };
  }
  if (normalizedPath === "/profile") {
    return { view: "profile" };
  }

  const parts = normalizedPath.split("/").filter(Boolean);
  if (parts[0] === "projects" && parts[1] && parts[1] !== "new") {
    const routeKey = parts.slice(2).join("/");
    const routeViewMap: Record<string, ViewKey> = {
      "": "projectDashboard",
      imports: "imports",
      dedup: "dedup",
      screening: "screening",
      "screen/title-abstract": "screening",
      "full-text": "fullText",
      extraction: "extraction",
      "extraction/consensus": "consensus",
      risk: "risk",
      exports: "exports",
      audit: "audit",
      settings: "settings"
    };

    return {
      view: routeViewMap[routeKey] ?? "projectDashboard",
      projectId: decodeURIComponent(parts[1])
    };
  }

  // Backward compatibility for links using query params.
  const params = new URLSearchParams(search);
  const requestedView = params.get("view");
  const requestedProjectId = params.get("projectId");

  return {
    view: isViewKey(requestedView) ? requestedView : "dashboard",
    projectId: requestedProjectId ?? undefined
  };
}

function sanitizeRedirectTarget(redirectTarget: string | null) {
  if (!redirectTarget) {
    return null;
  }

  try {
    const url = new URL(redirectTarget, window.location.origin);
    if (url.origin !== window.location.origin) {
      return null;
    }

    const normalizedPath = normalizePathname(url.pathname);
    if (normalizedPath === "/sign-in") {
      return null;
    }

    return `${normalizedPath}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

type ProjectSettingsForm = Omit<NewProjectForm, "memberIds">;

type ImportDetailForm = {
  sourceName: string;
  filename: string;
};

type StudyEditForm = {
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi: string;
  keywords: string;
  abstract: string;
};

type ExtractionTemplateFieldForm = {
  id: string;
  title: string;
  type: ExtractionFieldType;
  optionsText: string;
};

type ExtractionTemplateForm = {
  title: string;
  fields: ExtractionTemplateFieldForm[];
};

type ProjectUserStats = {
  user: AppUser;
  screened: number;
  uploadedPdf: number;
  fullTextReviews: number;
  extractions: number;
};

type PhaseNavState = "done" | "current" | "pending";
type PhaseAccessMap = Partial<Record<ViewKey, boolean>>;
type ProjectPhaseProgress = {
  percent: number;
  label: string;
};

const exclusionReasons = Object.keys(prismaCounts.reportsExcludedWithReasons);

const emptyProjectSettingsForm: ProjectSettingsForm = {
  title: "",
  organization: "",
  protocolId: "",
  description: "",
  searchStrategies: "",
  dueDate: "",
  blindMode: true,
  abstractRequiredVotes: 2,
  fullTextRequiredVotes: 2,
  extractionRequiredVotes: 2,
  maybePolicy: "advance_to_full_text",
  requireSequentialPhases: true
};

const emptyImportDetailForm: ImportDetailForm = {
  sourceName: "",
  filename: ""
};

const emptyStudyEditForm: StudyEditForm = {
  title: "",
  authors: "",
  journal: "",
  year: "",
  doi: "",
  keywords: "",
  abstract: ""
};

function createClientId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBlankExtractionField(type: ExtractionFieldType = "multiline_text"): ExtractionTemplateFieldForm {
  return {
    id: createClientId("field"),
    title: "",
    type,
    optionsText: type === "multiline_text" ? "" : "Yes\nNo"
  };
}

const emptyExtractionTemplateForm: ExtractionTemplateForm = {
  title: "Data Template",
  fields: [
    {
      id: "field-initial",
      title: "",
      type: "multiline_text",
      optionsText: ""
    }
  ]
};

const guestUser: AppUser = {
  id: "guest",
  name: "New reviewer",
  email: "",
  isAdmin: false,
  initials: "NR",
  organization: "Prismatica",
  title: "Reviewer",
  timezone: "Europe/Rome",
  avatarColor: "#167d7f",
  websiteTheme: "system"
};

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as T | ApiErrorPayload;
  if (!response.ok) {
    throw new Error((payload as ApiErrorPayload).error || "The server request failed.");
  }

  return payload as T;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The server request failed.";
}

function formatExtractionResponseValue(value: ExtractionResponseValue | undefined) {
  if (Array.isArray(value)) {
    return value.join(" | ");
  }
  return value?.trim() || "-";
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

export function PrismaReviewApp() {
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const skipUrlSyncRef = useRef(false);
  const isApplyingPostAuthRedirectRef = useRef(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pendingAuthAction, setPendingAuthAction] = useState<"login" | "register" | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [authSettings, setAuthSettings] = useState<AppAuthSettings>(defaultAuthSettings);
  const [authSettingsMessage, setAuthSettingsMessage] = useState("");
  const [authSettingsForm, setAuthSettingsForm] = useState({
    screeningCheckoutWindowMinutes: defaultAuthSettings.screeningCheckoutWindowMinutes,
    extractionCheckoutWindowMinutes: defaultAuthSettings.extractionCheckoutWindowMinutes
  });
  const [captchaChallenge, setCaptchaChallenge] = useState<PublicAuthConfigPayload["captcha"] | null>(null);
  const [projects, setProjects] = useState<ReviewProject[]>(reviewProjects);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);
  const [reports, setReports] = useState<Report[]>(reportQueue);
  const [extractionTemplates, setExtractionTemplates] = useState<ExtractionTemplate[]>([]);
  const [extractionResponses, setExtractionResponses] = useState<ExtractionResponse[]>([]);
  const [extractionConsensus, setExtractionConsensus] = useState<ExtractionConsensus[]>([]);
  const [currentUserId, setCurrentUserId] = useState(guestUser.id);
  const [selectedProjectId, setSelectedProjectId] = useState(reviewProjects[0].id);
  const [requestedProjectId, setRequestedProjectId] = useState<string | null>(null);
  const [teamUserSearch, setTeamUserSearch] = useState("");
  const [inviteForm, setInviteForm] = useState({
    name: "",
    email: "",
    title: "Reviewer"
  });
  const [teamMessage, setTeamMessage] = useState("");
  const [teamRolePendingUserId, setTeamRolePendingUserId] = useState<string | null>(null);
  const [teamRemovePendingUserId, setTeamRemovePendingUserId] = useState<string | null>(null);
  const [teamAddPendingUserId, setTeamAddPendingUserId] = useState<string | null>(null);
  const [isInvitingProjectUser, setIsInvitingProjectUser] = useState(false);
  const [dashboardMessage, setDashboardMessage] = useState("");
  const [newProjectTeamMessage, setNewProjectTeamMessage] = useState("");
  const [newProjectMemberSearch, setNewProjectMemberSearch] = useState("");
  const [newProjectInviteDraft, setNewProjectInviteDraft] = useState<NewProjectInviteDraft>({
    name: "",
    email: "",
    title: "Reviewer"
  });
  const [queuedNewProjectInvites, setQueuedNewProjectInvites] = useState<NewProjectInviteDraft[]>([]);
  const [projectSettingsForm, setProjectSettingsForm] = useState<ProjectSettingsForm>(emptyProjectSettingsForm);
  const [projectSettingsMessage, setProjectSettingsMessage] = useState("");
  const [isSavingProjectSettings, setIsSavingProjectSettings] = useState(false);
  const [isSavingImportDetails, setIsSavingImportDetails] = useState(false);
  const [isSavingStudyEdit, setIsSavingStudyEdit] = useState(false);
  const [deleteProjectMessage, setDeleteProjectMessage] = useState("");
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [decisions, setDecisions] = useState<Decision[]>(initialDecisions);
  const [serverWorkflowConflicts, setServerWorkflowConflicts] = useState<ProjectWorkflowConflict[]>([]);
  const [events, setEvents] = useState<WorkflowEvent[]>(initialWorkflowEvents);
  const [dedupCandidates, setDedupCandidates] = useState<DedupCandidate[]>(seedDedupCandidates);
  const [pendingDedupAction, setPendingDedupAction] = useState<DedupCandidate["status"] | null>(null);
  const [studyIndex, setStudyIndex] = useState(0);
  const [decisionActions, setDecisionActions] = useState<DecisionAction[]>([]);
  const [pendingScreeningDecision, setPendingScreeningDecision] = useState<Exclude<DecisionValue, "not_retrieved"> | null>(null);
  const [isUndoingScreeningDecision, setIsUndoingScreeningDecision] = useState(false);
  const [screeningNote, setScreeningNote] = useState("");
  const [activeReportId, setActiveReportId] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [activeExtractionReportId, setActiveExtractionReportId] = useState("");
  const [extractionTemplateForm, setExtractionTemplateForm] = useState<ExtractionTemplateForm>(emptyExtractionTemplateForm);
  const [extractionFormValues, setExtractionFormValues] = useState<Record<string, ExtractionResponseValue>>({});
  const [extractionMessage, setExtractionMessage] = useState("");
  const [isCreatingExtractionTemplate, setIsCreatingExtractionTemplate] = useState(false);
  const [isSubmittingExtractionResponse, setIsSubmittingExtractionResponse] = useState(false);
  const [consensusFormValues, setConsensusFormValues] = useState<Record<string, ExtractionResponseValue>>({});
  const [consensusMessage, setConsensusMessage] = useState("");
  const [isFinalizingExtractionConsensus, setIsFinalizingExtractionConsensus] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [isExportingConsensusCsv, setIsExportingConsensusCsv] = useState(false);
  const [fullTextReason, setFullTextReason] = useState(exclusionReasons[0]);
  const [fullTextMessage, setFullTextMessage] = useState("");
  const [pendingFullTextAction, setPendingFullTextAction] = useState<"upload" | "retrieval" | "include" | "exclude" | null>(null);
  const [importMessage, setImportMessage] = useState("");
  const [selectedImportId, setSelectedImportId] = useState("");
  const [isImportEditorOpen, setIsImportEditorOpen] = useState(false);
  const [importDetailMessage, setImportDetailMessage] = useState("");
  const [importDetailForm, setImportDetailForm] = useState<ImportDetailForm>(emptyImportDetailForm);
  const [studyEditId, setStudyEditId] = useState("");
  const [studyEditForm, setStudyEditForm] = useState<StudyEditForm>(emptyStudyEditForm);
  const [accountMessage, setAccountMessage] = useState("");
  const [accountMessageTarget, setAccountMessageTarget] = useState<ProfileSaveAction>("account");
  const [pendingAccountAction, setPendingAccountAction] = useState<ProfileSaveAction | null>(null);
  const [adminDirectoryMessage, setAdminDirectoryMessage] = useState("");
  const [isCreatingAdminUser, setIsCreatingAdminUser] = useState(false);
  const [pendingAdminUserAction, setPendingAdminUserAction] = useState<{ userId: string; action: "reset" | "delete" } | null>(null);
  const [isUpdatingRegistrationSetting, setIsUpdatingRegistrationSetting] = useState(false);
  const [adminCreateUserForm, setAdminCreateUserForm] = useState({
    name: "",
    email: "",
    organization: "",
    title: "Reviewer"
  });
  const [accountForm, setAccountForm] = useState({
    organization: "",
    title: "",
    currentPassword: "",
    newPassword: "",
    websiteTheme: "system" as WebsiteTheme
  });
  const bibtexInputRef = useRef<HTMLInputElement>(null);
  const risInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const previousSettingsProjectIdRef = useRef(selectedProjectId);

  const {
    authMode,
    loginEmail,
    loginPassword,
    showLoginPassword,
    showRegisterPassword,
    loginError,
    registerForm,
    setLoginEmail,
    setLoginPassword,
    setLoginError,
    switchAuthMode,
    toggleLoginPasswordVisibility,
    toggleRegisterPasswordVisibility,
    updateRegisterForm,
    resetRegisterForm,
    clearRegisterCaptcha,
    applySuccessfulRegistration,
    clearLoginPassword
  } = useAuthState({
    registrationEnabled: authSettings.registrationEnabled,
    isAuthenticated,
    hasCaptchaChallenge: Boolean(captchaChallenge),
    loadAuthConfig
  });

  const currentUser = users.find((user) => user.id === currentUserId) ?? users[0] ?? guestUser;
  const { newProjectForm, canCreate, creationStatus, creationSummary, updateNewProjectForm, syncNewProjectUserContext, resetNewProjectForm } = useNewProjectState(currentUser);
  const normalizedTeamUserSearch = teamUserSearch.trim().toLowerCase();
  const normalizedNewProjectMemberSearch = newProjectMemberSearch.trim().toLowerCase();
  const newProjectMemberSearchResults = useMemo(
    () => {
      if (normalizedNewProjectMemberSearch.length < 2) {
        return [];
      }
      return users
        .filter(
          (user) =>
            user.id !== currentUser.id &&
            !newProjectForm.memberIds.includes(user.id) &&
            (user.name.toLowerCase().includes(normalizedNewProjectMemberSearch) || user.email.toLowerCase().includes(normalizedNewProjectMemberSearch))
        )
        .slice(0, 8);
    },
    [currentUser.id, newProjectForm.memberIds, normalizedNewProjectMemberSearch, users]
  );
  const canShowNewProjectInviteForm = Boolean(newProjectInviteDraft.email.trim()) && !users.some((user) => user.email.toLowerCase() === normalizeEmail(newProjectInviteDraft.email));
  const userProjects = useMemo(
    () => (currentUser.isAdmin ? projects : projects.filter((project) => project.memberIds.includes(currentUser.id) || project.ownerIds.includes(currentUser.id) || project.ownerId === currentUser.id)),
    [currentUser.id, currentUser.isAdmin, projects]
  );
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? userProjects[0] ?? projects[0] ?? reviewProjects[0];
  const teamUserSearchResults = useMemo(
    () => {
      if (normalizedTeamUserSearch.length < 2) {
        return [];
      }
      return users
        .filter(
          (user) =>
            !selectedProject.memberIds.includes(user.id) &&
            (user.name.toLowerCase().includes(normalizedTeamUserSearch) || user.email.toLowerCase().includes(normalizedTeamUserSearch))
        )
        .slice(0, 8);
    },
    [normalizedTeamUserSearch, selectedProject.memberIds, users]
  );
  const isProjectView = isProjectScopedView(activeView);
  const hasProjectSeedData = selectedProject.id === "demo-review";
  const projectImportBatches = imports.filter((batch) => batch.projectId === selectedProject.id);
  const projectDedupCandidates = hasProjectSeedData ? dedupCandidates : [];
  const importedProjectStudies = studies.filter((study) => study.projectId === selectedProject.id);
  const projectScreeningStudies = hasProjectSeedData ? screeningStudies : importedProjectStudies;
  const reportOrderByStudyId = new Map(
    projectScreeningStudies.map((study, index) => [study.id, study.importItemId ?? index + 1])
  );
  const projectReportQueue = (hasProjectSeedData ? reportQueue : getWorkflowReportsForProject(selectedProject, importedProjectStudies, reports))
    .slice()
    .sort((left, right) => {
      const leftOrder = reportOrderByStudyId.get(left.studyId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = reportOrderByStudyId.get(right.studyId) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.title.localeCompare(right.title);
    });
  const activeFullTextReports = useMemo(
    () => getActiveFullTextReports(selectedProject, projectReportQueue, decisions, currentUser.id),
    [currentUser.id, decisions, projectReportQueue, selectedProject]
  );
  const projectExtractionStudyIds = new Set(projectScreeningStudies.filter((study) => study.stage === "extraction").map((study) => study.id));
  const projectExtractionReports = projectReportQueue.filter((report) => projectExtractionStudyIds.has(report.studyId));
  const projectExtractionReportKey = projectExtractionReports.map((report) => report.id).join("|");
  const activeExtractionTemplate =
    extractionTemplates.find((template) => template.projectId === selectedProject.id && template.isActive) ??
    extractionTemplates.find((template) => template.projectId === selectedProject.id);
  const activeExtractionReports = useMemo(
    () =>
      activeExtractionTemplate
        ? getActiveExtractionReports(selectedProject, projectExtractionReports, extractionResponses, activeExtractionTemplate.id, currentUser.id)
        : projectExtractionReports,
    [activeExtractionTemplate, currentUser.id, extractionResponses, projectExtractionReports, selectedProject]
  );
  const activeExtractionReport =
    activeView === "extraction"
      ? activeExtractionReports.find((report) => report.id === activeExtractionReportId) ?? activeExtractionReports[0]
      : projectExtractionReports.find((report) => report.id === activeExtractionReportId) ?? projectExtractionReports[0];
  const isActiveExtractionReportInActiveQueue = Boolean(
    activeExtractionTemplate && activeExtractionReport && activeExtractionReports.some((report) => report.id === activeExtractionReport.id)
  );
  const activeExtractionResponse = activeExtractionReport && activeExtractionTemplate
    ? extractionResponses.find(
        (response) =>
          response.projectId === selectedProject.id &&
          response.reportId === activeExtractionReport.id &&
          response.templateId === activeExtractionTemplate.id &&
          response.userId === currentUser.id
      )
    : undefined;
  const activeExtractionConsensus = activeExtractionReport && activeExtractionTemplate
    ? extractionConsensus.find(
        (consensus) =>
          consensus.projectId === selectedProject.id &&
          consensus.reportId === activeExtractionReport.id &&
          consensus.templateId === activeExtractionTemplate.id
      )
    : undefined;
  const activeReport = activeFullTextReports.find((report) => report.id === activeReportId) ?? activeFullTextReports[0] ?? projectReportQueue[0] ?? reportQueue[0];
  const isActiveReportInActiveFullTextQueue = activeFullTextReports.some((report) => report.id === activeReport.id);
  const activeCounts = useMemo(
    () => getCountsForProject(selectedProject, projectScreeningStudies, projectReportQueue, decisions, extractionResponses, extractionTemplates),
    [decisions, extractionResponses, extractionTemplates, projectReportQueue, projectScreeningStudies, selectedProject]
  );
  const titleAbstractEvaluations = useMemo(
    () =>
      new Map(
        projectScreeningStudies.map((study) => {
          const currentDecisions = decisions.filter(
            (decision) =>
              decision.projectId === selectedProject.id &&
              decision.studyId === study.id &&
              decision.stage === "title_abstract" &&
              decision.isCurrent
          );
          return [
            study.id,
            evaluateStage(
              "title_abstract",
              currentDecisions.map((decision) => decision.decisionValue),
              selectedProject.abstractRequiredVotes,
              selectedProject.maybePolicy
            )
          ];
        })
      ),
    [decisions, projectScreeningStudies, selectedProject.abstractRequiredVotes, selectedProject.id, selectedProject.maybePolicy]
  );
  const workflowConflicts = useMemo<WorkflowConflict[]>(
    () =>
      serverWorkflowConflicts
        .filter((conflict) => conflict.projectId === selectedProject.id)
        .map((conflict) => ({
          ...conflict,
          studyIndex:
            conflict.stage === "title_abstract" && conflict.studyId
              ? projectScreeningStudies.findIndex((study) => study.id === conflict.studyId)
              : undefined
        })),
    [projectScreeningStudies, selectedProject.id, serverWorkflowConflicts]
  );
  const titleAbstractConflictEvaluations = useMemo(() => {
    const evaluations = new Map(titleAbstractEvaluations);
    for (const conflict of workflowConflicts) {
      if (conflict.stage !== "title_abstract" || !conflict.studyId) {
        continue;
      }
      evaluations.set(conflict.studyId, {
        state: conflict.label === "Third vote needed" ? "needs_third_vote" : "conflict",
        label: conflict.label
      });
    }
    return evaluations;
  }, [titleAbstractEvaluations, workflowConflicts]);
  const activeScreeningStudies = useMemo(
    () => getActiveTitleAbstractStudies(selectedProject, projectScreeningStudies, decisions, currentUser.id),
    [currentUser.id, decisions, projectScreeningStudies, selectedProject]
  );
  const projectIdSet = useMemo(() => new Set(projects.map((project) => project.id)), [projects]);
  const projectStudyIds = new Set(projectScreeningStudies.map((study) => study.id));
  const projectReportIds = new Set(projectReportQueue.map((report) => report.id));
  const projectEvents = hasProjectSeedData
    ? events.filter((event) => !projectIdSet.has(event.entity) || event.entity === selectedProject.id)
    : events.filter((event) => event.entity === selectedProject.id || projectStudyIds.has(event.entity) || projectReportIds.has(event.entity));
  const latestProjectEvents = projectEvents.slice(0, 5);
  const auditPageCount = Math.max(1, Math.ceil(projectEvents.length / AUDIT_PAGE_SIZE));
  const currentAuditPage = Math.min(auditPage, auditPageCount);
  const pagedProjectEvents = projectEvents.slice((currentAuditPage - 1) * AUDIT_PAGE_SIZE, currentAuditPage * AUDIT_PAGE_SIZE);
  const projectUserStats = getProjectUserStats(selectedProject, users, decisions, projectReportQueue, extractionResponses, projectEvents);
  const currentStudy = activeScreeningStudies[studyIndex] ?? activeScreeningStudies[0] ?? projectScreeningStudies[0] ?? screeningStudies[0];
  const isCurrentStudyInActiveScreeningQueue = activeScreeningStudies.some((study) => study.id === currentStudy.id);
  const currentUserDecision = useMemo(
    () =>
      decisions.find(
        (decision) =>
          decision.projectId === selectedProject.id &&
          decision.studyId === currentStudy.id &&
          decision.userId === currentUser.id &&
          decision.stage === "title_abstract" &&
          decision.isCurrent
      ),
    [currentStudy.id, currentUser.id, decisions, selectedProject.id]
  );

  const currentStageDecisions = useMemo(
    () =>
      decisions.filter(
        (decision) =>
          decision.projectId === selectedProject.id &&
          decision.studyId === currentStudy.id &&
          decision.stage === "title_abstract" &&
          decision.isCurrent
      ),
    [currentStudy.id, decisions, selectedProject.id]
  );

  const stageEvaluation = evaluateStage(
    "title_abstract",
    currentStageDecisions.map((decision) => decision.decisionValue),
    selectedProject.abstractRequiredVotes,
    selectedProject.maybePolicy
  );

  const screenedByMe = useMemo(() => {
    const studyIds = new Set(
      decisions
        .filter(
          (decision) =>
            decision.projectId === selectedProject.id &&
            decision.userId === currentUser.id &&
            decision.stage === "title_abstract" &&
            decision.isCurrent
        )
        .map((decision) => decision.studyId)
    );
    return studyIds.size;
  }, [currentUser.id, decisions, selectedProject.id]);

  const latestPendingDedup = projectDedupCandidates.find((candidate) => candidate.status === "pending") ?? projectDedupCandidates[0];
  const reportsExcludedTotal = sumObject(activeCounts.reportsExcludedWithReasons);
  const recordsIdentified =
    activeCounts.recordsIdentifiedDatabase + activeCounts.recordsIdentifiedRegisters + activeCounts.recordsIdentifiedOther;
  const exportConsistency = useMemo(() => {
    const preScreenRemovalTotal = activeCounts.duplicateRecordsRemoved + activeCounts.automationRemoved + activeCounts.removedOtherReasons;
    const screenedAndPreScreenRemovedTotal = activeCounts.recordsScreened + preScreenRemovalTotal;
    const screenBalanceTotal = activeCounts.recordsExcluded + activeCounts.reportsSought;
    const retrievalBalanceTotal = activeCounts.reportsAssessed + activeCounts.reportsNotRetrieved;
    const assessedBalanceTotal = reportsExcludedTotal + activeCounts.studiesIncluded;
    const excludedFullTextDecisions = decisions.filter(
      (decision) =>
        decision.projectId === selectedProject.id &&
        decision.stage === "full_text" &&
        decision.isCurrent &&
        decision.decisionValue === "exclude"
    );
    const excludedWithoutReasonCount = excludedFullTextDecisions.filter((decision) => !decision.exclusionReasonId).length;

    const identifiedCheckActive = recordsIdentified > 0 || screenedAndPreScreenRemovedTotal > 0;
    const screenedCheckActive = activeCounts.recordsScreened > 0 || screenBalanceTotal > 0;
    const retrievalCheckActive = activeCounts.reportsSought > 0 || retrievalBalanceTotal > 0;
    const assessedCheckActive = activeCounts.reportsAssessed > 0 || assessedBalanceTotal > 0;
    const exclusionReasonCheckActive = excludedFullTextDecisions.length > 0;

    const identifiedCheckOk = identifiedCheckActive && recordsIdentified >= screenedAndPreScreenRemovedTotal;
    const screenedCheckOk = screenedCheckActive && activeCounts.recordsScreened === screenBalanceTotal;
    const retrievalCheckOk = retrievalCheckActive && activeCounts.reportsSought === retrievalBalanceTotal;
    const assessedCheckOk = assessedCheckActive && activeCounts.reportsAssessed === assessedBalanceTotal;
    const exclusionReasonCheckOk = exclusionReasonCheckActive && excludedWithoutReasonCount === 0;
    const activeCount = [
      identifiedCheckActive,
      screenedCheckActive,
      retrievalCheckActive,
      assessedCheckActive,
      exclusionReasonCheckActive
    ].filter(Boolean).length;
    const passedCount = [identifiedCheckOk, screenedCheckOk, retrievalCheckOk, assessedCheckOk, exclusionReasonCheckOk].filter(Boolean).length;

    return {
      screenedAndPreScreenRemovedTotal,
      screenBalanceTotal,
      retrievalBalanceTotal,
      assessedBalanceTotal,
      excludedWithoutReasonCount,
      identifiedCheckActive,
      screenedCheckActive,
      retrievalCheckActive,
      assessedCheckActive,
      exclusionReasonCheckActive,
      identifiedCheckOk,
      screenedCheckOk,
      retrievalCheckOk,
      assessedCheckOk,
      exclusionReasonCheckOk,
      activeCount,
      passedCount,
      totalCount: 5,
      failedCount: activeCount - passedCount
    };
  }, [activeCounts, decisions, recordsIdentified, reportsExcludedTotal, selectedProject.id]);
  const screeningProgress =
    projectScreeningStudies.length > 0 ? Math.round((screenedByMe / projectScreeningStudies.length) * 100) : 0;
  const sequentialPhaseAccess = useMemo<PhaseAccessMap>(() => {
    if (selectedProject.stage === "complete") {
      return {
        imports: true,
        dedup: true,
        screening: true,
        fullText: true,
        extraction: true,
        consensus: true
      };
    }

    const importsComplete = recordsIdentified > 0 || selectedProject.recordsTotal > 0 || projectScreeningStudies.length > 0;
    const currentPhaseIndex = getProjectPhaseIndex(selectedProject.stage);
    const dedupComplete = importsComplete && projectDedupCandidates.every((candidate) => candidate.status !== "pending");
    const screeningComplete =
      dedupComplete &&
      projectScreeningStudies.length > 0 &&
      projectScreeningStudies.every((study) => isTitleAbstractEvaluationComplete(titleAbstractConflictEvaluations.get(study.id)));
    const fullTextAvailable = currentPhaseIndex >= 2 && projectReportQueue.length > 0;
    const fullTextComplete =
      (screeningComplete || fullTextAvailable) &&
      projectReportQueue.length > 0 &&
      projectReportQueue.every((report) => {
        const currentDecisions = decisions.filter(
          (decision) =>
            decision.projectId === selectedProject.id &&
            decision.reportId === report.id &&
            decision.stage === "full_text" &&
            decision.isCurrent
        );
        const evaluation = evaluateStage(
          "full_text",
          currentDecisions.map((decision) => decision.decisionValue),
          report.fullTextRequiredVotes ?? selectedProject.fullTextRequiredVotes,
          selectedProject.maybePolicy
        );
        return isFullTextEvaluationComplete(evaluation);
      });
    const extractionAvailable = (currentPhaseIndex >= 3 || fullTextComplete) && activeCounts.studiesIncluded > 0;

    return {
      imports: true,
      dedup: importsComplete || currentPhaseIndex >= 1,
      screening: dedupComplete || currentPhaseIndex >= 1,
      fullText: fullTextAvailable || (screeningComplete && projectReportQueue.length > 0),
      extraction: extractionAvailable,
      consensus: extractionAvailable
    };
  }, [
    activeCounts.studiesIncluded,
    decisions,
    projectDedupCandidates,
    projectReportQueue,
    projectScreeningStudies,
    recordsIdentified,
    selectedProject.fullTextRequiredVotes,
    selectedProject.id,
    selectedProject.maybePolicy,
    selectedProject.recordsTotal,
    selectedProject.stage,
    titleAbstractConflictEvaluations
  ]);

  function canNavigateToProjectView(view: ViewKey) {
    if (!selectedProject.requireSequentialPhases || !reviewPhaseNavKeys.has(view)) {
      return true;
    }
    return sequentialPhaseAccess[view] ?? true;
  }

  function navigateToProjectView(view: ViewKey) {
    if (!canNavigateToProjectView(view)) {
      setActiveView("projectDashboard");
      setIsMobileNavOpen(false);
      return;
    }

    setActiveView(view);
    setIsMobileNavOpen(false);
  }

  function getSelectedProjectWorkflowStepState(step: "imports" | "screening" | "fullText" | "extraction", stage: ReviewProject["stage"]) {
    if (selectedProject.requireSequentialPhases && !canNavigateToProjectView(step)) {
      return "pending";
    }
    return getWorkflowStepState(step, stage);
  }

  async function loadAuthConfig() {
    const payload = await apiRequest<PublicAuthConfigPayload>("/api/auth/config");
    setAuthSettings(payload.authSettings);
    setCaptchaChallenge(payload.captcha);
    if (!payload.authSettings.registrationEnabled) {
      switchAuthMode("signIn");
    }
  }

  function applyPostAuthRedirect() {
    const params = new URLSearchParams(window.location.search);
    const target = sanitizeRedirectTarget(params.get("redirect"));

    if (!target) {
      skipUrlSyncRef.current = false;
      setActiveView("dashboard");
      return;
    }

    const redirectUrl = new URL(target, window.location.origin);
    const routeState = parseRouteState(redirectUrl.pathname, redirectUrl.search);
    const nextUrl = `${normalizePathname(redirectUrl.pathname)}${redirectUrl.search}${redirectUrl.hash}`;

    isApplyingPostAuthRedirectRef.current = true;
    skipUrlSyncRef.current = true;
    setActiveView(routeState.view);
    setRequestedProjectId(routeState.projectId ?? null);
    if (routeState.projectId) {
      setSelectedProjectId(routeState.projectId);
    }
    window.history.replaceState(null, "", nextUrl);
  }

  useEffect(() => {
    let isMounted = true;

    async function loadServerSession() {
      try {
        const payload = await apiRequest<AppStatePayload>("/api/app-state");
        if (!isMounted) {
          return;
        }
        applyAppState(payload);
        setLoginEmail(payload.currentUser.email);
        setIsAuthenticated(true);
      } catch {
        if (isMounted) {
          await loadAuthConfig().catch(() => undefined);
          setIsAuthenticated(false);
        }
      } finally {
        if (isMounted) {
          setIsAuthResolved(true);
        }
      }
    }

    loadServerSession();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    function applyUrlState() {
      const routeState = parseRouteState(window.location.pathname, window.location.search);

      skipUrlSyncRef.current = true;
      setActiveView(routeState.view);
      setRequestedProjectId(routeState.projectId ?? null);
      if (routeState.projectId) {
        setSelectedProjectId(routeState.projectId);
      }
    }

    applyUrlState();
    window.addEventListener("popstate", applyUrlState);
    return () => window.removeEventListener("popstate", applyUrlState);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const nextPath = normalizePathname(buildPathForState(activeView, selectedProjectId));
    const currentPath = normalizePathname(window.location.pathname);
    const nextUrl = `${nextPath}${window.location.hash}`;
    const currentUrl = `${currentPath}${window.location.hash}`;

    if (skipUrlSyncRef.current) {
      skipUrlSyncRef.current = false;
      return;
    }

    if (nextUrl !== currentUrl) {
      window.history.pushState(null, "", nextUrl);
    }
  }, [activeView, isAuthenticated, selectedProjectId]);

  useEffect(() => {
    if (!isAuthResolved) {
      return;
    }

    const currentPath = normalizePathname(window.location.pathname);
    const currentWithSearch = `${currentPath}${window.location.search}`;

    if (!isAuthenticated) {
      if (currentPath === "/sign-in") {
        return;
      }

      const nextUrl = `/sign-in?redirect=${encodeURIComponent(currentWithSearch)}`;
      window.history.replaceState(null, "", nextUrl);
      return;
    }

    if (isApplyingPostAuthRedirectRef.current) {
      isApplyingPostAuthRedirectRef.current = false;
      return;
    }

    if (currentPath === "/sign-in") {
      applyPostAuthRedirect();
    }
  }, [isAuthResolved, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !isAuthResolved) {
      return;
    }

    const routeProjectId = requestedProjectId;
    if (routeProjectId) {
      const canAccessRouteProject = userProjects.some((project) => project.id === routeProjectId);
      if (!canAccessRouteProject) {
        const notFoundUrl = `/__not-found?missingProjectId=${encodeURIComponent(routeProjectId)}`;
        if (normalizePathname(window.location.pathname) !== "/__not-found") {
          window.location.replace(notFoundUrl);
        }
        return;
      }

      if (selectedProjectId !== routeProjectId) {
        skipUrlSyncRef.current = true;
        setSelectedProjectId(routeProjectId);
      }
      return;
    }

    if (userProjects.length === 0) {
      return;
    }

    const canAccessSelected = userProjects.some((project) => project.id === selectedProjectId);
    if (!canAccessSelected) {
      setSelectedProjectId(userProjects[0].id);
    }
  }, [isAuthenticated, isAuthResolved, requestedProjectId, selectedProjectId, userProjects]);

  useEffect(() => {
    if (!isAuthenticated || !isAuthResolved || !selectedProject.requireSequentialPhases || !reviewPhaseNavKeys.has(activeView)) {
      return;
    }

    if (!canNavigateToProjectView(activeView)) {
      setActiveView("projectDashboard");
      setIsMobileNavOpen(false);
    }
  }, [activeView, isAuthenticated, isAuthResolved, selectedProject.requireSequentialPhases, sequentialPhaseAccess]);

  useEffect(() => {
    setStudyIndex((index) => Math.min(index, Math.max(activeScreeningStudies.length - 1, 0)));
  }, [activeScreeningStudies.length]);

  useEffect(() => {
    if (!isAuthenticated || !isAuthResolved || activeView !== "screening" || !isCurrentStudyInActiveScreeningQueue) {
      return;
    }

    let isCancelled = false;
    const requestBody = {
      projectId: selectedProject.id,
      studyId: currentStudy.id
    };

    async function acquireCheckout() {
      try {
        const payload = await apiRequest<AppMutationPayload>("/api/screening-checkouts", {
          method: "POST",
          body: JSON.stringify({ ...requestBody, action: "acquire" })
        });
        if (!isCancelled) {
          applyAppState(payload);
        }
      } catch {
        // Checkout refresh failures should not interrupt an in-progress reading session.
      }
    }

    acquireCheckout();
    const intervalId = window.setInterval(acquireCheckout, getCheckoutRefreshIntervalMs(authSettings.screeningCheckoutWindowMinutes));

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      fetch("/api/screening-checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestBody, action: "release" }),
        keepalive: true
      }).catch(() => undefined);
    };
  }, [
    activeView,
    authSettings.screeningCheckoutWindowMinutes,
    currentStudy.id,
    isAuthResolved,
    isAuthenticated,
    isCurrentStudyInActiveScreeningQueue,
    selectedProject.id
  ]);

  useEffect(() => {
    if (!isAuthenticated || !isAuthResolved || activeView !== "fullText" || !isActiveReportInActiveFullTextQueue) {
      return;
    }

    let isCancelled = false;
    const requestBody = {
      projectId: selectedProject.id,
      studyId: activeReport.studyId,
      reportId: activeReport.id,
      stage: "full_text"
    };

    async function acquireCheckout() {
      try {
        const payload = await apiRequest<AppMutationPayload>("/api/screening-checkouts", {
          method: "POST",
          body: JSON.stringify({ ...requestBody, action: "acquire" })
        });
        if (!isCancelled) {
          applyAppState(payload);
        }
      } catch {
        // Checkout refresh failures should not interrupt an in-progress full-text reading session.
      }
    }

    acquireCheckout();
    const intervalId = window.setInterval(acquireCheckout, getCheckoutRefreshIntervalMs(authSettings.screeningCheckoutWindowMinutes));

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      fetch("/api/screening-checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestBody, action: "release" }),
        keepalive: true
      }).catch(() => undefined);
    };
  }, [
    activeReport.id,
    activeReport.studyId,
    activeView,
    authSettings.screeningCheckoutWindowMinutes,
    isActiveReportInActiveFullTextQueue,
    isAuthResolved,
    isAuthenticated,
    selectedProject.id
  ]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      !isAuthResolved ||
      activeView !== "extraction" ||
      !isActiveExtractionReportInActiveQueue ||
      !activeExtractionTemplate ||
      !activeExtractionReport
    ) {
      return;
    }

    let isCancelled = false;
    const requestBody = {
      projectId: selectedProject.id,
      studyId: activeExtractionReport.studyId,
      reportId: activeExtractionReport.id,
      templateId: activeExtractionTemplate.id,
      stage: "extraction"
    };

    async function acquireCheckout() {
      try {
        const payload = await apiRequest<AppMutationPayload>("/api/screening-checkouts", {
          method: "POST",
          body: JSON.stringify({ ...requestBody, action: "acquire" })
        });
        if (!isCancelled) {
          applyAppState(payload);
        }
      } catch {
        // Extraction checkout refresh failures should not interrupt an in-progress extraction session.
      }
    }

    acquireCheckout();
    const intervalId = window.setInterval(acquireCheckout, getCheckoutRefreshIntervalMs(authSettings.extractionCheckoutWindowMinutes));

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      fetch("/api/screening-checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...requestBody, action: "release" }),
        keepalive: true
      }).catch(() => undefined);
    };
  }, [
    activeExtractionReport?.id,
    activeExtractionReport?.studyId,
    activeExtractionTemplate?.id,
    activeView,
    authSettings.extractionCheckoutWindowMinutes,
    isActiveExtractionReportInActiveQueue,
    isAuthResolved,
    isAuthenticated,
    selectedProject.id
  ]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (activeView !== "screening") {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "i") {
        event.preventDefault();
        addScreeningDecision("include");
      }
      if (key === "e") {
        event.preventDefault();
        addScreeningDecision("exclude");
      }
      if (key === "m") {
        event.preventDefault();
        addScreeningDecision("maybe");
      }
      if (key === "u") {
        event.preventDefault();
        undoLastDecision();
      }
      if (key === "j" || key === "arrowright") {
        event.preventDefault();
        setStudyIndex((index) => Math.min(index + 1, Math.max(activeScreeningStudies.length - 1, 0)));
      }
      if (key === "k" || key === "arrowleft") {
        event.preventDefault();
        setStudyIndex((index) => Math.max(index - 1, 0));
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeScreeningStudies.length, activeView, currentStudy.id, currentUserDecision, decisions, selectedProject.id]);

  useEffect(() => {
    setAccountForm((previous) => ({
      ...previous,
      organization: currentUser.organization,
      title: currentUser.title,
      currentPassword: "",
      newPassword: "",
      websiteTheme: currentUser.websiteTheme ?? "system"
    }));
    setAccountMessage("");
  }, [currentUser.id, currentUser.organization, currentUser.title, currentUser.websiteTheme]);

  useEffect(() => {
    setAuthSettingsForm({
      screeningCheckoutWindowMinutes: authSettings.screeningCheckoutWindowMinutes,
      extractionCheckoutWindowMinutes: authSettings.extractionCheckoutWindowMinutes
    });
  }, [authSettings.extractionCheckoutWindowMinutes, authSettings.screeningCheckoutWindowMinutes]);

  useEffect(() => {
    const theme = currentUser.websiteTheme ?? "system";
    const root = document.documentElement;
    if (theme === "system") {
      root.removeAttribute("data-theme");
      return;
    }
    root.setAttribute("data-theme", theme);
  }, [currentUser.websiteTheme]);

  useEffect(() => {
    const hasProjectChanged = previousSettingsProjectIdRef.current !== selectedProject.id;
    setProjectSettingsForm({
      title: selectedProject.title,
      organization: selectedProject.organization,
      protocolId: selectedProject.protocolId,
      description: selectedProject.description,
      searchStrategies: selectedProject.searchStrategies,
      dueDate: selectedProject.dueDate,
      blindMode: selectedProject.blindMode,
      abstractRequiredVotes: selectedProject.abstractRequiredVotes,
      fullTextRequiredVotes: selectedProject.fullTextRequiredVotes,
      extractionRequiredVotes: selectedProject.extractionRequiredVotes,
      maybePolicy: selectedProject.maybePolicy,
      requireSequentialPhases: selectedProject.requireSequentialPhases
    });
    if (hasProjectChanged) {
      setProjectSettingsMessage("");
      previousSettingsProjectIdRef.current = selectedProject.id;
    }
  }, [
    selectedProject.abstractRequiredVotes,
    selectedProject.blindMode,
    selectedProject.description,
    selectedProject.dueDate,
    selectedProject.extractionRequiredVotes,
    selectedProject.fullTextRequiredVotes,
    selectedProject.id,
    selectedProject.maybePolicy,
    selectedProject.organization,
    selectedProject.protocolId,
    selectedProject.requireSequentialPhases,
    selectedProject.searchStrategies,
    selectedProject.title
  ]);

  useEffect(() => {
    setExtractionTemplateForm({ title: "Data Template", fields: [createBlankExtractionField()] });
    setExtractionFormValues({});
    setConsensusFormValues({});
    setExtractionMessage("");
    setConsensusMessage("");
    setExportMessage("");
    setAuditPage(1);
  }, [selectedProject.id]);

  useEffect(() => {
    if (auditPage > auditPageCount) {
      setAuditPage(auditPageCount);
    }
  }, [auditPage, auditPageCount]);

  useEffect(() => {
    if (activeFullTextReports.length === 0) {
      if (projectReportQueue.length === 0 && activeReportId) {
        setActiveReportId("");
      }
      return;
    }
    if (!activeFullTextReports.some((report) => report.id === activeReportId)) {
      setActiveReportId(activeFullTextReports[0].id);
    }
  }, [activeFullTextReports, activeReportId, projectReportQueue.length]);

  useEffect(() => {
    if (activeView === "extraction") {
      if (activeExtractionReports.length === 0) {
        if (projectExtractionReports.length === 0 && activeExtractionReportId) {
          setActiveExtractionReportId("");
        }
        return;
      }
      if (!activeExtractionReports.some((report) => report.id === activeExtractionReportId)) {
        setActiveExtractionReportId(activeExtractionReports[0].id);
      }
      return;
    }

    if (projectExtractionReports.length === 0) {
      setActiveExtractionReportId("");
      return;
    }
    if (!projectExtractionReports.some((report) => report.id === activeExtractionReportId)) {
      setActiveExtractionReportId(projectExtractionReports[0].id);
    }
  }, [activeExtractionReportId, activeExtractionReports, activeView, projectExtractionReportKey, projectExtractionReports]);

  useEffect(() => {
    setExtractionFormValues(activeExtractionResponse?.values ?? {});
    setExtractionMessage("");
  }, [activeExtractionReport?.id, activeExtractionResponse?.id, activeExtractionTemplate?.id, currentUser.id]);

  useEffect(() => {
    setConsensusFormValues(activeExtractionConsensus?.resolvedValues ?? {});
    setConsensusMessage("");
  }, [activeExtractionConsensus?.id, activeExtractionReport?.id, activeExtractionTemplate?.id]);

  useEffect(() => {
    const decision = decisions.find(
      (candidate) =>
        candidate.projectId === selectedProject.id &&
        candidate.reportId === activeReportId &&
        candidate.userId === currentUser.id &&
        candidate.stage === "full_text" &&
        candidate.isCurrent
    );
    setFullTextReason(decision?.exclusionReasonId ?? exclusionReasons[0]);
  }, [activeReportId, currentUser.id, decisions, selectedProject.id]);

  useEffect(() => {
    const batch = imports.find((candidate) => candidate.id === selectedImportId && candidate.projectId === selectedProject.id);
    if (!batch) {
      if (isImportEditorOpen) {
        setIsImportEditorOpen(false);
      }
      setImportDetailForm(emptyImportDetailForm);
      setStudyEditId("");
      setStudyEditForm(emptyStudyEditForm);
      return;
    }

    setImportDetailForm({
      sourceName: batch.sourceName,
      filename: batch.filename
    });
  }, [imports, isImportEditorOpen, selectedImportId, selectedProject.id]);

  if (!isAuthResolved) {
    return (
      <main className="loginShell" aria-busy="true" aria-live="polite">
        <section className="loginPanel authLoadingPanel">
          <div className="brandBlock loginBrand">
            <div className="brandMark brandMarkImage">
              <img src="/icon.svg" alt={BRAND_LOGO_ALT} width={30} height={30} />
            </div>
            <div>
              <strong>{BRAND_NAME}</strong>
              <span>{BRAND_TAGLINE}</span>
            </div>
          </div>
          <div className="authLoadingBody">
            <span className="authLoadingSpinner" aria-hidden="true" />
            <p className="subtle">Loading your workspace...</p>
          </div>
        </section>
      </main>
    );
  }

  function applyAppState(payload: AppStatePayload | AppMutationPayload) {
    setAuthSettings(payload.authSettings ?? defaultAuthSettings);
    setUsers(payload.users);
    setProjects(payload.projects);
    setImports(payload.imports);
    setStudies(payload.studies);
    setReports(payload.reports);
    setExtractionTemplates(payload.extractionTemplates);
    setExtractionResponses(payload.extractionResponses);
    setExtractionConsensus(payload.extractionConsensus);
    setDecisions(payload.decisions);
    setServerWorkflowConflicts(payload.workflowConflicts ?? []);
    setEvents(payload.events);
    setDedupCandidates(payload.dedupCandidates);
    setCurrentUserId(payload.currentUser.id);
    syncNewProjectUserContext(payload.currentUser);
    setSelectedProjectId((previousProjectId) => {
      if ("selectedProjectId" in payload && payload.selectedProjectId) {
        return payload.selectedProjectId;
      }
      if (payload.projects.some((project) => project.id === previousProjectId)) {
        return previousProjectId;
      }
      return payload.projects[0]?.id ?? reviewProjects[0].id;
    });
  }

  async function handleLogin(event?: FormSubmitEvent) {
    event?.preventDefault();

    if (pendingAuthAction) {
      return;
    }

    if (!loginEmail.trim()) {
      setLoginError("Enter an email address to continue.");
      return;
    }

    if (!loginPassword.trim()) {
      setLoginError("Enter a password to continue.");
      return;
    }

    setLoginError("");
    setPendingAuthAction("login");
    try {
      const payload = await apiRequest<AppStatePayload>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword
        })
      });
      applyAppState(payload);
      setIsAuthenticated(true);
      applyPostAuthRedirect();
    } catch (error) {
      setLoginError(getErrorMessage(error));
    } finally {
      setPendingAuthAction(null);
    }
  }

  async function handleRegistration(event: FormSubmitEvent) {
    event.preventDefault();
    if (pendingAuthAction) {
      return;
    }

    if (!authSettings.registrationEnabled) {
      setLoginError("Public registration is disabled. Ask an administrator for an account.");
      switchAuthMode("signIn");
      return;
    }

    const email = registerForm.email.trim().toLowerCase();
    const name = registerForm.name.trim();
    const organization = registerForm.organization.trim();

    if (!name || !email || !organization || !registerForm.password.trim()) {
      setLoginError("Complete name, email, organization, and password to register.");
      return;
    }

    if (!registerForm.captchaAnswer.trim() || !captchaChallenge?.token) {
      setLoginError("Complete the captcha challenge to register.");
      return;
    }

    setLoginError("");
    setPendingAuthAction("register");
    try {
      const payload = await apiRequest<AppStatePayload>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          organization,
          title: registerForm.title,
          password: registerForm.password,
          captchaToken: captchaChallenge.token,
          captchaAnswer: registerForm.captchaAnswer
        })
      });
      applyAppState(payload);
      applySuccessfulRegistration(payload.currentUser.email, registerForm.password);
      resetNewProjectForm(payload.currentUser);
      setIsAuthenticated(true);
      applyPostAuthRedirect();
    } catch (error) {
      setLoginError(getErrorMessage(error));
      loadAuthConfig().catch(() => undefined);
      clearRegisterCaptcha();
      if (getErrorMessage(error).includes("already has an account")) {
        switchAuthMode("signIn");
        setLoginEmail(email);
      }
    } finally {
      setPendingAuthAction(null);
    }
  }

  async function handleLogout() {
    await apiRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setIsAuthenticated(false);
    setActiveView("dashboard");
    clearLoginPassword();
  }

  function openProject(projectId: string, view: ViewKey = "projectDashboard") {
    const nextView = projectId === selectedProject.id && !canNavigateToProjectView(view) ? "projectDashboard" : view;
    setRequestedProjectId(projectId);
    setSelectedProjectId(projectId);
    setActiveView(nextView);
    setIsMobileNavOpen(false);
    setStudyIndex(0);
    setActiveReportId("");
    setFullTextMessage("");
  }

  function openConflict(conflict: WorkflowConflict) {
    setIsMobileNavOpen(false);
    setFullTextMessage("");
    if (conflict.stage === "full_text" && conflict.reportId) {
      setActiveReportId(conflict.reportId);
      navigateToProjectView("fullText");
      return;
    }
    const activeConflictIndex = conflict.studyId
      ? activeScreeningStudies.findIndex((study) => study.id === conflict.studyId)
      : -1;
    setStudyIndex(Math.max(activeConflictIndex >= 0 ? activeConflictIndex : conflict.studyIndex ?? 0, 0));
    navigateToProjectView("screening");
  }

  function updateProjectSettingsForm<Key extends keyof ProjectSettingsForm>(key: Key, value: ProjectSettingsForm[Key]) {
    setProjectSettingsForm((previous) => ({
      ...previous,
      [key]: value
    }));
  }

  async function updateProjectMembers(projectId: string, memberIds: string[], ownerIds: string[], eventLabel: string) {
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${projectId}/members`, {
        method: "PATCH",
        body: JSON.stringify({ memberIds, ownerIds, eventLabel })
      });
      applyAppState(payload);
      return true;
    } catch (error) {
      setTeamMessage(getErrorMessage(error));
      return false;
    }
  }

  async function addExistingUserToProject(userId: string) {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
      setTeamMessage("That user was not found.");
      return;
    }

    if (selectedProject.memberIds.includes(user.id)) {
      setTeamMessage(`${user.name} is already in this review.`);
      return;
    }

    setTeamAddPendingUserId(userId);
    try {
      const didUpdate = await updateProjectMembers(
        selectedProject.id,
        [...selectedProject.memberIds, user.id],
        selectedProject.ownerIds,
        `Added ${user.name} to project team`
      );
      if (didUpdate) {
        setTeamUserSearch("");
        setTeamMessage(`${user.name} added to ${selectedProject.title}.`);
      }
    } finally {
      setTeamAddPendingUserId((previous) => (previous === userId ? null : previous));
    }
  }

  async function inviteUserToProject(event: FormSubmitEvent) {
    event.preventDefault();
    const email = inviteForm.email.trim().toLowerCase();
    const name = inviteForm.name.trim();

    if (!name || !email) {
      setTeamMessage("Enter a name and email address.");
      return;
    }

    const invitedUser = users.find((user) => user.email.toLowerCase() === email);
    if (invitedUser && selectedProject.memberIds.includes(invitedUser.id)) {
      setTeamMessage(`${invitedUser.name} is already in this review.`);
      return;
    }

    setIsInvitingProjectUser(true);
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/invite`, {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          title: inviteForm.title
        })
      });
      applyAppState(payload);
      setInviteForm({ name: "", email: "", title: "Reviewer" });
      setTeamMessage(payload.message ?? `${name} invited to ${selectedProject.title}.`);
    } catch (error) {
      setTeamMessage(getErrorMessage(error));
    } finally {
      setIsInvitingProjectUser(false);
    }
  }

  async function removeUserFromProject(userId: string) {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
      return;
    }

    if (!selectedProject.ownerIds.includes(currentUser.id) && selectedProject.ownerId !== currentUser.id) {
      setTeamMessage("Only project owners can remove members.");
      return;
    }

    if (selectedProject.ownerIds.includes(userId) && selectedProject.ownerIds.length === 1) {
      setTeamMessage("The last project owner cannot be removed.");
      return;
    }

    if (!window.confirm(`Remove ${user.name} from ${selectedProject.title}?`)) {
      return;
    }

    try {
      setTeamRemovePendingUserId(userId);
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/members/${userId}`, {
        method: "DELETE"
      });
      applyAppState(payload);
      setTeamMessage(`${user.name} removed from ${selectedProject.title}.`);
    } catch (error) {
      setTeamMessage(getErrorMessage(error));
    } finally {
      setTeamRemovePendingUserId((previous) => (previous === userId ? null : previous));
    }
  }

  async function adminDeleteProject(project: ReviewProject) {
    if (!window.confirm(`Delete review "${project.title}"? This will remove its imports, studies, reports, decisions, and audit history.`)) {
      return;
    }

    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${project.id}`, {
        method: "DELETE"
      });
      applyAppState(payload);
      setDashboardMessage(payload.message ?? `Deleted review ${project.title}.`);
    } catch (error) {
      setDashboardMessage(getErrorMessage(error));
    }
  }

  async function deleteCurrentProjectFromSettings() {
    if (!window.confirm(`Delete review "${selectedProject.title}"? This action cannot be undone.`)) {
      return;
    }

    setDeleteProjectMessage("");
    try {
      setIsDeletingProject(true);
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}`, {
        method: "DELETE"
      });
      applyAppState(payload);
      setRequestedProjectId(null);
      setActiveView("dashboard");
      setDashboardMessage(payload.message ?? `Deleted review ${selectedProject.title}.`);
    } catch (error) {
      setDeleteProjectMessage(getErrorMessage(error));
    } finally {
      setIsDeletingProject(false);
    }
  }

  async function toggleProjectOwner(userId: string) {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
      return;
    }

    if (!selectedProject.ownerIds.includes(currentUser.id) && selectedProject.ownerId !== currentUser.id) {
      setTeamMessage("Only project owners can change project roles.");
      return;
    }

    const nextOwnerIds = selectedProject.ownerIds.includes(userId)
      ? selectedProject.ownerIds.filter((ownerId) => ownerId !== userId)
      : [...selectedProject.ownerIds, userId];

    if (nextOwnerIds.length === 0) {
      setTeamMessage("A project must have at least one owner.");
      return;
    }

    setTeamRolePendingUserId(userId);
    try {
      const didUpdate = await updateProjectMembers(
        selectedProject.id,
        selectedProject.memberIds,
        nextOwnerIds,
        `${nextOwnerIds.includes(userId) ? "Promoted" : "Demoted"} ${user.name} ${nextOwnerIds.includes(userId) ? "to owner" : "to reviewer"}`
      );
      if (didUpdate) {
        setTeamMessage(nextOwnerIds.includes(userId) ? `${user.name} is now an owner.` : `${user.name} is now a reviewer.`);
      }
    } finally {
      setTeamRolePendingUserId((previous) => (previous === userId ? null : previous));
    }
  }

  async function createProject(event: FormSubmitEvent) {
    event.preventDefault();
    const title = newProjectForm.title.trim();
    const dueDate = newProjectForm.dueDate.trim();
    if (!title || (dueDate.length > 0 && !isEuDate(dueDate))) {
      return;
    }

    try {
      const payload = await apiRequest<AppMutationPayload>("/api/projects", {
        method: "POST",
        body: JSON.stringify(newProjectForm)
      });
      applyAppState(payload);
      const createdProjectId = payload.selectedProjectId ?? selectedProjectId;
      setSelectedProjectId(createdProjectId);

      if (queuedNewProjectInvites.length > 0) {
        let sentInvites = 0;
        const failedInvites: string[] = [];
        for (const invite of queuedNewProjectInvites) {
          try {
            const invitePayload = await apiRequest<AppMutationPayload>(`/api/projects/${createdProjectId}/invite`, {
              method: "POST",
              body: JSON.stringify(invite)
            });
            applyAppState(invitePayload);
            sentInvites += 1;
          } catch (error) {
            failedInvites.push(`${invite.email}: ${getErrorMessage(error)}`);
          }
        }
        if (sentInvites > 0 || failedInvites.length > 0) {
          const summary = `Invitations queued: ${sentInvites} sent${failedInvites.length > 0 ? `, ${failedInvites.length} failed.` : "."}`;
          setDashboardMessage(failedInvites.length > 0 ? `${summary} ${failedInvites.join(" ")}` : summary);
        }
      }

      resetNewProjectForm(currentUser);
      setNewProjectMemberSearch("");
      setNewProjectInviteDraft({ name: "", email: "", title: "Reviewer" });
      setQueuedNewProjectInvites([]);
      setNewProjectTeamMessage("");
      setActiveView("projectDashboard");
    } catch (error) {
      setNewProjectTeamMessage(getErrorMessage(error));
    }
  }

  function updateNewProjectMemberSearch(value: string) {
    setNewProjectMemberSearch(value);
    const maybeEmail = normalizeEmail(value);
    if (maybeEmail.includes("@")) {
      setNewProjectInviteDraft((previous) => ({ ...previous, email: maybeEmail }));
    }
  }

  function addExistingMemberToNewProject(userId: string) {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
      setNewProjectTeamMessage("That user was not found.");
      return;
    }
    if (newProjectForm.memberIds.includes(user.id)) {
      setNewProjectTeamMessage(`${user.name} is already in this review.`);
      return;
    }
    updateNewProjectForm("memberIds", [...newProjectForm.memberIds, user.id]);
    setQueuedNewProjectInvites((previous) => previous.filter((invite) => normalizeEmail(invite.email) !== normalizeEmail(user.email)));
    setNewProjectTeamMessage("");
  }

  function removeMemberFromNewProject(userId: string) {
    if (userId === currentUser.id) {
      setNewProjectTeamMessage("Project creator remains on the review team.");
      return;
    }
    const nextMembers = newProjectForm.memberIds.filter((memberId) => memberId !== userId);
    updateNewProjectForm("memberIds", nextMembers.length > 0 ? nextMembers : [currentUser.id]);
  }

  function queueNewProjectInvite() {
    const email = normalizeEmail(newProjectInviteDraft.email || newProjectMemberSearch);
    const name = newProjectInviteDraft.name.trim();
    const title = newProjectInviteDraft.title.trim() || "Reviewer";

    if (!name || !email) {
      setNewProjectTeamMessage("Enter reviewer name and email to queue an invitation.");
      return;
    }

    const existingUser = users.find((candidate) => candidate.email.toLowerCase() === email);
    if (existingUser) {
      addExistingMemberToNewProject(existingUser.id);
      return;
    }

    if (queuedNewProjectInvites.some((invite) => normalizeEmail(invite.email) === email)) {
      setNewProjectTeamMessage("That invitation is already queued.");
      return;
    }

    setQueuedNewProjectInvites((previous) => [...previous, { name, email, title }]);
    setNewProjectInviteDraft({ name: "", email: "", title: "Reviewer" });
    setNewProjectMemberSearch("");
    setNewProjectTeamMessage(`${name} queued for invitation when the project is created.`);
  }

  function removeQueuedNewProjectInvite(email: string) {
    setQueuedNewProjectInvites((previous) => previous.filter((invite) => normalizeEmail(invite.email) !== normalizeEmail(email)));
  }

  async function updateProjectSettings(event: FormSubmitEvent) {
    event.preventDefault();
    const title = projectSettingsForm.title.trim();
    const dueDate = projectSettingsForm.dueDate.trim();
    if (!title || (dueDate.length > 0 && !isEuDate(dueDate))) {
      setProjectSettingsMessage("Enter a review title. If due date is provided, use dd-mm-yyyy format.");
      return;
    }

    try {
      setIsSavingProjectSettings(true);
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}`, {
        method: "PATCH",
        body: JSON.stringify(projectSettingsForm)
      });
      applyAppState(payload);

      // Reload state after save so derived screening context reflects persisted server values.
      const refreshedPayload = await apiRequest<AppStatePayload>("/api/app-state");
      applyAppState(refreshedPayload);

      setProjectSettingsMessage("Project settings saved.");
    } catch (error) {
      setProjectSettingsMessage(getErrorMessage(error));
    } finally {
      setIsSavingProjectSettings(false);
    }
  }

  function addExtractionTemplateField(type: ExtractionFieldType) {
    setExtractionTemplateForm((previous) => ({
      ...previous,
      fields: [...previous.fields, createBlankExtractionField(type)]
    }));
  }

  function updateExtractionTemplateField(fieldId: string, updates: Partial<ExtractionTemplateFieldForm>) {
    setExtractionTemplateForm((previous) => ({
      ...previous,
      fields: previous.fields.map((field) => {
        if (field.id !== fieldId) {
          return field;
        }
        const nextType = updates.type ?? field.type;
        return {
          ...field,
          ...updates,
          optionsText: nextType === "multiline_text" ? "" : (updates.optionsText ?? field.optionsText) || "Yes\nNo"
        };
      })
    }));
  }

  function removeExtractionTemplateField(fieldId: string) {
    setExtractionTemplateForm((previous) => ({
      ...previous,
      fields: previous.fields.length > 1 ? previous.fields.filter((field) => field.id !== fieldId) : previous.fields
    }));
  }

  async function createExtractionTemplate(event: FormSubmitEvent) {
    event.preventDefault();
    setExtractionMessage("");
    setIsCreatingExtractionTemplate(true);
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/extraction-template`, {
        method: "POST",
        body: JSON.stringify({
          title: extractionTemplateForm.title,
          fields: extractionTemplateForm.fields.map((field) => ({
            id: field.id,
            title: field.title,
            type: field.type,
            options: field.optionsText
              .split(/\r?\n/)
              .map((option) => option.trim())
              .filter(Boolean)
          }))
        })
      });
      applyAppState(payload);
      setExtractionMessage("Data template created.");
    } catch (error) {
      setExtractionMessage(getErrorMessage(error));
    } finally {
      setIsCreatingExtractionTemplate(false);
    }
  }

  function updateExtractionValue(fieldId: string, value: ExtractionResponseValue) {
    setExtractionFormValues((previous) => ({
      ...previous,
      [fieldId]: value
    }));
  }

  function toggleExtractionChoice(fieldId: string, option: string, checked: boolean) {
    const currentValue = extractionFormValues[fieldId];
    const currentChoices = Array.isArray(currentValue) ? currentValue : [];
    updateExtractionValue(fieldId, checked ? [...currentChoices, option] : currentChoices.filter((choice) => choice !== option));
  }

  function updateConsensusValue(fieldId: string, value: ExtractionResponseValue) {
    setConsensusFormValues((previous) => ({
      ...previous,
      [fieldId]: value
    }));
  }

  function toggleConsensusChoice(fieldId: string, option: string, checked: boolean) {
    const currentValue = consensusFormValues[fieldId];
    const currentChoices = Array.isArray(currentValue) ? currentValue : [];
    updateConsensusValue(fieldId, checked ? [...currentChoices, option] : currentChoices.filter((choice) => choice !== option));
  }

  async function submitExtractionResponse(event: FormSubmitEvent) {
    event.preventDefault();
    if (!activeExtractionTemplate || !activeExtractionReport) {
      return;
    }

    setExtractionMessage("");
    setIsSubmittingExtractionResponse(true);
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/extractions`, {
        method: "POST",
        body: JSON.stringify({
          templateId: activeExtractionTemplate.id,
          reportId: activeExtractionReport.id,
          studyId: activeExtractionReport.studyId,
          values: extractionFormValues
        })
      });
      applyAppState(payload);
      setExtractionMessage("Extraction submitted.");
    } catch (error) {
      setExtractionMessage(getErrorMessage(error));
    } finally {
      setIsSubmittingExtractionResponse(false);
    }
  }

  async function finalizeExtractionConsensus(event: FormSubmitEvent) {
    event.preventDefault();
    if (!activeExtractionTemplate || !activeExtractionReport) {
      return;
    }

    setConsensusMessage("");
    setIsFinalizingExtractionConsensus(true);
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/extractions/consensus`, {
        method: "POST",
        body: JSON.stringify({
          templateId: activeExtractionTemplate.id,
          reportId: activeExtractionReport.id,
          studyId: activeExtractionReport.studyId,
          resolvedValues: consensusFormValues
        })
      });
      applyAppState(payload);
      setConsensusMessage("Consensus finalized.");
    } catch (error) {
      setConsensusMessage(getErrorMessage(error));
    } finally {
      setIsFinalizingExtractionConsensus(false);
    }
  }

  async function downloadConsensusExtractionCsv() {
    setExportMessage("");
    setIsExportingConsensusCsv(true);

    try {
      const response = await fetch(`/api/projects/${selectedProject.id}/exports`, {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
        throw new Error(errorPayload?.error || "Failed to export consensus CSV.");
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileNameMatch = /filename="?([^";]+)"?/i.exec(disposition);
      link.href = objectUrl;
      link.download = fileNameMatch?.[1] || `${selectedProject.id}-consensus-extraction.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      setExportMessage("Consensus extraction CSV downloaded.");
    } catch (error) {
      setExportMessage(getErrorMessage(error));
    } finally {
      setIsExportingConsensusCsv(false);
    }
  }

  async function importCitationFile(format: ImportBatch["format"], event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setImportMessage(`Importing ${file.name}...`);
    try {
      const content = await file.text();
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/imports`, {
        method: "POST",
        body: JSON.stringify({
          format,
          filename: file.name,
          byteSize: file.size,
          content
        })
      });
      applyAppState(payload);
      const importedBatchId = payload.imports.find((batch) => batch.projectId === selectedProject.id)?.id ?? "";
      const successMessage = payload.message || `${file.name} imported and stored on the server.`;
      setSelectedImportId(importedBatchId);
      setIsImportEditorOpen(Boolean(importedBatchId));
      setImportDetailMessage(successMessage);
      setImportMessage(successMessage);
    } catch (error) {
      setImportMessage(getErrorMessage(error));
    }
  }

  function openImportEditor(importId: string) {
    setSelectedImportId(importId);
    setStudyEditId("");
    setStudyEditForm(emptyStudyEditForm);
    setImportDetailMessage("");
    setIsImportEditorOpen(true);
  }

  function closeImportEditor() {
    setIsImportEditorOpen(false);
    setStudyEditId("");
    setStudyEditForm(emptyStudyEditForm);
    setImportDetailMessage("");
  }

  async function updateImportDetails(event: FormSubmitEvent) {
    event.preventDefault();
    if (!selectedImportId) {
      return;
    }

    setIsSavingImportDetails(true);
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/imports/${selectedImportId}`, {
        method: "PATCH",
        body: JSON.stringify(importDetailForm)
      });
      applyAppState(payload);
      setImportDetailMessage("Import details updated.");
    } catch (error) {
      setImportDetailMessage(getErrorMessage(error));
    } finally {
      setIsSavingImportDetails(false);
    }
  }

  async function reviewImportWarnings(importId: string) {
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/imports/${importId}/review`, {
        method: "POST"
      });
      applyAppState(payload);
      setImportDetailMessage("Parser warnings reviewed.");
    } catch (error) {
      setImportDetailMessage(getErrorMessage(error));
    }
  }

  function editImportStudy(study: Study) {
    setStudyEditId(study.id);
    setStudyEditForm({
      title: study.title,
      authors: study.authors.join("; "),
      journal: study.journal,
      year: study.year > 0 ? String(study.year) : "",
      doi: study.doi,
      keywords: study.keywords.join("; "),
      abstract: study.abstract
    });
    setImportDetailMessage("");
  }

  async function updateImportStudy(event: FormSubmitEvent) {
    event.preventDefault();
    if (!selectedImportId || !studyEditId) {
      return;
    }

    setIsSavingStudyEdit(true);
    try {
      const payload = await apiRequest<AppMutationPayload>(
        `/api/projects/${selectedProject.id}/imports/${selectedImportId}/studies/${studyEditId}`,
        {
          method: "PATCH",
          body: JSON.stringify(studyEditForm)
        }
      );
      applyAppState(payload);
      setStudyEditId("");
      setStudyEditForm(emptyStudyEditForm);
      setImportDetailMessage("Citation entry updated.");
    } catch (error) {
      setImportDetailMessage(getErrorMessage(error));
    } finally {
      setIsSavingStudyEdit(false);
    }
  }

  async function deleteImportStudy(study: Study) {
    if (!selectedImportId || !window.confirm(`Delete "${study.title}" from this import batch?`)) {
      return;
    }

    try {
      const payload = await apiRequest<AppMutationPayload>(
        `/api/projects/${selectedProject.id}/imports/${selectedImportId}/studies/${study.id}`,
        {
          method: "DELETE"
        }
      );
      applyAppState(payload);
      if (studyEditId === study.id) {
        setStudyEditId("");
        setStudyEditForm(emptyStudyEditForm);
      }
      setImportDetailMessage("Citation entry deleted.");
    } catch (error) {
      setImportDetailMessage(getErrorMessage(error));
    }
  }

  async function deleteImportBatch(importId: string) {
    if (!window.confirm("Delete this import batch and all of its citation entries?")) {
      return;
    }

    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/imports/${importId}`, {
        method: "DELETE"
      });
      applyAppState(payload);
      setSelectedImportId("");
      closeImportEditor();
      setImportMessage("Import batch deleted.");
    } catch (error) {
      setImportDetailMessage(getErrorMessage(error));
    }
  }

  async function updateAccount(event: FormSubmitEvent, action: ProfileSaveAction) {
    event.preventDefault();
    if (pendingAccountAction) {
      return;
    }

    setAccountMessage("");
    setAccountMessageTarget(action);
    setPendingAccountAction(action);
    try {
      const payload = await apiRequest<AppStatePayload>("/api/me", {
        method: "PATCH",
        body: JSON.stringify(accountForm)
      });
      applyAppState(payload);
      setAccountForm((previous) => ({
        ...previous,
        currentPassword: "",
        newPassword: ""
      }));
      setAccountMessage(action === "preferences" ? "Preferences saved." : "Account details saved.");
    } catch (error) {
      setAccountMessage(getErrorMessage(error));
    } finally {
      setPendingAccountAction(null);
    }
  }

  async function adminResetUserPassword(user: AppUser) {
    setPendingAdminUserAction({ userId: user.id, action: "reset" });
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST"
      });
      applyAppState(payload);
      setAdminDirectoryMessage(`Temporary password for ${user.name}: ${payload.temporaryPassword ?? "not returned"}`);
    } catch (error) {
      setAdminDirectoryMessage(getErrorMessage(error));
    } finally {
      setPendingAdminUserAction((previous) => (previous?.userId === user.id ? null : previous));
    }
  }

  async function adminDeleteUser(user: AppUser) {
    if (!window.confirm(`Delete account \"${user.name}\"? This also removes their memberships and owned projects.`)) {
      return;
    }

    setPendingAdminUserAction({ userId: user.id, action: "delete" });
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/admin/users/${user.id}`, {
        method: "DELETE"
      });
      applyAppState(payload);
      setAdminDirectoryMessage(payload.message ?? `Deleted account ${user.name}.`);
    } catch (error) {
      setAdminDirectoryMessage(getErrorMessage(error));
    } finally {
      setPendingAdminUserAction((previous) => (previous?.userId === user.id ? null : previous));
    }
  }

  async function adminCreateUser(event: FormSubmitEvent) {
    event.preventDefault();
    setAdminDirectoryMessage("");

    try {
      setIsCreatingAdminUser(true);
      const payload = await apiRequest<AppMutationPayload>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(adminCreateUserForm)
      });
      applyAppState(payload);
      setAdminCreateUserForm((previous) => ({
        ...previous,
        name: "",
        email: ""
      }));
      setAdminDirectoryMessage(payload.message ?? "User account created.");
    } catch (error) {
      setAdminDirectoryMessage(getErrorMessage(error));
    } finally {
      setIsCreatingAdminUser(false);
    }
  }

  async function updateRegistrationSetting(registrationEnabled: boolean) {
    setAuthSettingsMessage("");
    setIsUpdatingRegistrationSetting(true);
    try {
      const payload = await apiRequest<AppMutationPayload>("/api/admin/auth-settings", {
        method: "PATCH",
        body: JSON.stringify({ registrationEnabled })
      });
      applyAppState(payload);
      setAuthSettingsMessage(payload.message ?? (registrationEnabled ? "Public registration enabled." : "Public registration disabled."));
    } catch (error) {
      setAuthSettingsMessage(getErrorMessage(error));
    } finally {
      setIsUpdatingRegistrationSetting(false);
    }
  }

  async function updateCheckoutWindowSettings(event: FormSubmitEvent) {
    event.preventDefault();
    setAuthSettingsMessage("");
    setIsUpdatingRegistrationSetting(true);
    try {
      const payload = await apiRequest<AppMutationPayload>("/api/admin/auth-settings", {
        method: "PATCH",
        body: JSON.stringify({
          registrationEnabled: authSettings.registrationEnabled,
          screeningCheckoutWindowMinutes: authSettingsForm.screeningCheckoutWindowMinutes,
          extractionCheckoutWindowMinutes: authSettingsForm.extractionCheckoutWindowMinutes
        })
      });
      applyAppState(payload);
      setAuthSettingsMessage(payload.message ?? "Checkout windows saved.");
    } catch (error) {
      setAuthSettingsMessage(getErrorMessage(error));
    } finally {
      setIsUpdatingRegistrationSetting(false);
    }
  }

  async function addScreeningDecision(decisionValue: Exclude<DecisionValue, "not_retrieved">) {
    if (activeScreeningStudies.length === 0) {
      return;
    }

    setPendingScreeningDecision(decisionValue);
    try {
      const payload = await apiRequest<AppMutationPayload>("/api/decisions", {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProject.id,
          studyId: currentStudy.id,
          decisionValue,
          note: screeningNote
        })
      });
      applyAppState(payload);
      if (payload.decisionAction) {
        setDecisionActions((previous) => [...previous, payload.decisionAction as DecisionAction]);
      }
      setScreeningNote("");
      const nextProject = payload.projects.find((project) => project.id === selectedProject.id) ?? selectedProject;
      const nextProjectStudies = hasProjectSeedData ? screeningStudies : payload.studies.filter((study) => study.projectId === selectedProject.id);
      const nextActiveStudies = getActiveTitleAbstractStudies(nextProject, nextProjectStudies, payload.decisions, currentUser.id);
      const currentStudyNextIndex = nextActiveStudies.findIndex((study) => study.id === currentStudy.id);
      const nextStudyIndex =
        currentStudyNextIndex >= 0
          ? Math.min(currentStudyNextIndex + 1, Math.max(nextActiveStudies.length - 1, 0))
          : Math.min(studyIndex, Math.max(nextActiveStudies.length - 1, 0));
      setStudyIndex(nextStudyIndex);
    } catch (error) {
      setLoginError(getErrorMessage(error));
    } finally {
      setPendingScreeningDecision(null);
    }
  }

  async function undoLastDecision() {
    const lastAction = decisionActions[decisionActions.length - 1];
    if (!lastAction) {
      return;
    }

    setIsUndoingScreeningDecision(true);
    try {
      const payload = await apiRequest<AppMutationPayload>("/api/decisions/undo", {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProject.id,
          studyId: lastAction.studyId,
          previousDecisionId: lastAction.previousDecisionId
        })
      });
      applyAppState(payload);
      setDecisionActions((previous) => previous.slice(0, -1));
      const nextProject = payload.projects.find((project) => project.id === selectedProject.id) ?? selectedProject;
      const nextProjectStudies = hasProjectSeedData ? screeningStudies : payload.studies.filter((study) => study.projectId === selectedProject.id);
      const nextActiveStudies = getActiveTitleAbstractStudies(nextProject, nextProjectStudies, payload.decisions, currentUser.id);
      const restoredStudyIndex = nextActiveStudies.findIndex((study) => study.id === lastAction.studyId);
      setStudyIndex(restoredStudyIndex >= 0 ? restoredStudyIndex : 0);
    } catch (error) {
      setLoginError(getErrorMessage(error));
    } finally {
      setIsUndoingScreeningDecision(false);
    }
  }

  async function updateDedupCandidate(candidateId: string, status: DedupCandidate["status"]) {
    setPendingDedupAction(status);
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/dedup-candidates/${candidateId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      applyAppState(payload);
    } catch (error) {
      setLoginError(getErrorMessage(error));
    } finally {
      setPendingDedupAction(null);
    }
  }

  async function updateFullTextReport(input: {
    retrievalStatus?: Report["retrievalStatus"];
    decisionValue?: DecisionValue;
    exclusionReasonId?: string;
  }) {
    if (!activeReport?.id) {
      return;
    }

    const action = input.decisionValue === "include" ? "include" : input.decisionValue === "exclude" ? "exclude" : "retrieval";
    setPendingFullTextAction(action);
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/reports/${activeReport.id}`, {
        method: "PATCH",
        body: JSON.stringify(input)
      });
      applyAppState(payload);
      setFullTextMessage(input.decisionValue ? "Full-text decision saved." : "Retrieval status updated.");
    } catch (error) {
      setFullTextMessage(getErrorMessage(error));
    } finally {
      setPendingFullTextAction(null);
    }
  }

  async function uploadReportPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeReport?.id) {
      return;
    }

    setFullTextMessage(`Uploading ${file.name}...`);
    setPendingFullTextAction("upload");
    try {
      const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/reports/${activeReport.id}/pdf`, {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/pdf",
          size: file.size,
          contentBase64
        })
      });
      applyAppState(payload);
      setFullTextMessage(`${file.name} uploaded.`);
    } catch (error) {
      setFullTextMessage(getErrorMessage(error));
    } finally {
      setPendingFullTextAction(null);
    }
  }

  function renderActiveView() {
    switch (activeView) {
      case "dashboard":
        return renderPortfolioDashboard();
      case "projectDashboard":
        return renderProjectDashboard();
      case "imports":
        return renderImports();
      case "dedup":
        return renderDedup();
      case "screening":
        return renderScreening();
      case "fullText":
        return renderFullText();
      case "extraction":
        return renderExtraction();
      case "consensus":
        return renderConsensus();
      case "risk":
        return renderRisk();
      case "exports":
        return renderExports();
      case "audit":
        return renderAuditTrail();
      case "settings":
        return renderSettings();
      case "newProject":
        return renderNewProject();
      case "about":
        return renderAbout();
      case "adminReviews":
        return currentUser.isAdmin ? renderAdminReviews() : renderProfile();
      case "registeredUsers":
        return currentUser.isAdmin ? renderRegisteredUsers() : renderProfile();
      case "profile":
        return renderProfile();
      default:
        return renderPortfolioDashboard();
    }
  }

  function renderPortfolioDashboard() {
    return (
      <DashboardSection
        currentUser={currentUser}
        userProjects={userProjects}
        users={users}
        dashboardMessage={dashboardMessage}
        getProjectPhaseProgress={(project) => {
          const projectStudies = project.id === "demo-review" ? screeningStudies : studies.filter((study) => study.projectId === project.id);
          const projectReports = project.id === "demo-review" ? reportQueue : getWorkflowReportsForProject(project, projectStudies, reports);
          return getProjectPhaseProgress(
            project,
            getCountsForProject(project, projectStudies, projectReports, decisions, extractionResponses, extractionTemplates),
            projectReports,
            formatNumber
          );
        }}
        formatProjectPhase={formatProjectPhase}
        projectPhaseBadgeTone={projectPhaseBadgeTone}
        openProject={openProject}
        formatEuDate={formatEuDate}
      />
    );
  }

  function renderProjectDashboard() {
    return (
      <ProjectDashboardSection
        selectedProject={selectedProject}
        recordsIdentified={recordsIdentified}
        activeCounts={activeCounts}
        reportsExcludedTotal={reportsExcludedTotal}
        workflowConflicts={workflowConflicts}
        exportFailedCount={exportConsistency.failedCount}
        projectEvents={projectEvents}
        latestProjectEvents={latestProjectEvents}
        projectScreeningStudies={projectScreeningStudies}
        projectReportQueue={projectReportQueue}
        projectUserStats={projectUserStats}
        formatNumber={formatNumber}
        formatProjectPhase={formatProjectPhase}
        projectPhaseStatusTone={projectPhaseStatusTone}
        formatMaybePolicy={formatMaybePolicy}
        getWorkflowStepState={getSelectedProjectWorkflowStepState}
        formatConflictStage={formatConflictStage}
        decisionTone={decisionTone}
        formatDecision={formatDecision}
        formatAuditTime={formatAuditTime}
        formatAuditEntityLabel={formatAuditEntityLabel}
        openConflict={openConflict}
        onOpenSettings={() => navigateToProjectView("settings")}
        onOpenAudit={() => navigateToProjectView("audit")}
      />
    );
  }

  function renderImportEditor(batch: ImportBatch, batchStudies: Study[], warningMessages: string[]) {
    return (
      <ImportEditorSection
        batch={batch}
        batchStudies={batchStudies}
        warningMessages={warningMessages}
        importDetailMessage={importDetailMessage}
        importDetailForm={importDetailForm}
        studyEditId={studyEditId}
        studyEditForm={studyEditForm}
        isSavingImportDetails={isSavingImportDetails}
        isSavingStudyEdit={isSavingStudyEdit}
        closeImportEditor={closeImportEditor}
        deleteImportBatch={deleteImportBatch}
        openScreening={() => navigateToProjectView("screening")}
        updateImportDetails={updateImportDetails}
        onImportSourceNameChange={(value) => setImportDetailForm((previous) => ({ ...previous, sourceName: value }))}
        onImportFilenameChange={(value) => setImportDetailForm((previous) => ({ ...previous, filename: value }))}
        reviewImportWarnings={reviewImportWarnings}
        updateImportStudy={updateImportStudy}
        onStudyEditFormChange={(updates) => setStudyEditForm((previous) => ({ ...previous, ...updates }))}
        cancelStudyEdit={() => {
          setStudyEditId("");
          setStudyEditForm(emptyStudyEditForm);
        }}
        editImportStudy={editImportStudy}
        deleteImportStudy={deleteImportStudy}
      />
    );
  }

  function renderImports() {
    const selectedReviewBatch =
      projectImportBatches.find((batch) => batch.id === selectedImportId) ??
      projectImportBatches.find((batch) => batch.parserWarnings > 0) ??
      projectImportBatches[0];
    const selectedImportStudies = selectedReviewBatch
      ? studies.filter((study) => study.projectId === selectedProject.id && study.importBatchId === selectedReviewBatch.id)
      : [];
    const selectedBatchWarnings = selectedReviewBatch?.parserWarningMessages ?? [];

    if (isImportEditorOpen && selectedReviewBatch) {
      return renderImportEditor(selectedReviewBatch, selectedImportStudies, selectedBatchWarnings);
    }

    return (
      <ImportsSection
        projectImportBatches={projectImportBatches}
        selectedReviewBatch={selectedReviewBatch}
        importMessage={importMessage}
        bibtexInputRef={bibtexInputRef}
        risInputRef={risInputRef}
        onImportCitationFile={importCitationFile}
        onOpenImportEditor={openImportEditor}
      />
    );
  }

  function renderDedup() {
    return (
      <DedupSection
        latestPendingDedup={latestPendingDedup}
        projectImportBatches={projectImportBatches}
        projectScreeningStudies={projectScreeningStudies}
        recordsIdentified={recordsIdentified}
        projectDedupCandidates={projectDedupCandidates}
        pendingDedupAction={pendingDedupAction}
        updateDedupCandidate={updateDedupCandidate}
      />
    );
  }

  function renderScreening() {
    return (
      <ScreeningSection
        projectScreeningStudies={activeScreeningStudies}
        totalScreeningStudyCount={projectScreeningStudies.length}
        screeningProgress={screeningProgress}
        screenedByMe={screenedByMe}
        decisions={decisions}
        selectedProjectId={selectedProject.id}
        currentUserId={currentUser.id}
        studyIndex={studyIndex}
        setStudyIndex={setStudyIndex}
        titleAbstractEvaluations={titleAbstractConflictEvaluations}
        currentStudy={currentStudy}
        stageEvaluation={titleAbstractConflictEvaluations.get(currentStudy.id) ?? stageEvaluation}
        screeningNote={screeningNote}
        setScreeningNote={setScreeningNote}
        currentUserDecision={currentUserDecision}
        currentStageDecisions={currentStageDecisions}
        formatDecision={formatDecision}
        decisionTone={decisionTone}
        highlightText={highlightText}
        pendingScreeningDecision={pendingScreeningDecision}
        isUndoingScreeningDecision={isUndoingScreeningDecision}
        formatConflictResolutionHint={formatConflictResolutionHint}
        selectedProjectAbstractRequiredVotes={selectedProject.abstractRequiredVotes}
        addScreeningDecision={addScreeningDecision}
        undoLastDecision={undoLastDecision}
      />
    );
  }

  function renderFullText() {
    return (
      <FullTextSection
        hasProjectSeedData={hasProjectSeedData}
        phaseProgress={getProjectPhaseProgress(selectedProject, activeCounts, projectReportQueue, formatNumber)}
        projectReportQueue={activeFullTextReports}
        totalFullTextReportCount={projectReportQueue.length}
        uploadedPdfCount={projectReportQueue.filter((report) => report.fileName).length}
        activeReport={activeReport}
        decisions={decisions}
        selectedProject={selectedProject}
        currentUser={currentUser}
        fullTextMessage={fullTextMessage}
        setActiveReportId={setActiveReportId}
        setFullTextMessage={setFullTextMessage}
        pdfInputRef={pdfInputRef}
        pendingFullTextAction={pendingFullTextAction}
        uploadReportPdf={uploadReportPdf}
        updateFullTextReport={updateFullTextReport}
        formatDecision={formatDecision}
        formatConflictResolutionHint={formatConflictResolutionHint}
        decisionTone={decisionTone}
        fullTextReason={fullTextReason}
        setFullTextReason={setFullTextReason}
        exclusionReasons={exclusionReasons}
        studies={studies}
      />
    );
  }

  function renderExtraction() {
    return (
      <ExtractionSection
        activeCounts={activeCounts}
        projectReportQueue={projectReportQueue}
        projectExtractionStudyIds={projectExtractionStudyIds}
        selectedProject={selectedProject}
        currentUser={currentUser}
        extractionMessage={extractionMessage}
        activeExtractionTemplate={activeExtractionTemplate}
        createExtractionTemplate={createExtractionTemplate}
        isCreatingExtractionTemplate={isCreatingExtractionTemplate}
        extractionTemplateForm={extractionTemplateForm}
        setExtractionTemplateTitle={(title) =>
          setExtractionTemplateForm((previous) => ({ ...previous, title }))
        }
        removeExtractionTemplateField={removeExtractionTemplateField}
        updateExtractionTemplateField={updateExtractionTemplateField}
        addExtractionTemplateField={addExtractionTemplateField}
        activeExtractionReport={activeExtractionReport}
        projectExtractionReports={activeExtractionReports}
        totalExtractionReportCount={projectExtractionReports.length}
        setActiveView={navigateToProjectView}
        setActiveExtractionReportId={setActiveExtractionReportId}
        setActiveReportId={setActiveReportId}
        projectScreeningStudies={projectScreeningStudies}
        extractionResponses={extractionResponses}
        activeExtractionResponse={activeExtractionResponse}
        submitExtractionResponse={submitExtractionResponse}
        isSubmittingExtractionResponse={isSubmittingExtractionResponse}
        extractionFormValues={extractionFormValues}
        updateExtractionValue={updateExtractionValue}
        toggleExtractionChoice={toggleExtractionChoice}
      />
    );
  }

  function renderConsensus() {
    return (
      <ConsensusSection
        activeCounts={activeCounts}
        selectedProject={selectedProject}
        currentUser={currentUser}
        consensusMessage={consensusMessage}
        activeExtractionTemplate={activeExtractionTemplate}
        projectExtractionReports={projectExtractionReports}
        extractionResponses={extractionResponses}
        extractionConsensus={extractionConsensus}
        activeExtractionReport={activeExtractionReport}
        projectScreeningStudies={projectScreeningStudies}
        activeExtractionConsensus={activeExtractionConsensus}
        setActiveView={navigateToProjectView}
        setActiveExtractionReportId={setActiveExtractionReportId}
        formatExtractionResponseValue={formatExtractionResponseValue}
        formatAuditTime={formatAuditTime}
        finalizeExtractionConsensus={finalizeExtractionConsensus}
        isFinalizingExtractionConsensus={isFinalizingExtractionConsensus}
        consensusFormValues={consensusFormValues}
        updateConsensusValue={updateConsensusValue}
        toggleConsensusChoice={toggleConsensusChoice}
      />
    );
  }

  function renderRisk() {
    return <RiskSection studiesIncluded={activeCounts.studiesIncluded} />;
  }

  function renderExports() {
    const canExportExtractionCsv = Boolean(activeExtractionTemplate) && activeCounts.studiesIncluded > 0;

    return (
      <ExportsSection
        recordsIdentified={recordsIdentified}
        activeCounts={activeCounts}
        reportsExcludedTotal={reportsExcludedTotal}
        exportConsistency={exportConsistency}
        exportMessage={exportMessage}
        isExportingConsensusCsv={isExportingConsensusCsv}
        canExportExtractionCsv={canExportExtractionCsv}
        downloadConsensusExtractionCsv={downloadConsensusExtractionCsv}
        formatNumber={formatNumber}
      />
    );
  }

  function renderAuditTrail() {
    return (
      <AuditTrailSection
        selectedProject={selectedProject}
        projectEvents={projectEvents}
        pagedProjectEvents={pagedProjectEvents}
        currentAuditPage={currentAuditPage}
        auditPageCount={auditPageCount}
        projectScreeningStudies={projectScreeningStudies}
        projectReportQueue={projectReportQueue}
        formatAuditTime={formatAuditTime}
        formatAuditEntityLabel={formatAuditEntityLabel}
        onOpenOverview={() => setActiveView("projectDashboard")}
        onPreviousPage={() => setAuditPage((page) => Math.max(page - 1, 1))}
        onNextPage={() => setAuditPage((page) => Math.min(page + 1, auditPageCount))}
      />
    );
  }

  function renderSettings() {
    return (
      <SettingsSection
        selectedProject={selectedProject}
        currentUser={currentUser}
        users={users}
        projectSettingsForm={projectSettingsForm}
        projectSettingsMessage={projectSettingsMessage}
        updateProjectSettings={updateProjectSettings}
        onSettingsTitleChange={(value) => updateProjectSettingsForm("title", value)}
        onSettingsOrganizationChange={(value) => updateProjectSettingsForm("organization", value)}
        onSettingsProtocolIdChange={(value) => updateProjectSettingsForm("protocolId", value)}
        onSettingsDueDateChange={(value) => updateProjectSettingsForm("dueDate", value)}
        onSettingsDescriptionChange={(value) => updateProjectSettingsForm("description", value)}
        onSettingsSearchStrategiesChange={(value) => updateProjectSettingsForm("searchStrategies", value)}
        onSettingsBlindModeChange={(value) => updateProjectSettingsForm("blindMode", value)}
        onSettingsAbstractVotesChange={(value) => updateProjectSettingsForm("abstractRequiredVotes", value)}
        onSettingsFullTextVotesChange={(value) => updateProjectSettingsForm("fullTextRequiredVotes", value)}
        onSettingsExtractionVotesChange={(value) => updateProjectSettingsForm("extractionRequiredVotes", value)}
        onSettingsMaybePolicyChange={(value) => updateProjectSettingsForm("maybePolicy", value)}
        onSettingsRequireSequentialPhasesChange={(value) => updateProjectSettingsForm("requireSequentialPhases", value)}
        teamUserSearch={teamUserSearch}
        setTeamUserSearch={setTeamUserSearch}
        teamUserSearchResults={teamUserSearchResults}
        addExistingUserToProject={addExistingUserToProject}
        inviteForm={inviteForm}
        onInviteNameChange={(value) => setInviteForm((previous) => ({ ...previous, name: value }))}
        onInviteEmailChange={(value) => setInviteForm((previous) => ({ ...previous, email: value }))}
        onInviteTitleChange={(value) => setInviteForm((previous) => ({ ...previous, title: value }))}
        inviteUserToProject={inviteUserToProject}
        teamMessage={teamMessage}
        toggleProjectOwner={toggleProjectOwner}
        removeUserFromProject={removeUserFromProject}
        teamAddPendingUserId={teamAddPendingUserId}
        teamRolePendingUserId={teamRolePendingUserId}
        teamRemovePendingUserId={teamRemovePendingUserId}
        isInvitingProjectUser={isInvitingProjectUser}
        isSavingProjectSettings={isSavingProjectSettings}
        hasProjectSeedData={hasProjectSeedData}
        deleteProjectMessage={deleteProjectMessage}
        isDeletingProject={isDeletingProject}
        onDeleteProject={deleteCurrentProjectFromSettings}
      />
    );
  }

  function renderNewProject() {
    return (
      <NewProjectSection
        currentUser={currentUser}
        users={users}
        newProjectForm={newProjectForm}
        canCreate={canCreate}
        creationStatus={creationStatus}
        creationSummary={creationSummary}
        onBack={() => setActiveView("dashboard")}
        onSubmit={createProject}
        onTitleChange={(value) => updateNewProjectForm("title", value)}
        onOrganizationChange={(value) => updateNewProjectForm("organization", value)}
        onProtocolIdChange={(value) => updateNewProjectForm("protocolId", value)}
        onDueDateChange={(value) => updateNewProjectForm("dueDate", value)}
        onDescriptionChange={(value) => updateNewProjectForm("description", value)}
        onSearchStrategiesChange={(value) => updateNewProjectForm("searchStrategies", value)}
        onBlindModeChange={(value) => updateNewProjectForm("blindMode", value)}
        onAbstractVotesChange={(value) => updateNewProjectForm("abstractRequiredVotes", value)}
        onFullTextVotesChange={(value) => updateNewProjectForm("fullTextRequiredVotes", value)}
        onExtractionVotesChange={(value) => updateNewProjectForm("extractionRequiredVotes", value)}
        onMaybePolicyChange={(value) => updateNewProjectForm("maybePolicy", value)}
        teamMessage={newProjectTeamMessage}
        memberSearch={newProjectMemberSearch}
        onMemberSearchChange={updateNewProjectMemberSearch}
        memberSearchResults={newProjectMemberSearchResults}
        onAddMember={addExistingMemberToNewProject}
        onRemoveMember={removeMemberFromNewProject}
        inviteDraft={newProjectInviteDraft}
        onInviteNameChange={(value) => setNewProjectInviteDraft((previous) => ({ ...previous, name: value }))}
        onInviteEmailChange={(value) => setNewProjectInviteDraft((previous) => ({ ...previous, email: value }))}
        onInviteTitleChange={(value) => setNewProjectInviteDraft((previous) => ({ ...previous, title: value }))}
        onQueueInvite={queueNewProjectInvite}
        canShowInviteForm={canShowNewProjectInviteForm}
        queuedInvites={queuedNewProjectInvites}
        onRemoveQueuedInvite={removeQueuedNewProjectInvite}
      />
    );
  }

  function renderAbout() {
    return <AboutSection />;
  }

  function renderAdminReviews() {
    return (
      <AdminReviewsSection
        dashboardMessage={dashboardMessage}
        projects={projects}
        users={users}
        formatProjectPhase={formatProjectPhase}
        projectPhaseBadgeTone={projectPhaseBadgeTone}
        formatEuDate={formatEuDate}
        openProject={openProject}
        adminDeleteProject={adminDeleteProject}
      />
    );
  }

  function renderRegisteredUsers() {
    return (
      <RegisteredUsersSection
        users={users}
        currentUser={currentUser}
        adminDirectoryMessage={adminDirectoryMessage}
        authSettings={authSettings}
        authSettingsForm={authSettingsForm}
        authSettingsMessage={authSettingsMessage}
        adminResetUserPassword={adminResetUserPassword}
        adminDeleteUser={adminDeleteUser}
        createUserForm={adminCreateUserForm}
        onCreateUserFormNameChange={(value) => setAdminCreateUserForm((previous) => ({ ...previous, name: value }))}
        onCreateUserFormEmailChange={(value) => setAdminCreateUserForm((previous) => ({ ...previous, email: value }))}
        onCreateUserFormOrganizationChange={(value) => setAdminCreateUserForm((previous) => ({ ...previous, organization: value }))}
        onCreateUserFormTitleChange={(value) => setAdminCreateUserForm((previous) => ({ ...previous, title: value }))}
        onCreateUser={adminCreateUser}
        isCreatingUser={isCreatingAdminUser}
        pendingUserAction={pendingAdminUserAction}
        isUpdatingRegistrationSetting={isUpdatingRegistrationSetting}
        updateRegistrationSetting={updateRegistrationSetting}
        onScreeningCheckoutWindowChange={(value) =>
          setAuthSettingsForm((previous) => ({ ...previous, screeningCheckoutWindowMinutes: value }))
        }
        onExtractionCheckoutWindowChange={(value) =>
          setAuthSettingsForm((previous) => ({ ...previous, extractionCheckoutWindowMinutes: value }))
        }
        updateCheckoutWindowSettings={updateCheckoutWindowSettings}
      />
    );
  }

  function renderProfile() {
    return (
      <ProfileSection
        currentUser={currentUser}
        handleLogout={handleLogout}
        updateAccount={updateAccount}
        accountForm={accountForm}
        onAccountOrganizationChange={(value) => setAccountForm((previous) => ({ ...previous, organization: value }))}
        onAccountTitleChange={(value) => setAccountForm((previous) => ({ ...previous, title: value }))}
        onAccountCurrentPasswordChange={(value) => setAccountForm((previous) => ({ ...previous, currentPassword: value }))}
        onAccountNewPasswordChange={(value) => setAccountForm((previous) => ({ ...previous, newPassword: value }))}
        onAccountThemeChange={(value) =>
          setAccountForm((previous) => ({
            ...previous,
            websiteTheme: value
          }))
        }
        accountMessage={accountMessage}
        accountMessageTarget={accountMessageTarget}
        pendingAccountAction={pendingAccountAction}
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginShell
        registrationEnabled={authSettings.registrationEnabled}
        authMode={authMode}
        loginEmail={loginEmail}
        loginPassword={loginPassword}
        showLoginPassword={showLoginPassword}
        showRegisterPassword={showRegisterPassword}
        loginError={loginError}
        isLoginPending={pendingAuthAction === "login"}
        isRegistrationPending={pendingAuthAction === "register"}
        registerForm={registerForm}
        captchaQuestion={captchaChallenge?.question}
        brandName={BRAND_NAME}
        brandTagline={BRAND_TAGLINE}
        brandLogoAlt={BRAND_LOGO_ALT}
        onSwitchAuthMode={switchAuthMode}
        onLoginSubmit={handleLogin}
        onRegisterSubmit={handleRegistration}
        onLoginEmailChange={setLoginEmail}
        onLoginPasswordChange={setLoginPassword}
        onToggleLoginPassword={toggleLoginPasswordVisibility}
        onToggleRegisterPassword={toggleRegisterPasswordVisibility}
        onRegisterFormChange={updateRegisterForm}
        onRefreshCaptcha={() => loadAuthConfig().catch(() => undefined)}
      />
    );
  }

  const breadcrumbItems = isProjectView
    ? [
        {
          label: "All Reviews",
          onClick: () => {
            setActiveView("dashboard");
            setIsMobileNavOpen(false);
          }
        },
        {
          label: selectedProject.title,
          current: activeView === "projectDashboard",
          onClick:
            activeView === "projectDashboard"
              ? undefined
              : () => {
                  setActiveView("projectDashboard");
                  setIsMobileNavOpen(false);
                }
        },
        ...(activeView === "projectDashboard"
          ? []
          : [
              {
                label: getViewLabel(activeView),
                current: true
              }
            ])
      ]
    : activeView === "dashboard"
      ? [
          {
            label: getViewLabel(activeView),
            current: true
          }
        ]
      : [
          {
            label: "All Reviews",
            onClick: () => {
              setActiveView("dashboard");
              setIsMobileNavOpen(false);
            }
          },
          {
            label: getViewLabel(activeView),
            current: true
          }
        ];

  return (
    <AppShell
      isSidebarCollapsed={isSidebarCollapsed}
      isMobileNavOpen={isMobileNavOpen}
      brandLogoAlt={BRAND_LOGO_ALT}
      currentUser={currentUser}
      breadcrumbItems={breadcrumbItems}
      sidebar={
        <AppSidebar
          brandName={BRAND_NAME}
          brandTagline={BRAND_TAGLINE}
          brandLogoAlt={BRAND_LOGO_ALT}
          isSidebarCollapsed={isSidebarCollapsed}
          isMobileNavOpen={isMobileNavOpen}
          isProjectView={isProjectView}
          activeView={activeView}
          currentUser={currentUser}
          selectedProject={selectedProject}
          globalNavItems={globalNavItems}
          projectNavItems={projectNavItems}
          reviewPhaseNavKeys={reviewPhaseNavKeys}
          exportFailedCount={exportConsistency.failedCount}
          getPhaseNavState={getPhaseNavState}
          canNavigateToProjectView={canNavigateToProjectView}
          formatProjectPhase={formatProjectPhase}
          projectPhaseBadgeTone={projectPhaseBadgeTone}
          onGoDashboard={() => {
            setActiveView("dashboard");
            setIsMobileNavOpen(false);
          }}
          onNavigate={navigateToProjectView}
          onToggleSidebar={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
          onToggleMobileNav={() => setIsMobileNavOpen((open) => !open)}
        />
      }
      onGoDashboard={() => {
        setActiveView("dashboard");
        setIsMobileNavOpen(false);
      }}
      onNavigateProfile={() => {
        setActiveView("profile");
        setIsMobileNavOpen(false);
      }}
      onNavigateAbout={() => {
        setActiveView("about");
        setIsMobileNavOpen(false);
      }}
      onToggleMobileNav={() => setIsMobileNavOpen((open) => !open)}
    >
      {renderActiveView()}
    </AppShell>
  );
}

function getWorkflowReportsForProject(project: ReviewProject, projectStudies: Study[], reports: Report[]) {
  const activeStudyIds = new Set(
    projectStudies
      .filter((study) => study.projectId === project.id && (study.stage === "full_text" || study.stage === "extraction"))
      .map((study) => study.id)
  );
  return reports.filter((report) => report.projectId === project.id && activeStudyIds.has(report.studyId));
}

function getCountsForProject(
  project: ReviewProject,
  projectStudies: Study[] = [],
  projectReports: Report[] = [],
  decisions: Decision[] = [],
  extractionResponses: ExtractionResponse[] = [],
  extractionTemplates: ExtractionTemplate[] = []
): PrismaCounts {
  const fullTextCurrentDecisions = decisions.filter(
    (decision) => decision.projectId === project.id && decision.stage === "full_text" && decision.isCurrent
  );
  const fullTextDecisionsByReport = new Map<string, Decision[]>();
  for (const decision of fullTextCurrentDecisions) {
    const reportKey = decision.reportId ?? decision.studyId;
    fullTextDecisionsByReport.set(reportKey, [...(fullTextDecisionsByReport.get(reportKey) ?? []), decision]);
  }
  const fullTextExcluded = Array.from(fullTextDecisionsByReport.values())
    .filter(
      (reportDecisions) =>
        reportDecisions.length >= project.fullTextRequiredVotes &&
        reportDecisions.every((decision) => decision.decisionValue === "exclude")
    )
    .map((reportDecisions) => reportDecisions[0]);
  const reportsExcludedWithReasons = {
    "Wrong population": 0,
    "Wrong intervention": 0,
    "Wrong comparator": 0,
    "Wrong outcome": 0,
    "Wrong study design": 0,
    "Full text unavailable": 0
  };
  for (const decision of fullTextExcluded) {
    const reason = decision.exclusionReasonId ?? "Wrong study design";
    reportsExcludedWithReasons[reason as keyof typeof reportsExcludedWithReasons] =
      (reportsExcludedWithReasons[reason as keyof typeof reportsExcludedWithReasons] ?? 0) + 1;
  }

  const activeExtractionTemplate = extractionTemplates.find(
    (template) => template.projectId === project.id && template.isActive
  );
  const includedStudyIds = new Set(projectStudies.filter((study) => study.projectId === project.id && study.stage === "extraction").map((study) => study.id));
  const includedReports = projectReports.filter((report) => includedStudyIds.has(report.studyId));
  const studiesExtracted = activeExtractionTemplate
    ? includedReports.filter((report) => {
        const submittedVotes = extractionResponses.filter(
          (response) =>
            response.projectId === project.id &&
            response.reportId === report.id &&
            response.templateId === activeExtractionTemplate.id &&
            response.isSubmitted
        ).length;
        return submittedVotes >= project.extractionRequiredVotes;
      }).length
    : 0;

  return (
    seedProjectCounts[project.id] ?? {
      recordsIdentifiedDatabase: project.recordsTotal,
      recordsIdentifiedRegisters: 0,
      recordsIdentifiedOther: 0,
      duplicateRecordsRemoved: 0,
      automationRemoved: 0,
      removedOtherReasons: 0,
      recordsScreened: project.recordsScreened,
      recordsExcluded: Math.max(project.recordsScreened - projectReports.length, 0),
      reportsSought: projectReports.length,
      reportsNotRetrieved: projectReports.filter((report) => report.retrievalStatus === "not_retrieved").length,
      reportsAssessed: new Set(fullTextCurrentDecisions.map((decision) => decision.reportId ?? decision.studyId)).size,
      reportsExcludedWithReasons,
      studiesIncluded: project.studiesIncluded,
      studiesExtracted,
      studiesIncludedMetaAnalysis: 0
    }
  );
}

function getProjectPhaseProgress(
  project: ReviewProject,
  counts: PrismaCounts,
  projectReports: Report[],
  formatValue: (value: number) => string
): ProjectPhaseProgress {
  if (project.stage === "complete") {
    return {
      percent: 100,
      label: `100% complete · ${formatValue(counts.studiesIncluded)} studies included`
    };
  }

  if (project.stage === "extraction") {
    const total = counts.studiesIncluded;
    const value = counts.studiesExtracted;
    const percent = getProgressPercent(value, total);
    return {
      percent,
      label: `${percent}% extracted · ${formatValue(value)} of ${formatValue(total)} studies`
    };
  }

  if (project.stage === "full_text") {
    const total = projectReports.length > 0 ? projectReports.length : counts.reportsSought;
    const value =
      projectReports.length > 0
        ? projectReports.filter((report) => isFullTextReportComplete(report, project)).length
        : counts.reportsAssessed;
    const percent = getProgressPercent(value, total);
    return {
      percent,
      label: `${percent}% full-text reviewed · ${formatValue(value)} of ${formatValue(total)} reports`
    };
  }

  if (project.stage === "screening") {
    const total = project.recordsTotal;
    const value = Math.min(project.recordsScreened, total);
    const percent = getProgressPercent(value, total);
    return {
      percent,
      label: `${percent}% screened · ${formatValue(value)} of ${formatValue(total)} records`
    };
  }

  const imported = project.recordsTotal || counts.recordsIdentifiedDatabase + counts.recordsIdentifiedRegisters + counts.recordsIdentifiedOther;
  return {
    percent: imported > 0 ? 100 : 0,
    label: `${formatValue(imported)} records imported`
  };
}

function getProgressPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function getCheckoutRefreshIntervalMs(windowMinutes: number) {
  const ttlMs = Math.max(1, Math.min(120, Math.round(windowMinutes))) * 60_000;
  return Math.max(30_000, Math.min(Math.floor(ttlMs / 2), ttlMs - 5_000));
}

function isFullTextReportComplete(report: Report, project: ReviewProject) {
  if (
    report.fullTextStatus === "advance_extraction" ||
    report.fullTextStatus === "excluded_full_text" ||
    report.fullTextStatus === "report_not_retrieved"
  ) {
    return true;
  }

  const requiredVotes = report.fullTextRequiredVotes ?? project.fullTextRequiredVotes;
  return Boolean(report.fullTextVoteCount && report.fullTextVoteCount >= requiredVotes && report.fullTextStatus === "manual_review");
}

function highlightText(text: string) {
  const escapedTerms = highlightRules.map((rule) => escapeRegExp(rule.term));
  const expression = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  const chunks = text.split(expression);

  return chunks.map((chunk, index) => {
    const matchingRule = highlightRules.find((rule) => rule.term.toLowerCase() === chunk.toLowerCase());
    if (!matchingRule) {
      return <span key={`${chunk}-${index}`}>{chunk}</span>;
    }
    return (
      <mark className={`highlight ${matchingRule.type}`} key={`${chunk}-${index}`}>
        {chunk}
      </mark>
    );
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sumObject(values: Record<string, number>) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function isEuDate(value: string) {
  return /^\d{2}-\d{2}-\d{4}$/.test(value);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function formatEuDate(value: string) {
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoMatch) {
    return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  }
  return value;
}

function formatMaybePolicy(value: "advance_to_full_text" | "conflict" | "third_vote") {
  if (value === "advance_to_full_text") {
    return "Advance to full text";
  }
  if (value === "third_vote") {
    return "Request third vote";
  }
  return "Treat as conflict";
}

function isTitleAbstractEvaluationComplete(evaluation: StageEvaluation | undefined) {
  return evaluation?.state === "advance_full_text" || evaluation?.state === "excluded_abstract";
}

function getActiveTitleAbstractStudies(project: ReviewProject, studies: Study[], decisions: Decision[], currentUserId: string) {
  return studies.filter((study) => {
    const currentDecisions = decisions.filter(
      (decision) => decision.projectId === project.id && decision.studyId === study.id && decision.stage === "title_abstract" && decision.isCurrent
    );
    const currentUserHasVoted = currentDecisions.some((decision) => decision.userId === currentUserId);
    const voteCount = study.titleAbstractVoteCount ?? currentDecisions.length;
    const requiredVotes = study.titleAbstractRequiredVotes ?? project.abstractRequiredVotes;
    const activeViewerCount = study.titleAbstractActiveViewerCount ?? 0;
    const checkedOutByCurrentUser = Boolean(study.titleAbstractCheckedOutByCurrentUser);
    const evaluationState =
      study.titleAbstractStatus ??
      evaluateStage(
        "title_abstract",
        currentDecisions.map((decision) => decision.decisionValue),
        requiredVotes,
        project.maybePolicy
      ).state;

    if (evaluationState === "conflict" || evaluationState === "needs_third_vote") {
      return checkedOutByCurrentUser || activeViewerCount < 1;
    }
    if (currentUserHasVoted || voteCount >= requiredVotes) {
      return false;
    }
    return checkedOutByCurrentUser || activeViewerCount < Math.max(requiredVotes - voteCount, 1);
  });
}

function getActiveFullTextReports(project: ReviewProject, reports: Report[], decisions: Decision[], currentUserId: string) {
  return reports.filter((report) => {
    const currentDecisions = decisions.filter(
      (decision) => decision.projectId === project.id && decision.reportId === report.id && decision.stage === "full_text" && decision.isCurrent
    );
    const currentUserHasVoted = currentDecisions.some((decision) => decision.userId === currentUserId);
    const voteCount = report.fullTextVoteCount ?? currentDecisions.length;
    const requiredVotes = report.fullTextRequiredVotes ?? project.fullTextRequiredVotes;
    const activeViewerCount = report.fullTextActiveViewerCount ?? 0;
    const checkedOutByCurrentUser = Boolean(report.fullTextCheckedOutByCurrentUser);
    const evaluationState =
      report.fullTextStatus ??
      evaluateStage(
        "full_text",
        currentDecisions.map((decision) => decision.decisionValue),
        requiredVotes,
        project.maybePolicy
      ).state;

    if (evaluationState === "conflict" || evaluationState === "needs_third_vote") {
      return checkedOutByCurrentUser || activeViewerCount < 1;
    }
    if (
      currentUserHasVoted ||
      voteCount >= requiredVotes ||
      evaluationState === "advance_extraction" ||
      evaluationState === "excluded_full_text" ||
      evaluationState === "report_not_retrieved" ||
      evaluationState === "manual_review"
    ) {
      return false;
    }
    return checkedOutByCurrentUser || activeViewerCount < Math.max(requiredVotes - voteCount, 1);
  });
}

function getActiveExtractionReports(
  project: ReviewProject,
  reports: Report[],
  extractionResponses: ExtractionResponse[],
  templateId: string,
  currentUserId: string
) {
  return reports.filter((report) => {
    const submittedResponses = extractionResponses.filter(
      (response) =>
        response.projectId === project.id &&
        response.reportId === report.id &&
        response.templateId === templateId &&
        response.isSubmitted
    );
    const currentUserHasSubmitted = submittedResponses.some((response) => response.userId === currentUserId);
    const metadataMatchesTemplate = report.extractionTemplateId === templateId;
    const submittedCount = metadataMatchesTemplate ? report.extractionVoteCount ?? submittedResponses.length : submittedResponses.length;
    const requiredVotes = report.extractionRequiredVotes ?? project.extractionRequiredVotes;
    const activeViewerCount = metadataMatchesTemplate ? report.extractionActiveViewerCount ?? 0 : 0;
    const checkedOutByCurrentUser = metadataMatchesTemplate ? Boolean(report.extractionCheckedOutByCurrentUser) : false;

    if (currentUserHasSubmitted || submittedCount >= requiredVotes) {
      return false;
    }
    return checkedOutByCurrentUser || activeViewerCount < Math.max(requiredVotes - submittedCount, 1);
  });
}

function isFullTextEvaluationComplete(evaluation: StageEvaluation | undefined) {
  return (
    evaluation?.state === "advance_extraction" ||
    evaluation?.state === "excluded_full_text" ||
    evaluation?.state === "report_not_retrieved"
  );
}

function formatProjectPhase(stage: ReviewProject["stage"]) {
  if (stage === "setup" || stage === "import") {
    return "Import";
  }
  if (stage === "screening") {
    return "Screening";
  }
  if (stage === "full_text") {
    return "Inclusion";
  }
  if (stage === "extraction") {
    return "Data Extraction";
  }
  return "Complete";
}

function projectPhaseBadgeTone(stage: ReviewProject["stage"]): "success" | "warning" | "danger" | "info" | "neutral" {
  if (stage === "setup" || stage === "import") {
    return "warning";
  }
  if (stage === "screening" || stage === "full_text") {
    return "info";
  }
  if (stage === "extraction" || stage === "complete") {
    return "success";
  }
  return "neutral";
}

function projectPhaseStatusTone(stage: ReviewProject["stage"]): "secure" | "info" | "warning" | "danger" {
  if (stage === "setup" || stage === "import") {
    return "warning";
  }
  if (stage === "extraction" || stage === "complete") {
    return "secure";
  }
  return "info";
}

function getProjectPhaseIndex(stage: ReviewProject["stage"]) {
  if (stage === "setup" || stage === "import") {
    return 0;
  }
  if (stage === "screening") {
    return 1;
  }
  if (stage === "full_text") {
    return 2;
  }
  if (stage === "extraction") {
    return 3;
  }
  return 4;
}

function getPhaseNavState(key: ViewKey, stage: ReviewProject["stage"]): PhaseNavState | null {
  const navPhaseIndex: Partial<Record<ViewKey, number>> = {
    imports: 0,
    dedup: 1,
    screening: 1,
    fullText: 2,
    extraction: 3,
    consensus: 3
  };
  const phaseIndex = navPhaseIndex[key];
  if (phaseIndex === undefined) {
    return null;
  }

  const currentIndex = getProjectPhaseIndex(stage);
  if (phaseIndex < currentIndex) {
    return "done";
  }
  if (phaseIndex === currentIndex) {
    return "current";
  }
  return "pending";
}

function getWorkflowStepState(key: ViewKey, stage: ReviewProject["stage"]) {
  const phaseState = getPhaseNavState(key, stage);
  if (phaseState === "done") {
    return "complete";
  }
  if (phaseState === "current") {
    return "active";
  }
  return "pending";
}

function getProjectUserStats(
  project: ReviewProject,
  users: AppUser[],
  decisions: Decision[],
  reports: Report[],
  extractionResponses: ExtractionResponse[],
  events: WorkflowEvent[]
): ProjectUserStats[] {
  const memberIds = new Set([project.ownerId, ...project.ownerIds, ...project.memberIds]);
  const projectReports = reports.filter((report) => report.projectId === project.id);
  const projectReportIds = new Set(projectReports.map((report) => report.id));
  return users
    .filter((user) => memberIds.has(user.id))
    .map((user) => {
      const uploadedReportIds = new Set(
        projectReports.filter((report) => report.uploadedByUserId === user.id).map((report) => report.id)
      );
      const legacyUploadEvents = events.filter(
        (event) =>
          event.actor === user.name &&
          event.action.startsWith("Uploaded PDF") &&
          projectReportIds.has(event.entity) &&
          !uploadedReportIds.has(event.entity)
      ).length;
      return {
        user,
        screened: countCurrentDecisions(decisions, project.id, user.id, "title_abstract"),
        uploadedPdf: uploadedReportIds.size + legacyUploadEvents,
        fullTextReviews: countCurrentDecisions(decisions, project.id, user.id, "full_text"),
        extractions: extractionResponses.filter(
          (response) => response.projectId === project.id && response.userId === user.id && response.isSubmitted
        ).length
      };
    });
}

function countCurrentDecisions(decisions: Decision[], projectId: string, userId: string, stage: Decision["stage"]) {
  return decisions.filter(
    (decision) => decision.projectId === projectId && decision.userId === userId && decision.stage === stage && decision.isCurrent
  ).length;
}

function formatDecision(value: DecisionValue) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatConflictStage(stage: WorkflowConflict["stage"]) {
  return stage === "full_text" ? "Full text" : "Title/abstract";
}

function formatConflictResolutionHint(requiredVotes: number) {
  return `A conflict remains only while Include and Exclude are tied or neither side has reached ${requiredVotes} required vote${requiredVotes === 1 ? "" : "s"}.`;
}

function formatAuditEntityLabel(
  event: WorkflowEvent,
  project: ReviewProject,
  studies: Study[],
  reports: Report[]
) {
  const study = studies.find((candidate) => candidate.id === event.entity);
  if (study) {
    return study.title;
  }

  const report = reports.find((candidate) => candidate.id === event.entity);
  if (report) {
    return report.title;
  }

  if (event.entity === project.id) {
    return project.title;
  }

  return event.entity;
}

function formatAuditTime(value: string) {
  const parsedTime = Date.parse(value);
  if (Number.isNaN(parsedTime)) {
    return value;
  }

  return new Date(parsedTime).toLocaleString();
}

function decisionTone(value: DecisionValue): "success" | "warning" | "danger" | "info" | "neutral" {
  if (value === "include") {
    return "success";
  }
  if (value === "exclude") {
    return "danger";
  }
  if (value === "maybe") {
    return "warning";
  }
  if (value === "not_retrieved") {
    return "info";
  }
  return "neutral";
}
