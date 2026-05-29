"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
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
  FileCheck2,
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
  Plus,
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
  type ExtractionResponse,
  type ExtractionResponseValue,
  type ExtractionTemplate,
  type ImportBatch,
  type PrismaCounts,
  type ReviewProject,
  type Report,
  type Study,
  type ViewKey,
  type WorkflowEvent
} from "@/lib/prismaData";
import type { ApiErrorPayload, AppAuthSettings, AppMutationPayload, AppStatePayload, PublicAuthConfigPayload } from "@/lib/apiTypes";
import { evaluateStage, type DecisionValue } from "@/lib/workflow";
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

type WorkflowConflict = {
  id: string;
  stage: "title_abstract" | "full_text";
  title: string;
  subtitle: string;
  label: string;
  decisions: Decision[];
  studyIndex?: number;
  reportId?: string;
};

const numberFormatter = new Intl.NumberFormat("en-US");
const AUDIT_PAGE_SIZE = 10;
const defaultAuthSettings: AppAuthSettings = {
  registrationEnabled: true
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
  { key: "projectDashboard", label: "Project Overview", path: "/project/current/dashboard", Icon: LayoutDashboard },
  { key: "imports", label: "Imports", path: "/project/current/imports", Icon: Import },
  { key: "dedup", label: "Dedup", path: "/project/current/dedup", Icon: GitMerge },
  { key: "screening", label: "Screening", path: "/project/current/screen/title-abstract", Icon: FileSearch },
  { key: "fullText", label: "Full Text", path: "/project/current/full-text", Icon: BookOpen },
  { key: "extraction", label: "Extraction", path: "/project/current/extraction/consensus", Icon: ClipboardCheck },
  //{ key: "risk", label: "Risk of Bias", path: "/project/current/risk-of-bias", Icon: ShieldCheck },
  { key: "exports", label: "Exports", path: "/project/current/exports", Icon: Download },
  { key: "audit", label: "Audit", path: "/project/current/audit", Icon: History },
  { key: "settings", label: "Settings", path: "/project/current/settings", Icon: Settings }
];

const globalViewKeys: ViewKey[] = ["dashboard", "newProject", "about", "adminReviews", "registeredUsers", "profile"];
const viewKeySet = new Set<ViewKey>([
  "dashboard",
  "projectDashboard",
  "imports",
  "dedup",
  "screening",
  "fullText",
  "extraction",
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
      "extraction/consensus": "extraction",
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

type NewProjectForm = {
  title: string;
  organization: string;
  protocolId: string;
  description: string;
  searchStrategies: string;
  dueDate: string;
  blindMode: boolean;
  abstractRequiredVotes: number;
  fullTextRequiredVotes: number;
  extractionRequiredVotes: number;
  maybePolicy: "advance_to_full_text" | "conflict" | "third_vote";
  memberIds: string[];
};

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

const exclusionReasons = Object.keys(prismaCounts.reportsExcludedWithReasons);

const emptyProjectForm: NewProjectForm = {
  title: "",
  organization: "Evidence Methods Unit",
  protocolId: "",
  description: "",
  searchStrategies: "",
  dueDate: "30-09-2026",
  blindMode: true,
  abstractRequiredVotes: 2,
  fullTextRequiredVotes: 2,
  extractionRequiredVotes: 2,
  maybePolicy: "advance_to_full_text",
  memberIds: []
};

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
  maybePolicy: "advance_to_full_text"
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
  fields: [createBlankExtractionField()]
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
  avatarColor: "#167d7f"
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
  const skipUrlSyncRef = useRef(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [authSettings, setAuthSettings] = useState<AppAuthSettings>(defaultAuthSettings);
  const [authSettingsMessage, setAuthSettingsMessage] = useState("");
  const [captchaChallenge, setCaptchaChallenge] = useState<PublicAuthConfigPayload["captcha"] | null>(null);
  const [projects, setProjects] = useState<ReviewProject[]>(reviewProjects);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [studies, setStudies] = useState<Study[]>([]);
  const [reports, setReports] = useState<Report[]>(reportQueue);
  const [extractionTemplates, setExtractionTemplates] = useState<ExtractionTemplate[]>([]);
  const [extractionResponses, setExtractionResponses] = useState<ExtractionResponse[]>([]);
  const [currentUserId, setCurrentUserId] = useState(guestUser.id);
  const [selectedProjectId, setSelectedProjectId] = useState(reviewProjects[0].id);
  const [authMode, setAuthMode] = useState<"signIn" | "register">("signIn");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    organization: "",
    title: "Reviewer",
    password: "",
    captchaAnswer: ""
  });
  const [teamUserId, setTeamUserId] = useState("");
  const [inviteForm, setInviteForm] = useState({
    name: "",
    email: "",
    title: "Reviewer"
  });
  const [teamMessage, setTeamMessage] = useState("");
  const [dashboardMessage, setDashboardMessage] = useState("");
  const [newProjectForm, setNewProjectForm] = useState<NewProjectForm>({
    ...emptyProjectForm,
    memberIds: []
  });
  const [projectSettingsForm, setProjectSettingsForm] = useState<ProjectSettingsForm>(emptyProjectSettingsForm);
  const [projectSettingsMessage, setProjectSettingsMessage] = useState("");
  const [decisions, setDecisions] = useState<Decision[]>(initialDecisions);
  const [events, setEvents] = useState<WorkflowEvent[]>(initialWorkflowEvents);
  const [dedupCandidates, setDedupCandidates] = useState<DedupCandidate[]>(seedDedupCandidates);
  const [studyIndex, setStudyIndex] = useState(0);
  const [decisionActions, setDecisionActions] = useState<DecisionAction[]>([]);
  const [screeningNote, setScreeningNote] = useState("");
  const [activeReportId, setActiveReportId] = useState(reportQueue[0].id);
  const [auditPage, setAuditPage] = useState(1);
  const [activeExtractionReportId, setActiveExtractionReportId] = useState("");
  const [extractionTemplateForm, setExtractionTemplateForm] = useState<ExtractionTemplateForm>(emptyExtractionTemplateForm);
  const [extractionFormValues, setExtractionFormValues] = useState<Record<string, ExtractionResponseValue>>({});
  const [extractionMessage, setExtractionMessage] = useState("");
  const [fullTextReason, setFullTextReason] = useState(exclusionReasons[0]);
  const [fullTextMessage, setFullTextMessage] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [selectedImportId, setSelectedImportId] = useState("");
  const [isImportEditorOpen, setIsImportEditorOpen] = useState(false);
  const [importDetailMessage, setImportDetailMessage] = useState("");
  const [importDetailForm, setImportDetailForm] = useState<ImportDetailForm>(emptyImportDetailForm);
  const [studyEditId, setStudyEditId] = useState("");
  const [studyEditForm, setStudyEditForm] = useState<StudyEditForm>(emptyStudyEditForm);
  const [accountMessage, setAccountMessage] = useState("");
  const [adminDirectoryMessage, setAdminDirectoryMessage] = useState("");
  const [accountForm, setAccountForm] = useState({
    organization: "",
    title: "",
    currentPassword: "",
    newPassword: ""
  });
  const bibtexInputRef = useRef<HTMLInputElement>(null);
  const risInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const currentUser = users.find((user) => user.id === currentUserId) ?? users[0] ?? guestUser;
  const userProjects = useMemo(
    () => (currentUser.isAdmin ? projects : projects.filter((project) => project.memberIds.includes(currentUser.id) || project.ownerIds.includes(currentUser.id) || project.ownerId === currentUser.id)),
    [currentUser.id, currentUser.isAdmin, projects]
  );
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? userProjects[0] ?? projects[0] ?? reviewProjects[0];
  const isProjectView = isProjectScopedView(activeView);
  const hasProjectSeedData = selectedProject.id === "demo-review";
  const projectImportBatches = imports.filter((batch) => batch.projectId === selectedProject.id);
  const projectDedupCandidates = hasProjectSeedData ? dedupCandidates : [];
  const importedProjectStudies = studies.filter((study) => study.projectId === selectedProject.id);
  const projectScreeningStudies = hasProjectSeedData ? screeningStudies : importedProjectStudies;
  const projectReportQueue = hasProjectSeedData ? reportQueue : reports.filter((report) => report.projectId === selectedProject.id);
  const projectExtractionStudyIds = new Set(projectScreeningStudies.filter((study) => study.stage === "extraction").map((study) => study.id));
  const projectExtractionReports = projectReportQueue.filter((report) => projectExtractionStudyIds.has(report.studyId));
  const projectExtractionReportKey = projectExtractionReports.map((report) => report.id).join("|");
  const activeExtractionReport = projectExtractionReports.find((report) => report.id === activeExtractionReportId) ?? projectExtractionReports[0];
  const activeExtractionTemplate =
    extractionTemplates.find((template) => template.projectId === selectedProject.id && template.isActive) ??
    extractionTemplates.find((template) => template.projectId === selectedProject.id);
  const activeExtractionResponse = activeExtractionReport && activeExtractionTemplate
    ? extractionResponses.find(
        (response) =>
          response.projectId === selectedProject.id &&
          response.reportId === activeExtractionReport.id &&
          response.templateId === activeExtractionTemplate.id &&
          response.userId === currentUser.id
      )
    : undefined;
  const activeReport = projectReportQueue.find((report) => report.id === activeReportId) ?? projectReportQueue[0] ?? reportQueue[0];
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
  const workflowConflicts = useMemo<WorkflowConflict[]>(() => {
    const titleAbstractConflicts = projectScreeningStudies.flatMap((study, index) => {
      const currentDecisions = decisions.filter(
        (decision) =>
          decision.projectId === selectedProject.id &&
          decision.studyId === study.id &&
          decision.stage === "title_abstract" &&
          decision.isCurrent
      );
      const evaluation =
        titleAbstractEvaluations.get(study.id) ??
        evaluateStage(
          "title_abstract",
          currentDecisions.map((decision) => decision.decisionValue),
          selectedProject.abstractRequiredVotes,
          selectedProject.maybePolicy
        );

      if (evaluation.state !== "conflict" && evaluation.state !== "needs_third_vote") {
        return [];
      }

      return [
        {
          id: `title_abstract:${study.id}`,
          stage: "title_abstract" as const,
          title: study.title,
          subtitle: `${study.source} · ${study.year > 0 ? study.year : "Year needs review"}`,
          label: evaluation.label,
          decisions: currentDecisions,
          studyIndex: index
        }
      ];
    });

    const fullTextConflicts = projectReportQueue.flatMap((report) => {
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

      if (evaluation.state !== "conflict" && evaluation.state !== "needs_third_vote") {
        return [];
      }

      return [
        {
          id: `full_text:${report.id}`,
          stage: "full_text" as const,
          title: report.title,
          subtitle: report.citation,
          label: evaluation.label,
          decisions: currentDecisions,
          reportId: report.id
        }
      ];
    });

    return [...titleAbstractConflicts, ...fullTextConflicts];
  }, [
    decisions,
    projectReportQueue,
    projectScreeningStudies,
    selectedProject.abstractRequiredVotes,
    selectedProject.fullTextRequiredVotes,
    selectedProject.id,
    selectedProject.maybePolicy,
    titleAbstractEvaluations
  ]);
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
  const currentStudy = projectScreeningStudies[studyIndex] ?? screeningStudies[0];
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
  const screeningProgress =
    projectScreeningStudies.length > 0 ? Math.round((screenedByMe / projectScreeningStudies.length) * 100) : 0;

  async function loadAuthConfig() {
    const payload = await apiRequest<PublicAuthConfigPayload>("/api/auth/config");
    setAuthSettings(payload.authSettings);
    setCaptchaChallenge(payload.captcha);
    if (!payload.authSettings.registrationEnabled) {
      setAuthMode("signIn");
    }
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
      if (routeState.projectId) {
        setSelectedProjectId(routeState.projectId);
      }
    }

    applyUrlState();
    window.addEventListener("popstate", applyUrlState);
    return () => window.removeEventListener("popstate", applyUrlState);
  }, []);

  useEffect(() => {
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
  }, [activeView, selectedProjectId]);

  useEffect(() => {
    if (!isAuthenticated || userProjects.length === 0) {
      return;
    }

    const canAccessSelected = userProjects.some((project) => project.id === selectedProjectId);
    if (!canAccessSelected) {
      setSelectedProjectId(userProjects[0].id);
    }
  }, [isAuthenticated, selectedProjectId, userProjects]);

  useEffect(() => {
    if (!authSettings.registrationEnabled && authMode === "register") {
      setAuthMode("signIn");
      setLoginError("");
    }
  }, [authMode, authSettings.registrationEnabled]);

  useEffect(() => {
    if (!isAuthenticated && authMode === "register" && authSettings.registrationEnabled && !captchaChallenge) {
      loadAuthConfig().catch(() => undefined);
    }
  }, [authMode, authSettings.registrationEnabled, captchaChallenge, isAuthenticated]);

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
        setStudyIndex((index) => Math.min(index + 1, Math.max(projectScreeningStudies.length - 1, 0)));
      }
      if (key === "k" || key === "arrowleft") {
        event.preventDefault();
        setStudyIndex((index) => Math.max(index - 1, 0));
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeView, currentStudy.id, currentUserDecision, decisions, projectScreeningStudies.length, selectedProject.id]);

  useEffect(() => {
    setAccountForm((previous) => ({
      ...previous,
      organization: currentUser.organization,
      title: currentUser.title,
      currentPassword: "",
      newPassword: ""
    }));
    setAccountMessage("");
  }, [currentUser.id, currentUser.organization, currentUser.title]);

  useEffect(() => {
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
      maybePolicy: selectedProject.maybePolicy
    });
    setProjectSettingsMessage("");
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
    selectedProject.searchStrategies,
    selectedProject.title
  ]);

  useEffect(() => {
    setExtractionTemplateForm({ title: "Data Template", fields: [createBlankExtractionField()] });
    setExtractionFormValues({});
    setExtractionMessage("");
    setAuditPage(1);
  }, [selectedProject.id]);

  useEffect(() => {
    if (auditPage > auditPageCount) {
      setAuditPage(auditPageCount);
    }
  }, [auditPage, auditPageCount]);

  useEffect(() => {
    if (projectReportQueue.length === 0) {
      return;
    }
    if (!projectReportQueue.some((report) => report.id === activeReportId)) {
      setActiveReportId(projectReportQueue[0].id);
    }
  }, [activeReportId, projectReportQueue]);

  useEffect(() => {
    if (projectExtractionReports.length === 0) {
      setActiveExtractionReportId("");
      return;
    }
    if (!projectExtractionReports.some((report) => report.id === activeExtractionReportId)) {
      setActiveExtractionReportId(projectExtractionReports[0].id);
    }
  }, [activeExtractionReportId, projectExtractionReportKey, projectExtractionReports]);

  useEffect(() => {
    setExtractionFormValues(activeExtractionResponse?.values ?? {});
    setExtractionMessage("");
  }, [activeExtractionReport?.id, activeExtractionResponse?.id, activeExtractionTemplate?.id, currentUser.id]);

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
              <img src="/icon.svg" alt="Prismatica logo" width={30} height={30} />
            </div>
            <div>
              <strong>Prismatica</strong>
              <span>Open source PRISMA review platform</span>
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
    setDecisions(payload.decisions);
    setEvents(payload.events);
    setDedupCandidates(payload.dedupCandidates);
    setCurrentUserId(payload.currentUser.id);
    setNewProjectForm((previous) => ({
      ...previous,
      organization: payload.currentUser.organization,
      memberIds: Array.from(new Set([payload.currentUser.id, ...previous.memberIds]))
    }));
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

  async function handleLogin(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!loginPassword.trim()) {
      setLoginError("Enter a password to continue.");
      return;
    }

    setLoginError("");
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
      setActiveView("dashboard");
    } catch (error) {
      setLoginError(getErrorMessage(error));
    }
  }

  async function handleRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authSettings.registrationEnabled) {
      setLoginError("Public registration is disabled. Ask an administrator for an account.");
      setAuthMode("signIn");
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
      setLoginEmail(payload.currentUser.email);
      setLoginPassword(registerForm.password);
      setNewProjectForm({
        ...emptyProjectForm,
        organization: payload.currentUser.organization,
        memberIds: [payload.currentUser.id]
      });
      setRegisterForm({
        name: "",
        email: "",
        organization: "",
        title: "Reviewer",
        password: "",
        captchaAnswer: ""
      });
      setIsAuthenticated(true);
      setActiveView("dashboard");
    } catch (error) {
      setLoginError(getErrorMessage(error));
      loadAuthConfig().catch(() => undefined);
      setRegisterForm((previous) => ({ ...previous, captchaAnswer: "" }));
      if (getErrorMessage(error).includes("already has an account")) {
        setAuthMode("signIn");
        setLoginEmail(email);
      }
    }
  }

  async function handleLogout() {
    await apiRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setIsAuthenticated(false);
    setActiveView("dashboard");
    setLoginPassword("");
  }

  function openProject(projectId: string, view: ViewKey = "projectDashboard") {
    setSelectedProjectId(projectId);
    setActiveView(view);
    setIsMobileNavOpen(false);
    setStudyIndex(0);
    setActiveReportId(reportQueue[0].id);
    setFullTextMessage("");
  }

  function openConflict(conflict: WorkflowConflict) {
    setIsMobileNavOpen(false);
    setFullTextMessage("");
    if (conflict.stage === "full_text" && conflict.reportId) {
      setActiveReportId(conflict.reportId);
      setActiveView("fullText");
      return;
    }
    setStudyIndex(conflict.studyIndex ?? 0);
    setActiveView("screening");
  }

  function updateNewProjectForm<Key extends keyof NewProjectForm>(key: Key, value: NewProjectForm[Key]) {
    setNewProjectForm((previous) => ({
      ...previous,
      [key]: value
    }));
  }

  function updateProjectSettingsForm<Key extends keyof ProjectSettingsForm>(key: Key, value: ProjectSettingsForm[Key]) {
    setProjectSettingsForm((previous) => ({
      ...previous,
      [key]: value
    }));
  }

  function toggleProjectMember(userId: string) {
    setNewProjectForm((previous) => {
      const nextMemberIds = previous.memberIds.includes(userId)
        ? previous.memberIds.filter((memberId) => memberId !== userId)
        : [...previous.memberIds, userId];
      return {
        ...previous,
        memberIds: nextMemberIds.length > 0 ? nextMemberIds : [currentUser.id]
      };
    });
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

  async function addExistingUserToProject() {
    if (!teamUserId) {
      setTeamMessage("Choose a user to add.");
      return;
    }

    const user = users.find((candidate) => candidate.id === teamUserId);
    if (!user) {
      setTeamMessage("That user was not found.");
      return;
    }

    if (selectedProject.memberIds.includes(user.id)) {
      setTeamMessage(`${user.name} is already in this review.`);
      return;
    }

    const didUpdate = await updateProjectMembers(
      selectedProject.id,
      [...selectedProject.memberIds, user.id],
      selectedProject.ownerIds,
      `Added ${user.name} to project team`
    );
    if (didUpdate) {
      setTeamUserId("");
      setTeamMessage(`${user.name} added to ${selectedProject.title}.`);
    }
  }

  async function inviteUserToProject(event: FormEvent<HTMLFormElement>) {
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
    }
  }

  async function removeUserFromProject(userId: string) {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
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
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/members/${userId}`, {
        method: "DELETE"
      });
      applyAppState(payload);
      setTeamMessage(`${user.name} removed from ${selectedProject.title}.`);
    } catch (error) {
      setTeamMessage(getErrorMessage(error));
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

  async function toggleProjectOwner(userId: string) {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
      return;
    }

    const nextOwnerIds = selectedProject.ownerIds.includes(userId)
      ? selectedProject.ownerIds.filter((ownerId) => ownerId !== userId)
      : [...selectedProject.ownerIds, userId];

    if (nextOwnerIds.length === 0) {
      setTeamMessage("A project must have at least one owner.");
      return;
    }

    const didUpdate = await updateProjectMembers(
      selectedProject.id,
      selectedProject.memberIds,
      nextOwnerIds,
      `${nextOwnerIds.includes(userId) ? "Promoted" : "Demoted"} ${user.name} ${nextOwnerIds.includes(userId) ? "to owner" : "to reviewer"}`
    );
    if (didUpdate) {
      setTeamMessage(nextOwnerIds.includes(userId) ? `${user.name} is now an owner.` : `${user.name} is now a reviewer.`);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newProjectForm.title.trim();
    if (!title || !isEuDate(newProjectForm.dueDate)) {
      return;
    }

    try {
      const payload = await apiRequest<AppMutationPayload>("/api/projects", {
        method: "POST",
        body: JSON.stringify(newProjectForm)
      });
      applyAppState(payload);
      setSelectedProjectId(payload.selectedProjectId ?? selectedProjectId);
      setNewProjectForm({
        ...emptyProjectForm,
        organization: currentUser.organization,
        memberIds: [currentUser.id]
      });
      setActiveView("projectDashboard");
    } catch (error) {
      setLoginError(getErrorMessage(error));
    }
  }

  async function updateProjectSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = projectSettingsForm.title.trim();
    if (!title || !isEuDate(projectSettingsForm.dueDate)) {
      setProjectSettingsMessage("Enter a review title and a due date in dd-mm-yyyy format.");
      return;
    }

    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}`, {
        method: "PATCH",
        body: JSON.stringify(projectSettingsForm)
      });
      applyAppState(payload);
      setProjectSettingsMessage("Project settings saved.");
    } catch (error) {
      setProjectSettingsMessage(getErrorMessage(error));
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

  async function createExtractionTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExtractionMessage("");
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

  async function submitExtractionResponse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeExtractionTemplate || !activeExtractionReport) {
      return;
    }

    setExtractionMessage("");
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
      setSelectedImportId(importedBatchId);
      setIsImportEditorOpen(Boolean(importedBatchId));
      setImportDetailMessage(`${file.name} imported and stored on the server.`);
      setImportMessage(`${file.name} imported and stored on the server.`);
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

  async function updateImportDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedImportId) {
      return;
    }

    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/imports/${selectedImportId}`, {
        method: "PATCH",
        body: JSON.stringify(importDetailForm)
      });
      applyAppState(payload);
      setImportDetailMessage("Import details updated.");
    } catch (error) {
      setImportDetailMessage(getErrorMessage(error));
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

  async function updateImportStudy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedImportId || !studyEditId) {
      return;
    }

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

  async function updateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountMessage("");
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
      setAccountMessage("Account updated.");
    } catch (error) {
      setAccountMessage(getErrorMessage(error));
    }
  }

  async function adminResetUserPassword(user: AppUser) {
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST"
      });
      applyAppState(payload);
      setAdminDirectoryMessage(`Temporary password for ${user.name}: ${payload.temporaryPassword ?? "not returned"}`);
    } catch (error) {
      setAdminDirectoryMessage(getErrorMessage(error));
    }
  }

  async function adminDeleteUser(user: AppUser) {
    if (!window.confirm(`Delete account \"${user.name}\"? This also removes their memberships and owned projects.`)) {
      return;
    }

    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/admin/users/${user.id}`, {
        method: "DELETE"
      });
      applyAppState(payload);
      setAdminDirectoryMessage(payload.message ?? `Deleted account ${user.name}.`);
    } catch (error) {
      setAdminDirectoryMessage(getErrorMessage(error));
    }
  }

  async function updateRegistrationSetting(registrationEnabled: boolean) {
    setAuthSettingsMessage("");
    try {
      const payload = await apiRequest<AppMutationPayload>("/api/admin/auth-settings", {
        method: "PATCH",
        body: JSON.stringify({ registrationEnabled })
      });
      applyAppState(payload);
      setAuthSettingsMessage(payload.message ?? (registrationEnabled ? "Public registration enabled." : "Public registration disabled."));
    } catch (error) {
      setAuthSettingsMessage(getErrorMessage(error));
    }
  }

  async function addScreeningDecision(decisionValue: Exclude<DecisionValue, "not_retrieved">) {
    if (projectScreeningStudies.length === 0) {
      return;
    }

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
      setStudyIndex((index) => Math.min(index + 1, Math.max(projectScreeningStudies.length - 1, 0)));
    } catch (error) {
      setLoginError(getErrorMessage(error));
    }
  }

  async function undoLastDecision() {
    const lastAction = decisionActions[decisionActions.length - 1];
    if (!lastAction) {
      return;
    }

    const study = projectScreeningStudies.find((candidateStudy) => candidateStudy.id === lastAction.studyId);
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
      if (study) {
        setStudyIndex(projectScreeningStudies.findIndex((candidateStudy) => candidateStudy.id === study.id));
      }
    } catch (error) {
      setLoginError(getErrorMessage(error));
    }
  }

  async function updateDedupCandidate(candidateId: string, status: DedupCandidate["status"]) {
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/dedup-candidates/${candidateId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      applyAppState(payload);
    } catch (error) {
      setLoginError(getErrorMessage(error));
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

    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/reports/${activeReport.id}`, {
        method: "PATCH",
        body: JSON.stringify(input)
      });
      applyAppState(payload);
      setFullTextMessage(input.decisionValue ? "Full-text decision saved." : "Retrieval status updated.");
    } catch (error) {
      setFullTextMessage(getErrorMessage(error));
    }
  }

  async function uploadReportPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeReport?.id) {
      return;
    }

    setFullTextMessage(`Uploading ${file.name}...`);
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
      setFullTextMessage(`${file.name} uploaded. Run validation before including the study.`);
    } catch (error) {
      setFullTextMessage(getErrorMessage(error));
    }
  }

  async function validateReportPdf() {
    if (!activeReport?.id) {
      return;
    }

    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${selectedProject.id}/reports/${activeReport.id}/validate`, {
        method: "POST"
      });
      applyAppState(payload);
      setFullTextMessage("PDF validation completed.");
    } catch (error) {
      setFullTextMessage(getErrorMessage(error));
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
    const totalRecords = userProjects.reduce((total, project) => total + project.recordsTotal, 0);
    const totalConflicts = userProjects.reduce((total, project) => total + project.conflicts, 0);
    const activeReviews = userProjects.filter((project) => project.status === "active").length;

    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Review dashboard</p>
            <h1>Review Projects</h1>
            <p className="subtle">
              {currentUser.name} · {currentUser.organization} · {userProjects.length} accessible reviews{currentUser.isAdmin ? " · admin view" : ""}
            </p>
          </div>
        </section>

        {dashboardMessage ? (
          <section className="panel">
            <div className={dashboardMessage.startsWith("Deleted review") ? "validationItem ok" : "validationItem blocked"}>
              {dashboardMessage.startsWith("Deleted review") ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{dashboardMessage}</span>
            </div>
          </section>
        ) : null}

        {userProjects.length > 0 ? (
        <section className="reviewGrid">
          {userProjects.map((project) => {
            const ownerNames = project.ownerIds
              .map((ownerId) => users.find((user) => user.id === ownerId)?.name)
              .filter((name): name is string => Boolean(name));
            const progress = project.recordsTotal > 0 ? Math.round((project.recordsScreened / project.recordsTotal) * 100) : 0;
            return (
              <article className="panel projectCard" key={project.id}>
                <div className="projectCardHeader">
                  <div>
                    <Badge label={formatProjectPhase(project.stage)} tone={projectPhaseBadgeTone(project.stage)} />
                    <h2>{project.title}</h2>
                    <p>{project.description}</p>
                  </div>
                  <button className="ghostButton iconOnly" type="button" title="Open review project" onClick={() => openProject(project.id)}>
                    <ChevronRight size={18} />
                  </button>
                </div>
                <div className="projectMeta">
                  <span>
                    <Building2 size={15} />
                    {project.organization}
                  </span>
                  <span>
                    <User size={15} />
                    {ownerNames.length > 0 ? ownerNames.join(", ") : "Unassigned owner"}
                  </span>
                  <span>
                    <CalendarClock size={15} />
                    Due {formatEuDate(project.dueDate)}
                  </span>
                </div>
                <div className="progressBlock">
                  <span>{progress}% screened · {formatNumber(project.recordsScreened)} of {formatNumber(project.recordsTotal)} records</span>
                  <div className="progressTrack">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className="projectStats">
                  <span>{project.reviewers} reviewers</span>
                  <span>{project.conflicts} conflicts</span>
                  <span>{project.studiesIncluded} included</span>
                </div>
                <div className="buttonRow">
                  <button className="primaryButton" type="button" onClick={() => openProject(project.id, "projectDashboard")}>
                    <LayoutDashboard size={17} />
                    Open
                  </button>
                  <button className="ghostButton" type="button" onClick={() => openProject(project.id, "screening")}>
                    <FileSearch size={17} />
                    Screen
                  </button>
                </div>
              </article>
            );
          })}
        </section>
        ) : (
        <section className="panel">
          <EmptyState
            icon={FolderPlus}
            title="No review projects yet"
            description="Create your first review project to start importing citations and assigning reviewers."
          />
        </section>
        )}

        <section className="metricGrid" aria-label="Portfolio metrics">
          <Metric label="Accessible reviews" value={userProjects.length.toString()} tone="blue" detail={`${activeReviews} active review projects`} />
          <Metric label="Records across reviews" value={formatNumber(totalRecords)} tone="teal" detail="Counts visible by membership" />
          <Metric label="Open conflicts" value={totalConflicts.toString()} tone="amber" detail="Title/abstract and full-text queues" />
          <Metric label="Team members" value={users.length.toString()} tone="green" detail="Users with review-specific access" />
        </section>

        <section className="panel">
          <SectionTitle icon={Users} title="Users and Membership" action="Demo access model" />
          <div className="userGrid">
            {users.map((user) => (
              <article className="userCard" key={user.id}>
                <span className="avatar" style={{ background: user.avatarColor }}>
                  {user.initials}
                </span>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.title}</span>
                  <small>{projects.filter((project) => project.memberIds.includes(user.id) || project.ownerId === user.id).length} reviews</small>
                  <small>{projects.filter((project) => project.memberIds.includes(user.id) || project.ownerIds.includes(user.id) || project.ownerId === user.id).length} reviews</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderProjectDashboard() {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Project dashboard</p>
            <h1>{selectedProject.title}</h1>
            <p className="subtle">
              {selectedProject.protocolId} · {selectedProject.organization} · {formatProjectPhase(selectedProject.stage)}
            </p>
          </div>
          <div className="toolbarCluster">
            <button className="ghostButton" type="button" title="View notifications">
              <Bell size={17} />
              Alerts
            </button>
            <button className="primaryButton" type="button" title="Open export preview" onClick={() => setActiveView("exports")}>
              <Download size={17} />
              Export
            </button>
          </div>
        </section>

        <section className="metricGrid" aria-label="Project metrics">
          <Metric label="Records identified" value={formatNumber(recordsIdentified)} tone="blue" detail="Database, register, and manual sources" />
          <Metric label="Duplicates removed" value={activeCounts.duplicateRecordsRemoved.toString()} tone="teal" detail="Preserved for PRISMA provenance" />
          <Metric label="Records screened" value={activeCounts.recordsScreened.toString()} tone="amber" detail={`${activeCounts.recordsExcluded} excluded at title/abstract`} />
          <Metric label="Studies included" value={activeCounts.studiesIncluded.toString()} tone="green" detail={`${activeCounts.studiesExtracted} extracted`} />
        </section>

        {workflowConflicts.length > 0 ? (
          <section className="panel">
            <SectionTitle icon={AlertTriangle} title="Conflict Resolution" action={`${workflowConflicts.length} open`} />
            <div className="conflictList">
              {workflowConflicts.map((conflict) => (
                <article className="conflictItem" key={conflict.id}>
                  <div className="conflictMain">
                    <div>
                      <Badge label={formatConflictStage(conflict.stage)} tone={conflict.stage === "full_text" ? "info" : "warning"} />
                      <h3>{conflict.title}</h3>
                      <p>{conflict.subtitle}</p>
                    </div>
                    <div className="voteStrip" aria-label={`${conflict.title} votes`}>
                      {conflict.decisions.map((decision) => (
                        <span className={`votePill ${decisionTone(decision.decisionValue)}`} key={decision.id}>
                          <strong>{decision.userName}</strong>
                          {formatDecision(decision.decisionValue)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button className="ghostButton" type="button" onClick={() => openConflict(conflict)}>
                    <ChevronRight size={17} />
                    Resolve
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="dashboardGrid">
          <div className="panel largePanel">
            <SectionTitle icon={Activity} title="Review Workflow" action="Live state machine" />
            <div className="workflowMap" aria-label="Review workflow">
              {[
                ["Import", `${formatNumber(recordsIdentified)} records`, getWorkflowStepState("imports", selectedProject.stage)],
                ["Deduplicate", `${activeCounts.duplicateRecordsRemoved} removed`, recordsIdentified > 0 ? "complete" : "pending"],
                ["Screen", `${activeCounts.recordsScreened} records`, getWorkflowStepState("screening", selectedProject.stage)],
                ["Inclusion", `${activeCounts.reportsSought} reports`, getWorkflowStepState("fullText", selectedProject.stage)],
                [
                  "Extract",
                  `${activeCounts.studiesExtracted}/${activeCounts.studiesIncluded} extracted`,
                  getWorkflowStepState("extraction", selectedProject.stage)
                ],
                ["Export", "PRISMA 2020", activeCounts.studiesIncluded > 0 ? "ready" : "pending"]
              ].map(([label, value, status]) => (
                <div className={`workflowNode ${status}`} key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="stateRows">
              <StatusRow label="Review phase" value={formatProjectPhase(selectedProject.stage)} tone={projectPhaseStatusTone(selectedProject.stage)} />
              <StatusRow
                label="Extraction progress"
                value={`${activeCounts.studiesExtracted}/${activeCounts.studiesIncluded} extracted`}
                tone={
                  activeCounts.studiesIncluded === 0
                    ? "info"
                    : activeCounts.studiesExtracted >= activeCounts.studiesIncluded
                      ? "secure"
                      : "warning"
                }
              />
              <StatusRow label="Blind mode" value={selectedProject.blindMode ? "Server-enforced visibility model" : "Disabled"} tone="secure" />
              <StatusRow label="Maybe policy" value={formatMaybePolicy(selectedProject.maybePolicy)} tone="info" />
              <StatusRow label="Unresolved conflicts" value={`${selectedProject.conflicts} open conflicts`} tone="warning" />
            </div>
          </div>

          <div className="panel">
            <SectionTitle icon={History} title="Audit Trail" action={projectEvents.length > 5 ? `Latest 5 of ${projectEvents.length}` : "Append-only"} />
            {projectEvents.length > 0 ? (
              <>
                <div className="eventList">
                  {latestProjectEvents.map((event) => (
                    <article className="eventItem" key={event.id}>
                      <div>
                        <strong>{event.action}</strong>
                        <span>
                          {event.actor} · {formatAuditEntityLabel(event, selectedProject, projectScreeningStudies, projectReportQueue)}
                        </span>
                      </div>
                      <time>{formatAuditTime(event.time)}</time>
                    </article>
                  ))}
                </div>
                <div className="auditTrailActions">
                  <button className="ghostButton" type="button" onClick={() => setActiveView("audit")}>
                    <History size={17} />
                    Full Audit
                  </button>
                </div>
              </>
            ) : (
              <EmptyState
                icon={History}
                title="No project events yet"
                description="Imports, decisions, adjudications, and exports will create append-only audit events for this review."
              />
            )}
          </div>
        </section>

        <section className="panel">
          <SectionTitle icon={Users} title="Reviewer Activity" action="Per-user project stats" />
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Reviewer</th>
                  <th>Screened</th>
                  <th>Uploaded PDF</th>
                  <th>Full Text Reviews</th>
                  <th>Extractions</th>
                </tr>
              </thead>
              <tbody>
                {projectUserStats.map((row) => (
                  <tr key={row.user.id}>
                    <td>
                      <strong>{row.user.name}</strong>
                      <span>{row.user.title}</span>
                    </td>
                    <td>{row.screened}</td>
                    <td>{row.uploadedPdf}</td>
                    <td>{row.fullTextReviews}</td>
                    <td>{row.extractions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <SectionTitle icon={BarChart3} title="PRISMA Count Preview" action="Validated counts" />
          <PrismaFlow counts={activeCounts} reportsExcludedTotal={reportsExcludedTotal} />
        </section>
      </div>
    );
  }

  function renderImportEditor(batch: ImportBatch, batchStudies: Study[], warningMessages: string[]) {
    const messageIsSuccess = /imported|updated|deleted|reviewed/i.test(importDetailMessage);

    return (
      <div className="viewStack">
        <section className="overviewBand compactBand">
          <div>
            <p className="eyebrow">Import review</p>
            <h1>{batch.filename}</h1>
            <p className="subtle">
              {batch.format.toUpperCase()} · {batch.records} records · uploaded by {batch.uploadedBy} on {batch.uploadedAt}
            </p>
          </div>
          <div className="toolbarCluster">
            <button className="ghostButton" type="button" onClick={closeImportEditor}>
              <ArrowLeft size={17} />
              Imports
            </button>
            <button className="dangerButton" type="button" onClick={() => deleteImportBatch(batch.id)}>
              <Trash2 size={17} />
              Delete Batch
            </button>
            <button className="primaryButton" type="button" disabled={batchStudies.length === 0} onClick={() => setActiveView("screening")}>
              <FileSearch size={17} />
              Open Screening
            </button>
          </div>
        </section>

        {importDetailMessage ? (
          <div className={messageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
            {messageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
            <span>{importDetailMessage}</span>
          </div>
        ) : null}

        <section className="importEditorLayout">
          <div className="panel">
            <SectionTitle
              icon={Database}
              title="Batch Details"
              action={batch.parserWarnings > 0 ? `${batch.parserWarnings} warnings` : "Ready"}
            />
            <form className="importDetailForm" onSubmit={updateImportDetails}>
              <label>
                <span>Source</span>
                <input
                  value={importDetailForm.sourceName}
                  onChange={(event) => setImportDetailForm((previous) => ({ ...previous, sourceName: event.target.value }))}
                />
              </label>
              <label>
                <span>Filename</span>
                <input
                  value={importDetailForm.filename}
                  onChange={(event) => setImportDetailForm((previous) => ({ ...previous, filename: event.target.value }))}
                />
              </label>
              <div className="buttonRow">
                <button className="primaryButton" type="submit">
                  <Check size={17} />
                  Save Details
                </button>
                {batch.parserWarnings > 0 ? (
                  <button className="ghostButton" type="button" onClick={() => reviewImportWarnings(batch.id)}>
                    <CheckCircle2 size={17} />
                    Mark Reviewed
                  </button>
                ) : null}
              </div>
            </form>

            <div className={batch.parserWarnings > 0 ? "warningBox importReviewBox" : "secureBox importReviewBox"}>
              {batch.parserWarnings > 0 ? <AlertTriangle size={18} /> : <Check size={17} />}
              <div>
                <strong>{batch.status.replace("_", " ")}</strong>
                {warningMessages.length > 0 ? (
                  <ul className="plainList compactList">
                    {warningMessages.slice(0, 10).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : (
                  <span>No parser warnings are open for this batch.</span>
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <SectionTitle icon={FileText} title="Citation Entries" action={`${batchStudies.length} records`} />
            {batchStudies.length > 0 ? (
              <div className="importEntryList">
                {batchStudies.map((study, index) => (
                  <article className={studyEditId === study.id ? "importEntryCard editing" : "importEntryCard"} key={study.id}>
                    {studyEditId === study.id ? (
                      <form className="studyEditForm" onSubmit={updateImportStudy}>
                        <span className="entryReference">Record {index + 1}</span>
                        <label className="wideField">
                          <span>Title</span>
                          <input
                            value={studyEditForm.title}
                            onChange={(event) => setStudyEditForm((previous) => ({ ...previous, title: event.target.value }))}
                          />
                        </label>
                        <div className="formGrid">
                          <label>
                            <span>Authors</span>
                            <input
                              value={studyEditForm.authors}
                              onChange={(event) => setStudyEditForm((previous) => ({ ...previous, authors: event.target.value }))}
                            />
                          </label>
                          <label>
                            <span>Journal</span>
                            <input
                              value={studyEditForm.journal}
                              onChange={(event) => setStudyEditForm((previous) => ({ ...previous, journal: event.target.value }))}
                            />
                          </label>
                          <label>
                            <span>Year</span>
                            <input
                              inputMode="numeric"
                              value={studyEditForm.year}
                              onChange={(event) => setStudyEditForm((previous) => ({ ...previous, year: event.target.value }))}
                            />
                          </label>
                          <label>
                            <span>DOI</span>
                            <input
                              value={studyEditForm.doi}
                              onChange={(event) => setStudyEditForm((previous) => ({ ...previous, doi: event.target.value }))}
                            />
                          </label>
                        </div>
                        <label className="wideField">
                          <span>Keywords</span>
                          <input
                            value={studyEditForm.keywords}
                            onChange={(event) => setStudyEditForm((previous) => ({ ...previous, keywords: event.target.value }))}
                          />
                        </label>
                        <label className="wideField">
                          <span>Abstract</span>
                          <textarea
                            value={studyEditForm.abstract}
                            onChange={(event) => setStudyEditForm((previous) => ({ ...previous, abstract: event.target.value }))}
                          />
                        </label>
                        <div className="buttonRow">
                          <button className="primaryButton" type="submit">
                            <Check size={17} />
                            Save Entry
                          </button>
                          <button
                            className="ghostButton"
                            type="button"
                            onClick={() => {
                              setStudyEditId("");
                              setStudyEditForm(emptyStudyEditForm);
                            }}
                          >
                            <X size={17} />
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="importEntryHeader">
                          <div>
                            <span className="entryReference">Record {study.importItemId ?? index + 1}</span>
                            <strong>{study.title}</strong>
                            <span>
                              {study.authors.length > 0 ? study.authors.join(", ") : "No authors parsed"} · {study.journal} ·{" "}
                              {study.year > 0 ? study.year : "Year needs review"}
                            </span>
                          </div>
                          <div className="buttonRow">
                            <button className="ghostButton" type="button" onClick={() => editImportStudy(study)}>
                              <PenLine size={17} />
                              Edit
                            </button>
                            <button className="dangerButton" type="button" onClick={() => deleteImportStudy(study)}>
                              <Trash2 size={17} />
                              Delete
                            </button>
                          </div>
                        </div>
                        <p className="importAbstract">{study.abstract}</p>
                        {study.parserWarnings && study.parserWarnings.length > 0 ? (
                          <ul className="plainList compactList">
                            {study.parserWarnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState icon={FileText} title="No citation entries" description="This import batch does not contain screening records." />
            )}
          </div>
        </section>
      </div>
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
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Import and provenance</p>
            <h1>Record Intake</h1>
            <p className="subtle">RIS and BibTeX batches remain traceable to the original payload.</p>
          </div>
          <div className="toolbarCluster">
            <input
              className="hiddenFileInput"
              ref={bibtexInputRef}
              type="file"
              accept=".bib,.bibtex,text/x-bibtex,text/plain"
              onChange={(event) => importCitationFile("bib", event)}
            />
            <input
              className="hiddenFileInput"
              ref={risInputRef}
              type="file"
              accept=".ris,application/x-research-info-systems,text/plain"
              onChange={(event) => importCitationFile("ris", event)}
            />
            <button className="ghostButton" type="button" title="Upload an RIS file" onClick={() => risInputRef.current?.click()}>
              <Upload size={17} />
              RIS
            </button>
            <button className="ghostButton" type="button" title="Upload a BibTeX file" onClick={() => bibtexInputRef.current?.click()}>
              <FileArchive size={17} />
              BibTeX
            </button>
          </div>
        </section>
        {importMessage ? (
          <div className={importMessage.startsWith("Importing") || importMessage.includes("imported") ? "validationItem ok" : "validationItem blocked"}>
            {importMessage.startsWith("Importing") || importMessage.includes("imported") ? <Check size={17} /> : <AlertTriangle size={17} />}
            <span>{importMessage}</span>
          </div>
        ) : null}

        <section className="importGrid">
          <div className="panel">
            <SectionTitle icon={Database} title="Import Batches" action="Parser status" />
            {projectImportBatches.length > 0 ? (
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Format</th>
                      <th>Records</th>
                      <th>Warnings</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectImportBatches.map((batch) => (
                      <tr className={batch.id === selectedReviewBatch?.id ? "activeImportRow" : undefined} key={batch.id}>
                        <td>
                          <strong>{batch.sourceName}</strong>
                          <span>{batch.filename}</span>
                        </td>
                        <td>{batch.format.toUpperCase()}</td>
                        <td>{batch.records}</td>
                        <td>{batch.parserWarnings}</td>
                        <td>
                          <Badge label={batch.status.replace("_", " ")} tone={batch.status === "needs_review" ? "warning" : "success"} />
                        </td>
                        <td>
                          <button className="ghostButton" type="button" onClick={() => openImportEditor(batch.id)}>
                            <FileSearch size={17} />
                            Review Import
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={Upload}
                title="No imports yet"
                description="Upload RIS and BibTeX files to populate records for this review."
              />
            )}
          </div>

          <div className="panel">
            <SectionTitle icon={FileText} title="Provenance Model" action="Record -> Report -> Study" />
            <div className="provenanceStack">
              <div>
                <Database size={22} />
                <strong>Imported record</strong>
                <span>One citation from Scopus, IEEE, PubMed, etc.</span>
              </div>
              <ChevronDown size={18} />
              <div>
                <GitMerge size={22} />
                <strong>Study candidate</strong>
                <span>Canonical review unit created after deduplication.</span>
              </div>
              <ChevronDown size={18} />
              <div>
                <BookOpen size={22} />
                <strong>Report</strong>
                <span>Full-text article or PDF associated with the study.</span>
              </div>
            </div>
            <div className="secureBox">
              <Lock size={17} />
              <span>
                {projectImportBatches.length > 0
                  ? "Parser warnings and parsed screening records are tracked per import batch."
                  : "Record provenance will appear here after the first committed import batch."}
              </span>
            </div>
          </div>
        </section>

      </div>
    );
  }

  function renderDedup() {
    if (!latestPendingDedup) {
      const hasImportedRecords = projectImportBatches.some((batch) => batch.records > 0) || projectScreeningStudies.length > 0 || recordsIdentified > 0;
      const hasResolvedDedupCandidates = projectDedupCandidates.length > 0;
      return (
        <div className="viewStack">
          <section className="overviewBand">
            <div>
              <p className="eyebrow">Deduplication</p>
              <h1>Candidate Review</h1>
              <p className="subtle">Duplicate candidates will appear after records are imported and candidate generation runs.</p>
            </div>
          </section>
          <section className="panel">
            <EmptyState
              icon={GitMerge}
              title={hasResolvedDedupCandidates ? "Duplicate review complete" : "No duplicate candidates"}
              description={
                hasImportedRecords
                  ? hasResolvedDedupCandidates
                    ? "All generated duplicate candidates have been resolved."
                    : "No duplicate candidates were generated for the imported records. Screening can continue with the current citations."
                  : "This review is waiting for imported records before deduplication can generate candidate pairs."
              }
            />
          </section>
        </div>
      );
    }

    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Deduplication</p>
            <h1>Candidate Review</h1>
            <p className="subtle">Duplicate records are attached to canonical studies, never deleted.</p>
          </div>
          <div className="segmented">
            <button className="active" type="button">
              Pending {projectDedupCandidates.filter((candidate) => candidate.status === "pending").length}
            </button>
            <button type="button">Confirmed {projectDedupCandidates.filter((candidate) => candidate.status === "confirmed").length}</button>
            <button type="button">Rejected {projectDedupCandidates.filter((candidate) => candidate.status === "rejected").length}</button>
          </div>
        </section>

        <section className="dedupGrid">
          <div className="panel">
            <SectionTitle icon={GitMerge} title="Match Explanation" action={`${Math.round(latestPendingDedup.score * 100)} percent score`} />
            <div className="scoreRing" aria-label="Duplicate score">
              <strong>{latestPendingDedup.score.toFixed(3)}</strong>
              <span>{latestPendingDedup.method}</span>
            </div>
            <div className="scoreBars">
              <ScoreBar label="Title" value={latestPendingDedup.explanation.title} />
              <ScoreBar label="First author" value={latestPendingDedup.explanation.author} />
              <ScoreBar label="Year" value={latestPendingDedup.explanation.year} />
            </div>
            <p className="doiNote">{renderDoiLink(latestPendingDedup.explanation.doi, latestPendingDedup.explanation.doi)}</p>
            <ul className="plainList">
              {latestPendingDedup.explanation.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <div className="buttonRow">
              <button className="primaryButton" type="button" onClick={() => updateDedupCandidate(latestPendingDedup.id, "confirmed")}>
                <Check size={17} />
                Confirm
              </button>
              <button className="dangerButton" type="button" onClick={() => updateDedupCandidate(latestPendingDedup.id, "rejected")}>
                <X size={17} />
                Reject
              </button>
            </div>
          </div>

          <div className="comparisonGrid">
            <RecordComparison title="Record A" source={latestPendingDedup.recordA.source} study={latestPendingDedup.recordA} />
            <RecordComparison title="Record B" source={latestPendingDedup.recordB.source} study={latestPendingDedup.recordB} />
          </div>
        </section>
      </div>
    );
  }

  function renderScreening() {
    if (projectScreeningStudies.length === 0) {
      return (
        <div className="viewStack">
          <section className="overviewBand compactBand">
            <div>
              <p className="eyebrow">Title and abstract screening</p>
              <h1>Reviewer Queue</h1>
              <p className="subtle">Screening starts after imports are committed and canonical studies are created.</p>
            </div>
          </section>
          <section className="panel">
            <EmptyState
              icon={FileSearch}
              title="No citations ready for screening"
              description="Import RIS or BibTeX records to populate the title and abstract screening queue."
            />
          </section>
        </div>
      );
    }

    return (
      <div className="viewStack">
        <section className="overviewBand compactBand">
          <div>
            <p className="eyebrow">Title and abstract screening</p>
            <h1>Reviewer Queue</h1>
            <p className="subtle">Blind mode returns only your decision and aggregate state.</p>
          </div>
          <div className="progressBlock">
            <span>{screeningProgress}% of project queue</span>
            <div className="progressTrack">
              <i style={{ width: `${screeningProgress}%` }} />
            </div>
          </div>
        </section>

        <section className="screeningLayout">
          <aside className="panel queuePanel">
            <SectionTitle icon={ListChecks} title="Queue" action={`${screenedByMe}/${projectScreeningStudies.length}`} />
            <div className="queueList">
              {projectScreeningStudies.map((study, index) => {
                const decision = decisions.find(
                  (candidate) =>
                    candidate.projectId === selectedProject.id &&
                    candidate.studyId === study.id &&
                    candidate.userId === currentUser.id &&
                    candidate.stage === "title_abstract" &&
                    candidate.isCurrent
                );
                const queueEvaluation = titleAbstractEvaluations.get(study.id);
                const hasQueueConflict = queueEvaluation?.state === "conflict" || queueEvaluation?.state === "needs_third_vote";
                return (
                  <button
                    className={index === studyIndex ? "queueItem active" : "queueItem"}
                    type="button"
                    key={study.id}
                    onClick={() => setStudyIndex(index)}
                  >
                    <span>{study.title}</span>
                    <span className="queueBadges">
                      {hasQueueConflict ? <Badge label={queueEvaluation?.label ?? "Resolve conflict"} tone="danger" /> : null}
                      {decision ? <Badge label={formatDecision(decision.decisionValue)} tone={decisionTone(decision.decisionValue)} /> : <Badge label="open" tone="neutral" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <article className="panel citationPanel">
            <div className="citationHeader">
              <div>
                <p className="eyebrow">{currentStudy.source}</p>
                <h2>{currentStudy.title}</h2>
                <p className="subtle">
                  {currentStudy.authors.length > 0 ? currentStudy.authors.join(", ") : "No authors parsed"} · {currentStudy.journal} ·{" "}
                  {currentStudy.year > 0 ? currentStudy.year : "Year needs review"}
                </p>
              </div>
              <Badge label={stageEvaluation.label} tone={stageEvaluation.state === "conflict" ? "danger" : "info"} />
            </div>
            <div className="metaStrip">
              <span>
                DOI {renderDoiLink(currentStudy.doi, currentStudy.doi || "Missing")}
              </span>
              <span className={currentStudy.keywords.length > 0 ? undefined : "emptyMetaValue"}>
                {currentStudy.keywords.length > 0 ? currentStudy.keywords.join(" · ") : "no keywords"}
              </span>
            </div>
            <p className="abstractText">{highlightText(currentStudy.abstract)}</p>
            <textarea
              value={screeningNote}
              onChange={(event) => setScreeningNote(event.target.value)}
              placeholder="My note"
              aria-label="Screening note"
            />
          </article>

          <aside className="panel actionPanel">
            <SectionTitle icon={PanelRight} title="Decision" action="Current reviewer" />
            <div className="decisionState">
              <span>My current vote</span>
              <strong>{currentUserDecision ? formatDecision(currentUserDecision.decisionValue) : "No vote"}</strong>
            </div>
            {stageEvaluation.state === "conflict" || stageEvaluation.state === "needs_third_vote" ? (
              <div className="conflictVotesBox">
                <strong>{stageEvaluation.label}</strong>
                <p>{formatConflictResolutionHint(selectedProject.abstractRequiredVotes)}</p>
                <div className="voteStrip">
                  {currentStageDecisions.map((decision) => (
                    <span className={`votePill ${decisionTone(decision.decisionValue)}`} key={decision.id}>
                      <strong>{decision.userName}</strong>
                      {formatDecision(decision.decisionValue)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="decisionButtons">
              <button className="includeButton" type="button" onClick={() => addScreeningDecision("include")}>
                <CheckCircle2 size={18} />
                Include
              </button>
              <button className="maybeButton" type="button" onClick={() => addScreeningDecision("maybe")}>
                <Minus size={18} />
                Maybe
              </button>
              <button className="excludeButton" type="button" onClick={() => addScreeningDecision("exclude")}>
                <XCircle size={18} />
                Exclude
              </button>
            </div>
            <div className="buttonRow">
              <button className="ghostButton iconOnly" type="button" onClick={() => setStudyIndex((index) => Math.max(index - 1, 0))} title="Previous citation">
                <ArrowLeft size={17} />
              </button>
              <button className="ghostButton" type="button" onClick={undoLastDecision} title="Undo latest decision">
                <History size={17} />
                Undo
              </button>
              <button className="ghostButton iconOnly" type="button" onClick={() => setStudyIndex((index) => Math.min(index + 1, projectScreeningStudies.length - 1))} title="Next citation">
                <ArrowRight size={17} />
              </button>
            </div>
            <div className="secureBox">
              <Lock size={17} />
              <span>Other reviewer votes are hidden while blind mode is enabled.</span>
            </div>
          </aside>
        </section>
      </div>
    );
  }

  function renderFullText() {
    if (projectReportQueue.length === 0) {
      return (
        <div className="viewStack">
          <section className="overviewBand compactBand">
            <div>
              <p className="eyebrow">Full-text screening</p>
              <h1>Report Review</h1>
              <p className="subtle">Reports appear here after title/abstract decisions advance studies to full text.</p>
            </div>
          </section>
          <section className="panel">
            <EmptyState
              icon={BookOpen}
              title="No full-text reports"
              description="No reports have been sought or uploaded for this review yet."
            />
          </section>
        </div>
      );
    }

    const currentReportStudy = (hasProjectSeedData ? screeningStudies : studies).find((study) => study.id === activeReport.studyId) ?? screeningStudies[0];
    const activeFullTextDecision = decisions.find(
      (decision) =>
        decision.projectId === selectedProject.id &&
        decision.reportId === activeReport.id &&
        decision.userId === currentUser.id &&
        decision.stage === "full_text" &&
        decision.isCurrent
    );
    const visibleFullTextDecisions = decisions.filter(
      (decision) =>
        decision.projectId === selectedProject.id &&
        decision.reportId === activeReport.id &&
        decision.stage === "full_text" &&
        decision.isCurrent
    );
    const visibleFullTextEvaluation = evaluateStage(
      "full_text",
      visibleFullTextDecisions.map((decision) => decision.decisionValue),
      activeReport.fullTextRequiredVotes ?? selectedProject.fullTextRequiredVotes,
      selectedProject.maybePolicy
    );
    const selectedDecision = activeFullTextDecision?.decisionValue;
    const canExclude = selectedDecision === "exclude";
    const pdfDisplayName = activeReport.fileName || activeReport.pdfName || "No PDF uploaded";
    const pdfStatus = activeReport.isPdfValidated ? "Validated" : activeReport.fileName ? "Uploaded, not validated" : "Missing PDF";
    const canInclude = activeReport.retrievalStatus === "retrieved" && activeReport.isPdfValidated;
    const fullTextVoteCount = activeReport.fullTextVoteCount ?? visibleFullTextDecisions.length;
    const fullTextRequiredVotes = activeReport.fullTextRequiredVotes ?? selectedProject.fullTextRequiredVotes;
    const fullTextStatus = activeReport.fullTextStatus ?? visibleFullTextEvaluation.state;
    const fullTextStatusLabel = activeReport.fullTextStatusLabel ?? visibleFullTextEvaluation.label;
    const hasFullTextConflict = fullTextStatus === "conflict" || fullTextStatus === "needs_third_vote";
    const messageIsSuccess = /updated|saved|uploaded|completed/i.test(fullTextMessage);
    const pdfViewerUrl = activeReport.fileName
      ? `/api/projects/${selectedProject.id}/reports/${activeReport.id}?pdf=1&checksum=${encodeURIComponent(activeReport.checksum ?? "")}`
      : "";
    const activeReportIndex = projectReportQueue.findIndex((report) => report.id === activeReport.id);
    const canGoPreviousReport = activeReportIndex > 0;
    const canGoNextReport = activeReportIndex >= 0 && activeReportIndex < projectReportQueue.length - 1;

    return (
      <div className="viewStack">
        <section className="overviewBand compactBand">
          <div>
            <p className="eyebrow">Full-text screening</p>
            <h1>Report Review</h1>
            <p className="subtle">Retrieval status and report-level exclusion reasons feed the PRISMA export.</p>
          </div>
          <div className="reportPicker">
            <div>
              <p className="eyebrow">Report queue</p>
              <strong>{projectReportQueue.length} report{projectReportQueue.length === 1 ? "" : "s"}</strong>
                <p className="subtle">Active report: #{currentReportStudy.importItemId ?? activeReportIndex + 1} · {activeReport.title}</p>
            </div>
            <label className="fieldLabel" htmlFor="full-text-report-picker">
              Jump to report
            </label>
            <select
              id="full-text-report-picker"
              value={activeReport.id}
              onChange={(event) => {
                setActiveReportId(event.target.value);
                setFullTextMessage("");
              }}
            >
              {projectReportQueue.map((report) => (
                <option key={report.id} value={report.id}>
                  #{(hasProjectSeedData ? screeningStudies : studies).find((study) => study.id === report.studyId)?.importItemId ?? projectReportQueue.findIndex((candidate) => candidate.id === report.id) + 1} · {report.title}
                </option>
              ))}
            </select>
            <div className="buttonRow" aria-label="Report navigation">
              <button
                className="ghostButton iconOnly"
                type="button"
                title="Previous report"
                disabled={!canGoPreviousReport}
                onClick={() => {
                  if (!canGoPreviousReport) {
                    return;
                  }
                  setActiveReportId(projectReportQueue[activeReportIndex - 1].id);
                  setFullTextMessage("");
                }}
              >
                <ArrowLeft size={17} />
              </button>
              <span>
                {activeReportIndex + 1} of {projectReportQueue.length}
              </span>
              <button
                className="ghostButton iconOnly"
                type="button"
                title="Next report"
                disabled={!canGoNextReport}
                onClick={() => {
                  if (!canGoNextReport) {
                    return;
                  }
                  setActiveReportId(projectReportQueue[activeReportIndex + 1].id);
                  setFullTextMessage("");
                }}
              >
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </section>

        {fullTextMessage ? (
          <div className={messageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
            {messageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
            <span>{fullTextMessage}</span>
          </div>
        ) : null}

        <section className="fullTextLayout">
          <div className="pdfPane">
            <div className="pdfToolbar">
              <strong className="pdfTitle" title={pdfDisplayName}>
                {pdfDisplayName}
              </strong>
              <div className="toolbarCluster">
                <input className="hiddenFileInput" ref={pdfInputRef} type="file" accept="application/pdf,.pdf" onChange={uploadReportPdf} />
                <button className="ghostButton" type="button" title="Upload PDF" onClick={() => pdfInputRef.current?.click()}>
                  <Upload size={16} />
                  PDF
                </button>
                <button className="ghostButton" type="button" title="Validate PDF" disabled={!activeReport.fileName} onClick={validateReportPdf}>
                  <FileCheck2 size={16} />
                  Validate
                </button>
                {/*<button className="ghostButton iconOnly" type="button" title="Search PDF">
                  <Search size={16} />
                </button>
                <button className="ghostButton iconOnly" type="button" title="Zoom in">
                  <ZoomIn size={16} />
                </button>
                <button className="ghostButton iconOnly" type="button" title="Show notes">
                  <MessageSquareText size={16} />
                </button>*/}
              </div>
            </div>
            <div className={pdfViewerUrl ? "pdfCanvas pdfCanvasViewer" : "pdfCanvas"} aria-label="PDF review pane">
              {pdfViewerUrl ? (
                <iframe className="pdfViewer" src={pdfViewerUrl} title={`${activeReport.title} PDF`} />
              ) : (
                <div className="paperPage emptyPdfPage">
                  <p className="paperEyebrow">{pdfStatus}</p>
                  <h2>{currentReportStudy.title}</h2>
                  {activeReport.validationNotes.length > 0 ? (
                    <div className="pdfValidationNotes">
                      {activeReport.validationNotes.slice(0, 4).map((note) => (
                        <span key={note}>{note}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="paperLine wide" />
                  <div className="paperLine" />
                  <div className="paperLine short" />
                </div>
              )}
            </div>
          </div>

          <aside className="panel fullTextPanel">
            <SectionTitle icon={BookOpen} title="Report Metadata" action={`${activeReport.notes} notes`} />
            <h2>{activeReport.title}</h2>
            <p className="subtle">{activeReport.citation}</p>
            <div className="metaStrip">
              <span>
                DOI {renderDoiLink(currentReportStudy.doi, currentReportStudy.doi || "Missing")}
              </span>
            </div>

            <div className="pdfStatusGrid">
              <StatusRow label="PDF" value={pdfStatus} tone={activeReport.isPdfValidated ? "secure" : activeReport.fileName ? "warning" : "danger"} />
              <StatusRow
                label="Full-text status"
                value={fullTextStatusLabel}
                tone={
                  hasFullTextConflict || fullTextStatus === "excluded_full_text" || fullTextStatus === "report_not_retrieved"
                    ? "danger"
                    : fullTextStatus === "advance_extraction"
                      ? "secure"
                      : "warning"
                }
              />
              <StatusRow label="Full-text votes" value={`${fullTextVoteCount}/${fullTextRequiredVotes}`} tone={fullTextVoteCount >= fullTextRequiredVotes ? "secure" : "warning"} />
              <StatusRow label="Checksum" value={activeReport.checksum ? activeReport.checksum.slice(0, 12) : "Not available"} tone="info" />
            </div>

            <label className="fieldLabel" htmlFor="retrieval-status">
              Retrieval status
            </label>
            <select
              id="retrieval-status"
              value={activeReport.retrievalStatus}
              onChange={(event) => updateFullTextReport({ retrievalStatus: event.target.value as Report["retrievalStatus"] })}
            >
              <option value="not_sought">Not sought</option>
              <option value="sought">Sought</option>
              <option value="retrieved">Retrieved</option>
              <option value="not_retrieved">Not retrieved</option>
            </select>

            <div className="decisionState">
              <span>My current full-text vote</span>
              <strong>{selectedDecision ? formatDecision(selectedDecision) : "No vote"}</strong>
            </div>
            {hasFullTextConflict ? (
              <div className="conflictVotesBox">
                <strong>{fullTextStatusLabel}</strong>
                <p>{formatConflictResolutionHint(fullTextRequiredVotes)}</p>
                <div className="voteStrip">
                  {visibleFullTextDecisions.map((decision) => (
                    <span className={`votePill ${decisionTone(decision.decisionValue)}`} key={decision.id}>
                      <strong>{decision.userName}</strong>
                      {formatDecision(decision.decisionValue)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="decisionButtons compactButtons">
              <button
                className={selectedDecision === "include" ? "includeButton active" : "includeButton"}
                type="button"
                disabled={!canInclude}
                onClick={() => updateFullTextReport({ retrievalStatus: "retrieved", decisionValue: "include" })}
              >
                <CheckCircle2 size={18} />
                Include
              </button>
              <button
                className={selectedDecision === "exclude" ? "excludeButton active" : "excludeButton"}
                type="button"
                onClick={() => updateFullTextReport({ decisionValue: "exclude", exclusionReasonId: fullTextReason })}
              >
                <XCircle size={18} />
                Exclude
              </button>
            </div>

            <label className="fieldLabel" htmlFor="exclusion-reason">
              Exclusion reason
            </label>
            <select id="exclusion-reason" value={fullTextReason} onChange={(event) => setFullTextReason(event.target.value)}>
              {exclusionReasons.map((reason) => (
                <option value={reason} key={reason}>
                  {reason}
                </option>
              ))}
            </select>

            <div className={canInclude && !hasFullTextConflict ? "validationBox ok" : "validationBox"}>
              {canInclude && !hasFullTextConflict ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>
                {hasFullTextConflict
                  ? "This report is in resolve-conflict state and cannot advance to extraction until the votes are reconciled."
                  : canInclude
                  ? "Include is available for this retrieved and validated report."
                  : "Include requires retrieved status and a validated PDF."}
              </span>
            </div>
            {canExclude ? (
              <div className="validationBox ok">
                <Check size={17} />
                <span>{`Current exclusion reason: ${activeFullTextDecision?.exclusionReasonId ?? fullTextReason}.`}</span>
              </div>
            ) : null}
          </aside>
        </section>
      </div>
    );
  }

  function renderExtraction() {
    const validatedPdfCount = projectReportQueue.filter((report) => report.fileName && report.isPdfValidated).length;
    const canManageProject = selectedProject.ownerIds.includes(currentUser.id) || selectedProject.ownerId === currentUser.id;
    const extractionMessageIsSuccess = /created|submitted|saved/i.test(extractionMessage);

    if (activeCounts.studiesIncluded === 0) {
      return (
        <div className="viewStack">
          <section className="overviewBand">
            <div>
              <p className="eyebrow">Data extraction</p>
              <h1>Consensus Workspace</h1>
              <p className="subtle">Extraction forms and assignments become available after studies are included.</p>
            </div>
          </section>
          <section className="settingsGrid">
            <div className="panel">
              <EmptyState
                icon={ClipboardCheck}
                title="No included studies yet"
                description="Files appear here after a report is retrieved, its PDF is validated, and the full-text decision reaches Include."
              />
            </div>
            <div className="panel">
              <SectionTitle icon={BookOpen} title="File Readiness" action="Full-text gate" />
              <div className="stateRows">
                <StatusRow label="Full-text reports" value={projectReportQueue.length.toString()} tone={projectReportQueue.length > 0 ? "info" : "warning"} />
                <StatusRow label="Validated PDFs" value={validatedPdfCount.toString()} tone={validatedPdfCount > 0 ? "secure" : "warning"} />
                <StatusRow label="Included for extraction" value={activeCounts.studiesIncluded.toString()} tone="danger" />
              </div>
              {projectReportQueue.length > 0 ? (
                <div className="tableWrap compactTableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Report</th>
                        <th>PDF</th>
                        <th>Extraction gate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectReportQueue.map((report) => (
                        <tr key={report.id}>
                          <td>
                            <strong>{report.title}</strong>
                          </td>
                          <td>{report.fileName ? (report.isPdfValidated ? "Validated" : "Needs validation") : "Missing"}</td>
                          <td>{projectExtractionStudyIds.has(report.studyId) ? "Visible" : "Awaiting Include"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      );
    }

    if (!activeExtractionTemplate) {
      return (
        <div className="viewStack">
          <section className="overviewBand">
            <div>
              <p className="eyebrow">Data extraction</p>
              <h1>Data Template</h1>
              <p className="subtle">Project owners define the extraction fields before reviewers extract data from included reports.</p>
            </div>
          </section>

          {extractionMessage ? (
            <div className={extractionMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
              {extractionMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{extractionMessage}</span>
            </div>
          ) : null}

          {canManageProject ? (
            <form className="panel templateBuilder" onSubmit={createExtractionTemplate}>
              <SectionTitle icon={ClipboardCheck} title="Create Data Template" action={`${extractionTemplateForm.fields.length} fields`} />
              <label>
                <span>Template title</span>
                <input
                  value={extractionTemplateForm.title}
                  onChange={(event) => setExtractionTemplateForm((previous) => ({ ...previous, title: event.target.value }))}
                />
              </label>

              <div className="templateFieldList">
                {extractionTemplateForm.fields.map((field, index) => (
                  <div className="templateFieldEditor" key={field.id}>
                    <div className="templateFieldHeader">
                      <strong>Field {index + 1}</strong>
                      <button className="ghostButton iconOnly" type="button" title="Remove field" onClick={() => removeExtractionTemplateField(field.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="formGrid compactFormGrid">
                      <label>
                        <span>Title</span>
                        <input
                          value={field.title}
                          onChange={(event) => updateExtractionTemplateField(field.id, { title: event.target.value })}
                          placeholder="Population characteristics"
                        />
                      </label>
                      <label>
                        <span>Type</span>
                        <select
                          value={field.type}
                          onChange={(event) => updateExtractionTemplateField(field.id, { type: event.target.value as ExtractionFieldType })}
                        >
                          <option value="multiline_text">Multiline Text</option>
                          <option value="single_choice">Single Choice</option>
                          <option value="multiple_choice">Multiple Choice</option>
                        </select>
                      </label>
                    </div>
                    {field.type !== "multiline_text" ? (
                      <label>
                        <span>Choices</span>
                        <textarea
                          value={field.optionsText}
                          onChange={(event) => updateExtractionTemplateField(field.id, { optionsText: event.target.value })}
                          placeholder={"Option A\nOption B"}
                        />
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="buttonRow">
                <button className="ghostButton" type="button" onClick={() => addExtractionTemplateField("multiline_text")}>
                  <Plus size={17} />
                  Text
                </button>
                <button className="ghostButton" type="button" onClick={() => addExtractionTemplateField("single_choice")}>
                  <Plus size={17} />
                  Single Choice
                </button>
                <button className="ghostButton" type="button" onClick={() => addExtractionTemplateField("multiple_choice")}>
                  <Plus size={17} />
                  Multiple Choice
                </button>
                <button className="primaryButton" type="submit">
                  <Check size={17} />
                  Create Template
                </button>
              </div>
            </form>
          ) : (
            <section className="panel">
              <EmptyState
                icon={ClipboardCheck}
                title="No data template"
                description="A project owner needs to create the extraction template before reviewers can extract data."
              />
            </section>
          )}
        </div>
      );
    }

    const activeReportForExtraction = activeExtractionReport ?? projectExtractionReports[0];
    const activeStudyForExtraction = activeReportForExtraction
      ? projectScreeningStudies.find((study) => study.id === activeReportForExtraction.studyId)
      : undefined;
    const extractionPdfUrl = activeReportForExtraction?.fileName
      ? `/api/projects/${selectedProject.id}/reports/${activeReportForExtraction.id}?pdf=1&checksum=${encodeURIComponent(activeReportForExtraction.checksum ?? "")}`
      : "";
    const submittedResponsesForActiveReport = activeReportForExtraction
      ? extractionResponses.filter(
          (response) =>
            response.projectId === selectedProject.id &&
            response.reportId === activeReportForExtraction.id &&
            response.templateId === activeExtractionTemplate.id &&
            response.isSubmitted
        )
      : [];
    const requiredExtractionVotes = selectedProject.extractionRequiredVotes;
    const hasMyExtraction = Boolean(activeExtractionResponse?.isSubmitted);

    return (
      <div className="viewStack">
        <section className="overviewBand compactBand">
          <div>
            <p className="eyebrow">Data extraction</p>
            <h1>Consensus Workspace</h1>
            <p className="subtle">{activeExtractionTemplate.title} · version {activeExtractionTemplate.version}</p>
          </div>
          <div className="reportPicker">
            <div>
              <p className="eyebrow">Included reports</p>
              <strong>{projectExtractionReports.length} report{projectExtractionReports.length === 1 ? "" : "s"}</strong>
              <p className="subtle">At least {requiredExtractionVotes} submitted extraction vote{requiredExtractionVotes === 1 ? "" : "s"} required.</p>
            </div>
            <label className="fieldLabel" htmlFor="extraction-report-picker">
              Jump to report
            </label>
            <select
              id="extraction-report-picker"
              value={activeReportForExtraction?.id ?? ""}
              onChange={(event) => setActiveExtractionReportId(event.target.value)}
            >
              {projectExtractionReports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.title}
                </option>
              ))}
            </select>
          </div>
        </section>

        {extractionMessage ? (
          <div className={extractionMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
            {extractionMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
            <span>{extractionMessage}</span>
          </div>
        ) : null}

        <section className="extractionWorkspace">
          <div className="pdfPane">
            <div className="pdfToolbar">
              <strong className="pdfTitle" title={activeReportForExtraction?.fileName || activeReportForExtraction?.pdfName || "No PDF uploaded"}>
                {activeReportForExtraction?.fileName || activeReportForExtraction?.pdfName || "No PDF uploaded"}
              </strong>
              {activeReportForExtraction ? (
                <button
                  className="ghostButton"
                  type="button"
                  onClick={() => {
                    setActiveReportId(activeReportForExtraction.id);
                    setActiveView("fullText");
                  }}
                >
                  <BookOpen size={16} />
                  Full Text
                </button>
              ) : null}
            </div>
            <div className={extractionPdfUrl ? "pdfCanvas pdfCanvasViewer" : "pdfCanvas"} aria-label="Extraction PDF review pane">
              {extractionPdfUrl ? (
                <iframe className="pdfViewer" src={extractionPdfUrl} title={`${activeReportForExtraction?.title ?? "Included report"} PDF`} />
              ) : (
                <div className="paperPage emptyPdfPage">
                  <p className="paperEyebrow">PDF unavailable</p>
                  <h2>{activeReportForExtraction?.title ?? "No included report selected"}</h2>
                  <div className="paperLine wide" />
                  <div className="paperLine" />
                  <div className="paperLine short" />
                </div>
              )}
            </div>
          </div>

          <aside className="panel extractionFormPanel">
            <SectionTitle
              icon={ClipboardCheck}
              title="Extraction Form"
              action={`${submittedResponsesForActiveReport.length}/${requiredExtractionVotes} submitted`}
            />
            <h2>{activeReportForExtraction?.title ?? "Included report"}</h2>
            <p className="subtle">
              {activeStudyForExtraction
                ? `${activeStudyForExtraction.authors.join(", ") || "No authors parsed"} · ${activeStudyForExtraction.journal} · ${
                    activeStudyForExtraction.year > 0 ? activeStudyForExtraction.year : "Year needs review"
                  }`
                : "Select an included report to extract data."}
            </p>
            <div className="stateRows">
              <StatusRow label="Template" value={`${activeExtractionTemplate.fields.length} fields`} tone="info" />
              <StatusRow
                label="Extraction votes"
                value={
                  submittedResponsesForActiveReport.length >= requiredExtractionVotes
                    ? "Ready for comparison"
                    : `${submittedResponsesForActiveReport.length}/${requiredExtractionVotes} submitted`
                }
                tone={submittedResponsesForActiveReport.length >= requiredExtractionVotes ? "secure" : "warning"}
              />
              <StatusRow label="My extraction" value={hasMyExtraction ? "Submitted" : "Open"} tone={hasMyExtraction ? "secure" : "warning"} />
            </div>

            <form className="extractionForm" onSubmit={submitExtractionResponse}>
              {activeExtractionTemplate.fields.map((field) => {
                const value = extractionFormValues[field.id];
                return (
                  <fieldset className="extractionField" key={field.id}>
                    <legend>{field.title}</legend>
                    {field.type === "multiline_text" ? (
                      <textarea
                        value={typeof value === "string" ? value : ""}
                        onChange={(event) => updateExtractionValue(field.id, event.target.value)}
                      />
                    ) : null}
                    {field.type === "single_choice" ? (
                      <div className="choiceList">
                        {field.options.map((option) => (
                          <label key={option}>
                            <input
                              type="radio"
                              name={field.id}
                              checked={value === option}
                              onChange={() => updateExtractionValue(field.id, option)}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                    {field.type === "multiple_choice" ? (
                      <div className="choiceList">
                        {field.options.map((option) => {
                          const checked = Array.isArray(value) && value.includes(option);
                          return (
                            <label key={option}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => toggleExtractionChoice(field.id, option, event.target.checked)}
                              />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                  </fieldset>
                );
              })}

              <button className="primaryButton" type="submit" disabled={!activeReportForExtraction}>
                <Check size={17} />
                Submit Extraction
              </button>
            </form>
          </aside>
        </section>
      </div>
    );
  }

  function renderRisk() {
    if (activeCounts.studiesIncluded === 0) {
      return (
        <div className="viewStack">
          <section className="overviewBand">
            <div>
              <p className="eyebrow">Risk of bias</p>
              <h1>Quality Assessment</h1>
              <p className="subtle">Quality templates can be configured now; assessments start once studies are included.</p>
            </div>
          </section>
          <section className="panel">
            <EmptyState
              icon={ShieldCheck}
              title="No assessments assigned"
              description="Included studies will appear here for RoB 2, ROBINS-I, or custom quality assessment."
            />
          </section>
        </div>
      );
    }

    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Risk of bias</p>
            <h1>Quality Assessment</h1>
            <p className="subtle">Templates are project-owned and can model RoB 2, ROBINS-I, or custom tools.</p>
          </div>
          <div className="segmented">
            <button className="active" type="button">RoB 2 Style</button>
            <button type="button">ROBINS-I</button>
            <button type="button">Custom</button>
          </div>
        </section>

        <section className="qualityGrid">
          {qualityDomains.map((domain) => (
            <article className="panel qualityPanel" key={domain.domain}>
              <div className="qualityHeader">
                <FlaskConical size={20} />
                <div>
                  <h2>{domain.domain}</h2>
                  <Badge label={domain.judgement} tone={domain.judgement === "High risk" ? "danger" : domain.judgement === "Some concerns" ? "warning" : "success"} />
                </div>
              </div>
              <p>{domain.support}</p>
              <div className="judgementRail">
                <span className={domain.judgement === "Low risk" ? "active low" : "low"}>Low</span>
                <span className={domain.judgement === "Some concerns" ? "active some" : "some"}>Some</span>
                <span className={domain.judgement === "High risk" ? "active high" : "high"}>High</span>
              </div>
            </article>
          ))}
        </section>
      </div>
    );
  }

  function renderExports() {
    const validations = [
      {
        label: "Records identified reconcile with removals and screened records",
        ok: recordsIdentified >= activeCounts.duplicateRecordsRemoved + activeCounts.recordsScreened
      },
      {
        label: "Records screened equals excluded records plus reports sought",
        ok: activeCounts.recordsScreened === activeCounts.recordsExcluded + activeCounts.reportsSought
      },
      {
        label: "Reports sought equals retrieved plus not retrieved",
        ok: activeCounts.reportsSought === activeCounts.reportsAssessed + activeCounts.reportsNotRetrieved
      },
      {
        label: "Reports assessed equals excluded reports plus included studies",
        ok: activeCounts.reportsAssessed === reportsExcludedTotal + activeCounts.studiesIncluded
      },
      {
        label: "Full-text exclusions have structured reasons",
        ok: reportsExcludedTotal > 0
      }
    ];

    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">PRISMA export</p>
            <h1>Flow Diagram and Audit Package</h1>
            <p className="subtle">Counts are generated from workflow events, current decisions, and report retrieval status.</p>
          </div>
          <div className="toolbarCluster">
            <button className="ghostButton" type="button" title="Download CSV">
              <FileText size={17} />
              CSV
            </button>
            <button className="primaryButton" type="button" title="Download SVG">
              <Download size={17} />
              SVG
            </button>
          </div>
        </section>

        <section className="exportLayout">
          <div className="panel">
            <SectionTitle icon={BarChart3} title="Flow Preview" action="PRISMA 2020" />
            <PrismaFlow counts={activeCounts} reportsExcludedTotal={reportsExcludedTotal} />
          </div>

          <div className="panel">
            <SectionTitle icon={CheckCircle2} title="Validation" action="Export gate" />
            <div className="validationList">
              {validations.map((validation) => (
                <div className={validation.ok ? "validationItem ok" : "validationItem blocked"} key={validation.label}>
                  {validation.ok ? <Check size={17} /> : <X size={17} />}
                  <span>{validation.label}</span>
                </div>
              ))}
            </div>
            <div className="exportHistory">
              <strong>Recent exports</strong>
              <span>PRISMA SVG · generated today at 13:41</span>
              <span>Audit CSV · generated yesterday at 18:05</span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function renderAuditTrail() {
    const firstEventIndex = projectEvents.length === 0 ? 0 : (currentAuditPage - 1) * AUDIT_PAGE_SIZE + 1;
    const lastEventIndex = Math.min(currentAuditPage * AUDIT_PAGE_SIZE, projectEvents.length);

    return (
      <div className="viewStack">
        <section className="overviewBand compactBand">
          <div>
            <p className="eyebrow">Project audit</p>
            <h1>Full Audit Trail</h1>
            <p className="subtle">
              {selectedProject.title} · {projectEvents.length} append-only action{projectEvents.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="toolbarCluster">
            <button className="ghostButton" type="button" onClick={() => setActiveView("projectDashboard")}>
              <ArrowLeft size={17} />
              Overview
            </button>
          </div>
        </section>

        <section className="panel">
          <SectionTitle icon={History} title="Audit Events" action={projectEvents.length > 0 ? `${firstEventIndex}-${lastEventIndex} of ${projectEvents.length}` : "No events"} />
          {projectEvents.length > 0 ? (
            <>
              <div className="eventList fullAuditList">
                {pagedProjectEvents.map((event) => (
                  <article className="eventItem" key={event.id}>
                    <div>
                      <strong>{event.action}</strong>
                      <span>
                        {event.actor} · {formatAuditEntityLabel(event, selectedProject, projectScreeningStudies, projectReportQueue)}
                      </span>
                    </div>
                    <time>{formatAuditTime(event.time)}</time>
                  </article>
                ))}
              </div>
              <div className="paginationBar" aria-label="Audit pagination">
                <button
                  className="ghostButton"
                  type="button"
                  disabled={currentAuditPage === 1}
                  onClick={() => setAuditPage((page) => Math.max(page - 1, 1))}
                >
                  <ArrowLeft size={17} />
                  Previous
                </button>
                <span>
                  Page {currentAuditPage} of {auditPageCount}
                </span>
                <button
                  className="ghostButton"
                  type="button"
                  disabled={currentAuditPage === auditPageCount}
                  onClick={() => setAuditPage((page) => Math.min(page + 1, auditPageCount))}
                >
                  Next
                  <ArrowRight size={17} />
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={History}
              title="No audit events yet"
              description="Imports, decisions, adjudications, and exports will appear here as append-only project history."
            />
          )}
        </section>
      </div>
    );
  }

  function renderSettings() {
    const projectMembers = selectedProject.memberIds
      .map((memberId) => users.find((user) => user.id === memberId))
      .filter((user): user is AppUser => Boolean(user));
    const availableUsers = users.filter((user) => !selectedProject.memberIds.includes(user.id));
    const canManageProject = selectedProject.ownerIds.includes(currentUser.id) || selectedProject.ownerId === currentUser.id;
    const settingsMessageIsSuccess = projectSettingsMessage === "Project settings saved.";

    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Project settings</p>
            <h1>Review Controls</h1>
            <p className="subtle">Authorization, blind-mode visibility, and transition policy are separate controls.</p>
          </div>
          <button className="primaryButton" type="submit" form="project-settings-form" title="Save settings" disabled={!canManageProject}>
            <Check size={17} />
            Save
          </button>
        </section>

        <form className="projectForm" id="project-settings-form" onSubmit={updateProjectSettings}>
          <section className="panel">
            <SectionTitle icon={FileText} title="Review Details" action={canManageProject ? "Editable" : "Owner only"} />
            <div className="formGrid">
              <label>
                <span>Review title</span>
                <input
                  value={projectSettingsForm.title}
                  onChange={(event) => updateProjectSettingsForm("title", event.target.value)}
                  disabled={!canManageProject}
                />
              </label>
              <label>
                <span>Organization</span>
                <input
                  value={projectSettingsForm.organization}
                  onChange={(event) => updateProjectSettingsForm("organization", event.target.value)}
                  disabled={!canManageProject}
                />
              </label>
              <label>
                <span>Protocol ID</span>
                <input
                  value={projectSettingsForm.protocolId}
                  onChange={(event) => updateProjectSettingsForm("protocolId", event.target.value)}
                  disabled={!canManageProject}
                />
              </label>
              <label>
                <span>Due date (dd-mm-yyyy)</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{2}-[0-9]{2}-[0-9]{4}"
                  value={projectSettingsForm.dueDate}
                  onChange={(event) => updateProjectSettingsForm("dueDate", event.target.value)}
                  disabled={!canManageProject}
                />
              </label>
            </div>
            <label className="wideField">
              <span>Description</span>
              <textarea
                value={projectSettingsForm.description}
                onChange={(event) => updateProjectSettingsForm("description", event.target.value)}
                disabled={!canManageProject}
              />
            </label>
            <label className="wideField">
              <span>Search strategies backup</span>
              <textarea
                className="strategyTextarea"
                value={projectSettingsForm.searchStrategies}
                onChange={(event) => updateProjectSettingsForm("searchStrategies", event.target.value)}
                disabled={!canManageProject}
                placeholder={"Paste exact database searches, keywords, Boolean strings, dates, filters, and platform notes.\n\nExample:\nPubMed (2026-05-29)\n(\"underwater mapping\" OR sonar) AND (3D OR reconstruction)\nFilters: English; 2015-2026"}
              />
            </label>
            {projectSettingsMessage ? (
              <div className={settingsMessageIsSuccess ? "validationItem ok" : "validationItem blocked"}>
                {settingsMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
                <span>{projectSettingsMessage}</span>
              </div>
            ) : null}
          </section>

          <section className="settingsGrid">
            <div className="panel">
              <SectionTitle icon={Lock} title="Blind Mode" action={projectSettingsForm.blindMode ? "Enabled" : "Disabled"} />
              <label className="toggleRow">
                <input
                  type="checkbox"
                  checked={projectSettingsForm.blindMode}
                  onChange={(event) => updateProjectSettingsForm("blindMode", event.target.checked)}
                  disabled={!canManageProject}
                />
                <span />
                <strong>Reviewer endpoints hide other votes</strong>
              </label>
              <div className="stateRows">
                <StatusRow label="Reviewer API" value="Own decision only" tone="secure" />
                <StatusRow label="Admin API" value="Aggregate progress counts" tone="info" />
                <StatusRow label="Adjudication API" value="Role-gated vote disclosure" tone="warning" />
              </div>
            </div>

            <div className="panel">
              <SectionTitle icon={Settings} title="State Machine" action="Project policy" />
              <div className="formGrid compactFormGrid">
                <label>
                  <span>Title/abstract votes</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={projectSettingsForm.abstractRequiredVotes}
                    onChange={(event) => updateProjectSettingsForm("abstractRequiredVotes", Number(event.target.value))}
                    disabled={!canManageProject}
                  />
                </label>
                <label>
                  <span>Full-text votes</span>
                  <input
                    type="number"
                    min={2}
                    max={4}
                    value={projectSettingsForm.fullTextRequiredVotes}
                    onChange={(event) => updateProjectSettingsForm("fullTextRequiredVotes", Number(event.target.value))}
                    disabled={!canManageProject}
                  />
                </label>
                <label>
                  <span>Extraction votes</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={projectSettingsForm.extractionRequiredVotes}
                    onChange={(event) => updateProjectSettingsForm("extractionRequiredVotes", Number(event.target.value))}
                    disabled={!canManageProject}
                  />
                </label>
              </div>
              <label className="fieldLabel" htmlFor="project-settings-maybe-policy">
                Maybe policy
              </label>
              <select
                id="project-settings-maybe-policy"
                value={projectSettingsForm.maybePolicy}
                onChange={(event) => updateProjectSettingsForm("maybePolicy", event.target.value as ProjectSettingsForm["maybePolicy"])}
                disabled={!canManageProject}
              >
                <option value="advance_to_full_text">Advance to full text</option>
                <option value="third_vote">Request third vote</option>
                <option value="conflict">Treat as conflict</option>
              </select>
            </div>
          </section>
        </form>

        <section className="settingsGrid">
          <div className="panel">
            <SectionTitle icon={Users} title="Project Team" action={`${projectMembers.length} members`} />
            <div className="teamList">
              {projectMembers.map((member) => (
                <article className="teamMember" key={member.id}>
                  <span className="avatar" style={{ background: member.avatarColor }}>
                    {member.initials}
                  </span>
                  <div>
                    <strong>{member.name}</strong>
                    <span>{member.title} · {member.email}</span>
                  </div>
                  <Badge label={selectedProject.ownerIds.includes(member.id) ? "owner" : "reviewer"} tone={selectedProject.ownerIds.includes(member.id) ? "info" : "neutral"} />
                  <div className="teamMemberActions">
                    <button
                      className="ghostButton"
                      type="button"
                      title={selectedProject.ownerIds.includes(member.id) && selectedProject.ownerIds.length === 1 ? "At least one owner is required" : selectedProject.ownerIds.includes(member.id) ? "Change role to reviewer" : "Change role to owner"}
                      disabled={selectedProject.ownerIds.includes(member.id) && selectedProject.ownerIds.length === 1}
                      onClick={() => toggleProjectOwner(member.id)}
                    >
                      {selectedProject.ownerIds.includes(member.id) ? "Make reviewer" : "Make owner"}
                    </button>
                    <button
                      className="ghostButton iconOnly"
                      type="button"
                      title={selectedProject.ownerIds.includes(member.id) && selectedProject.ownerIds.length === 1 ? "Last owner cannot be removed" : "Remove member"}
                      disabled={selectedProject.ownerIds.includes(member.id) && selectedProject.ownerIds.length === 1}
                      onClick={() => removeUserFromProject(member.id)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="panel">
            <SectionTitle icon={UserRoundCheck} title="Add People" action="Existing or invite" />
            <div className="addMemberBox">
              <label>
                <span>Existing user</span>
                <select value={teamUserId} onChange={(event) => setTeamUserId(event.target.value)}>
                  <option value="">Choose user</option>
                  {availableUsers.map((user) => (
                    <option value={user.id} key={user.id}>
                      {user.name} · {user.email}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primaryButton" type="button" disabled={!teamUserId} onClick={addExistingUserToProject}>
                <Plus size={17} />
                Add User
              </button>
            </div>

            <form className="inviteForm" onSubmit={inviteUserToProject}>
              <label>
                <span>Invite name</span>
                <input value={inviteForm.name} onChange={(event) => setInviteForm((previous) => ({ ...previous, name: event.target.value }))} />
              </label>
              <label>
                <span>Invite email</span>
                <input value={inviteForm.email} onChange={(event) => setInviteForm((previous) => ({ ...previous, email: event.target.value }))} />
              </label>
              <label>
                <span>Role title</span>
                <input value={inviteForm.title} onChange={(event) => setInviteForm((previous) => ({ ...previous, title: event.target.value }))} />
              </label>
              <button className="ghostButton" type="submit">
                <UserRoundCheck size={17} />
                Invite
              </button>
            </form>

            {teamMessage ? (
              <div className="validationItem ok">
                <Check size={17} />
                <span>{teamMessage}</span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <SectionTitle icon={UserRoundCheck} title="Role Matrix" action={`${selectedProject.reviewers} active reviewers`} />
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  {hasProjectSeedData ? <th>Members</th> : null}
                  <th>{hasProjectSeedData ? "Capabilities" : "User"}</th>
                </tr>
              </thead>
              <tbody>
                {hasProjectSeedData ? roleRows.map((row) => (
                  <tr key={row.role}>
                    <td>
                      <strong>{row.role}</strong>
                    </td>
                    <td>{row.members}</td>
                    <td>{row.capabilities}</td>
                  </tr>
                )) : selectedProject.memberIds.map((memberId) => {
                  const member = users.find((user) => user.id === memberId);
                  if (!member) {
                    return null;
                  }
                  return (
                    <tr key={member.id}>
                      <td>
                        <strong>{selectedProject.ownerIds.includes(member.id) ? "Owner" : "Reviewer"}</strong>
                      </td>
                      <td>{member.name} · {member.email}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  function renderNewProject() {
    const canCreate = newProjectForm.title.trim().length > 0 && isEuDate(newProjectForm.dueDate);

    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">New review</p>
            <h1>Create Review Project</h1>
            <p className="subtle">Set up the project shell, blind voting policy, and team membership before importing citations.</p>
          </div>
          <button className="ghostButton" type="button" onClick={() => setActiveView("dashboard")}>
            <ArrowLeft size={17} />
            Back
          </button>
        </section>

        <form className="projectForm" onSubmit={createProject}>
          <section className="panel">
            <SectionTitle icon={FileText} title="Review Details" action="Required setup" />
            <div className="formGrid">
              <label>
                <span>Review title</span>
                <input
                  value={newProjectForm.title}
                  onChange={(event) => updateNewProjectForm("title", event.target.value)}
                  placeholder="Digital therapeutics for heart failure"
                />
              </label>
              <label>
                <span>Organization</span>
                <input
                  value={newProjectForm.organization}
                  onChange={(event) => updateNewProjectForm("organization", event.target.value)}
                  placeholder="Evidence Methods Unit"
                />
              </label>
              <label>
                <span>Protocol ID</span>
                <input
                  value={newProjectForm.protocolId}
                  onChange={(event) => updateNewProjectForm("protocolId", event.target.value)}
                  placeholder="PROSPERO or draft protocol"
                />
              </label>
              <label>
                <span>Due date (dd-mm-yyyy)</span>
                <input
                  inputMode="numeric"
                  pattern="[0-9]{2}-[0-9]{2}-[0-9]{4}"
                  value={newProjectForm.dueDate}
                  onChange={(event) => updateNewProjectForm("dueDate", event.target.value)}
                  placeholder="30-09-2026"
                />
              </label>
            </div>
            <label className="wideField">
              <span>Description</span>
              <textarea
                value={newProjectForm.description}
                onChange={(event) => updateNewProjectForm("description", event.target.value)}
                placeholder="Briefly describe the review question and scope."
              />
            </label>
            <label className="wideField">
              <span>Search strategies backup</span>
              <textarea
                className="strategyTextarea"
                value={newProjectForm.searchStrategies}
                onChange={(event) => updateNewProjectForm("searchStrategies", event.target.value)}
                placeholder={"Optional. Paste database names, keywords, Boolean strings, dates, filters, and search-platform notes."}
              />
            </label>
          </section>

          <section className="settingsGrid">
            <div className="panel">
              <SectionTitle icon={Lock} title="Screening Policy" action="Workflow state machine" />
              <label className="toggleRow">
                <input
                  type="checkbox"
                  checked={newProjectForm.blindMode}
                  onChange={(event) => updateNewProjectForm("blindMode", event.target.checked)}
                />
                <span />
                <strong>Enable blind mode</strong>
              </label>
              <div className="formGrid compactFormGrid">
                <label>
                  <span>Title/abstract votes</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={newProjectForm.abstractRequiredVotes}
                    onChange={(event) => updateNewProjectForm("abstractRequiredVotes", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Full-text votes</span>
                  <input
                    type="number"
                    min={2}
                    max={4}
                    value={newProjectForm.fullTextRequiredVotes}
                    onChange={(event) => updateNewProjectForm("fullTextRequiredVotes", Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>Extraction votes</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={newProjectForm.extractionRequiredVotes}
                    onChange={(event) => updateNewProjectForm("extractionRequiredVotes", Number(event.target.value))}
                  />
                </label>
              </div>
              <label className="fieldLabel" htmlFor="new-project-maybe-policy">
                Maybe policy
              </label>
              <select
                id="new-project-maybe-policy"
                value={newProjectForm.maybePolicy}
                onChange={(event) => updateNewProjectForm("maybePolicy", event.target.value as NewProjectForm["maybePolicy"])}
              >
                <option value="advance_to_full_text">Advance to full text</option>
                <option value="third_vote">Request third vote</option>
                <option value="conflict">Treat as conflict</option>
              </select>
            </div>

            <div className="panel">
              <SectionTitle icon={Users} title="Team" action={`${newProjectForm.memberIds.length} selected`} />
              <div className="memberPicker">
                {users.map((user) => (
                  <label className="memberOption" key={user.id}>
                    <input
                      type="checkbox"
                      checked={newProjectForm.memberIds.includes(user.id)}
                      onChange={() => toggleProjectMember(user.id)}
                      disabled={user.id === currentUser.id}
                    />
                    <span className="avatar" style={{ background: user.avatarColor }}>
                      {user.initials}
                    </span>
                    <div>
                      <strong>{user.name}</strong>
                      <small>{user.title}</small>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="panel formActions">
            <div>
              <strong>{canCreate ? "Ready to create" : "Title and dd-mm-yyyy due date required"}</strong>
              <span>New reviews start as drafts with zero imports, open settings, and the selected users as members.</span>
            </div>
            <button className="primaryButton" type="submit" disabled={!canCreate}>
              <Plus size={17} />
              Create Review
            </button>
          </section>
        </form>
      </div>
    );
  }

  function renderAbout() {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">About Prismatica</p>
            <h1>Open Source PRISMA Review Platform</h1>
            <p className="subtle">Prismatica supports systematic-review teams from citation intake through screening, full-text review, extraction, audit, and PRISMA-oriented export checks.</p>
          </div>
          <a className="primaryButton" href="https://github.com/fwanderlingh/prismatica" target="_blank" rel="noreferrer">
            <GitMerge size={17} />
            GitHub
          </a>
        </section>

        <section className="aboutGrid">
          <div className="panel aboutPanel">
            <SectionTitle icon={Info} title="Purpose" action="Evidence workflow" />
            <p>
              Prismatica is built as a transparent, auditable workspace for PRISMA-style review projects. It keeps project membership, imports, decisions, PDF metadata,
              extraction templates, and audit events behind server APIs while preserving a reviewer-friendly interface for day-to-day screening work.
            </p>
          </div>

          <div className="panel aboutPanel">
            <SectionTitle icon={GitMerge} title="Source Code" action="Public repository" />
            <p>The website source is available in the public GitHub repository.</p>
            <a className="repoLink" href="https://github.com/fwanderlingh/prismatica" target="_blank" rel="noreferrer">
              github.com/fwanderlingh/prismatica
            </a>
          </div>
        </section>

        <section className="panel">
          <SectionTitle icon={ListChecks} title="What It Covers" action="Current app surface" />
          <div className="aboutFeatureGrid">
            {[
              ["Project governance", "Review setup, membership, owner controls, blind mode, vote thresholds, and registration security."],
              ["Citation workflow", "RIS/BibTeX import, parser warning review, deduplication workspace, and title/abstract screening."],
              ["Full-text review", "Report queues, PDF upload and validation, DOI links, retrieval status, exclusion reasons, and conflict handling."],
              ["Audit and export", "Append-only workflow events, paged audit history, PRISMA count preview, and export validation checks."]
            ].map(([title, description]) => (
              <article className="aboutFeature" key={title}>
                <strong>{title}</strong>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderAdminReviews() {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Administration</p>
            <h1>Review Admin</h1>
            <p className="subtle">Inspect every review workspace, open settings, and remove obsolete or spam projects.</p>
          </div>
        </section>

        {dashboardMessage ? (
          <section className="panel">
            <div className={dashboardMessage.startsWith("Deleted review") ? "validationItem ok" : "validationItem blocked"}>
              {dashboardMessage.startsWith("Deleted review") ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{dashboardMessage}</span>
            </div>
          </section>
        ) : null}

        <section className="panel">
          <SectionTitle icon={LayoutDashboard} title="Registered Reviews" action={`${projects.length} total`} />
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Review</th>
                  <th>Owners</th>
                  <th>Status</th>
                  <th>Records</th>
                  <th>Updated</th>
                  <th>Open</th>
                  <th>Settings</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const ownerNames = project.ownerIds
                    .map((ownerId) => users.find((user) => user.id === ownerId)?.name)
                    .filter(Boolean)
                    .join(", ");

                  return (
                    <tr key={project.id}>
                      <td>
                        <strong>{project.title}</strong>
                        <span>{project.organization}</span>
                      </td>
                      <td>{ownerNames || "Unassigned"}</td>
                      <td>
                        <Badge label={formatProjectPhase(project.stage)} tone={projectPhaseBadgeTone(project.stage)} />
                      </td>
                      <td>{numberFormatter.format(project.recordsTotal)}</td>
                      <td>{formatEuDate(project.updatedAt)}</td>
                      <td>
                        <button className="ghostButton" type="button" onClick={() => openProject(project.id)}>
                          <ChevronRight size={17} />
                          Open
                        </button>
                      </td>
                      <td>
                        <button className="ghostButton" type="button" onClick={() => openProject(project.id, "settings")}>
                          <Settings size={17} />
                          Edit
                        </button>
                      </td>
                      <td>
                        <button className="dangerButton" type="button" onClick={() => adminDeleteProject(project)}>
                          <Trash2 size={17} />
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  function renderRegisteredUsers() {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Administration</p>
            <h1>Registered Users</h1>
            <p className="subtle">Review server accounts, reset access for non-admin users, delete spam accounts, and control public registration.</p>
          </div>
        </section>

        <section className="settingsGrid">
          <div className="panel">
            <SectionTitle icon={Users} title="User Accounts" action={`${users.length} registered`} />
            <div className="memberPicker">
              {users.map((user) => (
                <div
                  className={`${user.id === currentUser.id ? "userSwitch active" : "userSwitch"} adminManagedUserSwitch`}
                  key={user.id}
                >
                  <span className="avatar" style={{ background: user.avatarColor }}>
                    {user.initials}
                  </span>
                  <div>
                    <strong>{user.name}</strong>
                    <small>
                      {user.email} · {user.title}
                      {user.isAdmin ? " · administrator" : ""}
                    </small>
                  </div>
                  <div className="userSwitchActions">
                    <button
                      className="ghostButton"
                      type="button"
                      disabled={user.id === currentUser.id || user.isAdmin}
                      onClick={() => adminResetUserPassword(user)}
                    >
                      Reset password
                    </button>
                    <button
                      className="dangerButton"
                      type="button"
                      disabled={user.id === currentUser.id || user.isAdmin}
                      onClick={() => adminDeleteUser(user)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {adminDirectoryMessage ? (
              <div className={adminDirectoryMessage.startsWith("Temporary password") || adminDirectoryMessage.startsWith("Deleted account") ? "validationItem ok" : "validationItem blocked"}>
                {adminDirectoryMessage.startsWith("Temporary password") || adminDirectoryMessage.startsWith("Deleted account") ? <Check size={17} /> : <AlertTriangle size={17} />}
                <span>{adminDirectoryMessage}</span>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <SectionTitle icon={ShieldCheck} title="Registration Security" action={authSettings.registrationEnabled ? "Open" : "Sign-in only"} />
            <label className="toggleRow">
              <input
                type="checkbox"
                checked={authSettings.registrationEnabled}
                onChange={(event) => updateRegistrationSetting(event.target.checked)}
              />
              <span />
              <strong>Allow public registration</strong>
            </label>
            <div className="stateRows">
              <StatusRow label="Registration screen" value={authSettings.registrationEnabled ? "Enabled" : "Disabled"} tone={authSettings.registrationEnabled ? "warning" : "secure"} />
              <StatusRow label="Captcha" value="Required for new accounts" tone="secure" />
            </div>
            {authSettingsMessage ? (
              <div className={authSettingsMessage.includes("disabled") || authSettingsMessage.includes("enabled") ? "validationItem ok" : "validationItem blocked"}>
                {authSettingsMessage.includes("disabled") || authSettingsMessage.includes("enabled") ? <Check size={17} /> : <AlertTriangle size={17} />}
                <span>{authSettingsMessage}</span>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  function renderProfile() {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div className="profileHero">
            <span className="avatar largeAvatar" style={{ background: currentUser.avatarColor }}>
              {currentUser.initials}
            </span>
            <div>
              <p className="eyebrow">Profile</p>
              <h1>{currentUser.name}</h1>
              <p className="subtle">
                {currentUser.title} · {currentUser.email}
              </p>
            </div>
          </div>
          <button className="ghostButton" type="button" onClick={handleLogout}>
            <LogOut size={17} />
            Sign Out
          </button>
        </section>

        <section className="panel">
          <SectionTitle icon={UserCircle} title="Account" action="Server session" />
          <form className="accountForm" onSubmit={updateAccount}>
            <label>
              <span>Organization</span>
              <input
                value={accountForm.organization}
                onChange={(event) => setAccountForm((previous) => ({ ...previous, organization: event.target.value }))}
              />
            </label>
            <label>
              <span>Role title</span>
              <input
                value={accountForm.title}
                onChange={(event) => setAccountForm((previous) => ({ ...previous, title: event.target.value }))}
              />
            </label>
            <label>
              <span>Current password</span>
              <input
                type="password"
                value={accountForm.currentPassword}
                onChange={(event) => setAccountForm((previous) => ({ ...previous, currentPassword: event.target.value }))}
              />
            </label>
            <label>
              <span>New password</span>
              <input
                type="password"
                value={accountForm.newPassword}
                onChange={(event) => setAccountForm((previous) => ({ ...previous, newPassword: event.target.value }))}
              />
            </label>
            <div className="profileRows">
              <StatusRow label="Timezone" value={currentUser.timezone} tone="secure" />
            </div>
            {accountMessage ? (
              <div className={accountMessage === "Account updated." ? "validationItem ok" : "validationItem blocked"}>
                {accountMessage === "Account updated." ? <Check size={17} /> : <AlertTriangle size={17} />}
                <span>{accountMessage}</span>
              </div>
            ) : null}
            <button className="primaryButton" type="submit">
              <Check size={17} />
              Save Account
            </button>
          </form>
        </section>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="loginShell">
        <section className="loginPanel">
          <div className="brandBlock loginBrand">
            <div className="brandMark brandMarkImage">
              <img src="/icon.svg" alt="Prismatica logo" width={30} height={30} />
            </div>
            <div>
              <strong>Prismatica</strong>
              <span>Open source PRISMA review platform</span>
            </div>
          </div>

          <div className={authSettings.registrationEnabled ? "segmented authTabs" : "segmented authTabs singleAuthTab"}>
            <button className={authMode === "signIn" ? "active" : ""} type="button" onClick={() => { setAuthMode("signIn"); setLoginError(""); }}>
              Sign In
            </button>
            {authSettings.registrationEnabled ? (
              <button className={authMode === "register" ? "active" : ""} type="button" onClick={() => { setAuthMode("register"); setLoginError(""); }}>
                Register
              </button>
            ) : null}
          </div>

          {authMode === "signIn" ? (
          <form className="loginForm" onSubmit={handleLogin}>
            <div>
              <p className="eyebrow">Sign in</p>
              <h1>Continue to your review dashboard</h1>
              <p className="subtle">Use an existing account to see review memberships, profiles, and project access.</p>
            </div>
            <label>
              <span>Email</span>
              <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
            </label>
            <label>
              <span>Password</span>
              <div className="passwordField">
                <input
                  type={showLoginPassword ? "text" : "password"}
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                />
                <button
                  type="button"
                  title={showLoginPassword ? "Hide password" : "Show password"}
                  aria-label={showLoginPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowLoginPassword((visible) => !visible)}
                >
                  {showLoginPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {loginError ? (
              <div className="validationItem blocked">
                <AlertTriangle size={17} />
                <span>{loginError}</span>
              </div>
            ) : null}
            <button className="primaryButton" type="submit">
              <LogIn size={17} />
              Sign In
            </button>
          </form>
          ) : (
          <form className="loginForm" onSubmit={handleRegistration}>
            <div>
              <p className="eyebrow">Register</p>
              <h1>Create a reviewer account</h1>
              <p className="subtle">Registration creates a server account. You can create a review immediately after signing up.</p>
            </div>
            <label>
              <span>Name</span>
              <input value={registerForm.name} onChange={(event) => setRegisterForm((previous) => ({ ...previous, name: event.target.value }))} />
            </label>
            <label>
              <span>Email</span>
              <input value={registerForm.email} onChange={(event) => setRegisterForm((previous) => ({ ...previous, email: event.target.value }))} />
            </label>
            <label>
              <span>Organization</span>
              <input value={registerForm.organization} onChange={(event) => setRegisterForm((previous) => ({ ...previous, organization: event.target.value }))} />
            </label>
            <label>
              <span>Role title</span>
              <input value={registerForm.title} onChange={(event) => setRegisterForm((previous) => ({ ...previous, title: event.target.value }))} />
            </label>
            <label>
              <span>Password</span>
              <div className="passwordField">
                <input
                  type={showRegisterPassword ? "text" : "password"}
                  value={registerForm.password}
                  onChange={(event) => setRegisterForm((previous) => ({ ...previous, password: event.target.value }))}
                />
                <button
                  type="button"
                  title={showRegisterPassword ? "Hide password" : "Show password"}
                  aria-label={showRegisterPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowRegisterPassword((visible) => !visible)}
                >
                  {showRegisterPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            <label>
              <span>Captcha</span>
              <div className="captchaField">
                <strong>{captchaChallenge?.question ?? "Loading..."}</strong>
                <input
                  inputMode="numeric"
                  value={registerForm.captchaAnswer}
                  onChange={(event) => setRegisterForm((previous) => ({ ...previous, captchaAnswer: event.target.value }))}
                />
                <button type="button" onClick={() => loadAuthConfig().catch(() => undefined)}>
                  Refresh
                </button>
              </div>
            </label>
            {loginError ? (
              <div className="validationItem blocked">
                <AlertTriangle size={17} />
                <span>{loginError}</span>
              </div>
            ) : null}
            <button className="primaryButton" type="submit">
              <PenLine size={17} />
              Register
            </button>
          </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <div className="appFrame">
      <aside className={isMobileNavOpen ? "sidebar open" : "sidebar"} aria-label="Project navigation">
        <div className="sidebarHeader">
          <button
            className="brandBlock brandButton"
            type="button"
            title="Go to homepage"
            onClick={() => {
              setActiveView("dashboard");
              setIsMobileNavOpen(false);
            }}
          >
            <div className="brandMark brandMarkImage">
              <img src="/icon.svg" alt="PRISMATICA logo" width={30} height={30} />
            </div>
            <div>
              <strong>PRISMATICA</strong>
              <span>Open source PRISMA review platform</span>
            </div>
          </button>
          <button
            className="ghostButton iconOnly mobileNavToggle"
            type="button"
            title={isMobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={isMobileNavOpen}
            onClick={() => setIsMobileNavOpen((open) => !open)}
          >
            <PanelRight size={18} />
          </button>
        </div>

        {isProjectView ? (
          <div className="projectContext">
            <button
              className="ghostButton"
              type="button"
              onClick={() => {
                setActiveView("dashboard");
                setIsMobileNavOpen(false);
              }}
            >
              <ArrowLeft size={16} />
              All Reviews
            </button>
            <div>
              <Badge label={formatProjectPhase(selectedProject.stage)} tone={projectPhaseBadgeTone(selectedProject.stage)} />
              <strong>{selectedProject.title}</strong>
              <span>{selectedProject.protocolId}</span>
            </div>
            <div className="progressTrack">
              <i style={{ width: `${selectedProject.recordsTotal > 0 ? Math.round((selectedProject.recordsScreened / selectedProject.recordsTotal) * 100) : 0}%` }} />
            </div>
          </div>
        ) : null}

        <nav className="navList">
          {(isProjectView
            ? projectNavItems
            : globalNavItems.filter((item) => !["adminReviews", "registeredUsers"].includes(item.key) || currentUser.isAdmin)
          ).map(({ key, label, path, Icon }) => {
            const phaseState = isProjectView ? getPhaseNavState(key, selectedProject.stage) : null;
            const navClassName = ["navItem", activeView === key ? "active" : "", phaseState ? `phase-${phaseState}` : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                className={navClassName}
                type="button"
                key={key}
                aria-current={activeView === key ? "page" : undefined}
                onClick={() => {
                  setActiveView(key);
                  setIsMobileNavOpen(false);
                }}
                title={phaseState ? `${path} · ${phaseState === "current" ? "current phase" : phaseState}` : path}
              >
                {Icon ? <Icon size={18} /> : <span className="navAvatar" style={{ background: currentUser.avatarColor }}>{currentUser.initials}</span>}
                <span>{label}</span>
                {phaseState ? <i className="navPhaseMarker" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </nav>

        {/* <div className="sidebarFooter">
          <Lock size={16} />
          <span>{isProjectView ? "Blind mode is enforced for reviewer views." : "Project access follows membership."}</span>
        </div> */}
      </aside>

      <main className="mainArea">
        {renderActiveView()}
      </main>
    </div>
  );
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
    screening: 1,
    fullText: 2,
    extraction: 3
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
