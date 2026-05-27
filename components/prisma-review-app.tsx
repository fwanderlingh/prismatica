"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  appUsers as seedUsers,
  dedupCandidates as seedDedupCandidates,
  extractionRows,
  highlightRules,
  importBatches,
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
  type PrismaCounts,
  type ReviewProject,
  type Report,
  type ViewKey,
  type WorkflowEvent
} from "@/lib/prismaData";
import type { ApiErrorPayload, AppMutationPayload, AppStatePayload } from "@/lib/apiTypes";
import { evaluateStage, type DecisionValue } from "@/lib/workflow";

type NavItem = {
  key: ViewKey;
  label: string;
  path: string;
  Icon: LucideIcon;
};

type DecisionAction = {
  studyId: string;
  previousDecisionId?: string;
};

const globalNavItems: NavItem[] = [
  { key: "dashboard", label: "All Reviews", path: "/dashboard", Icon: Home },
  { key: "newProject", label: "New Review", path: "/projects/new", Icon: FolderPlus },
  { key: "profile", label: "Profile", path: "/profile", Icon: UserCircle }
];

const projectNavItems: NavItem[] = [
  { key: "projectDashboard", label: "Project Overview", path: "/project/current/dashboard", Icon: LayoutDashboard },
  { key: "imports", label: "Imports", path: "/project/current/imports", Icon: Import },
  { key: "dedup", label: "Dedup", path: "/project/current/dedup", Icon: GitMerge },
  { key: "screening", label: "Screening", path: "/project/current/screen/title-abstract", Icon: FileSearch },
  { key: "fullText", label: "Full Text", path: "/project/current/full-text", Icon: BookOpen },
  { key: "extraction", label: "Extraction", path: "/project/current/extraction/consensus", Icon: ClipboardCheck },
  { key: "risk", label: "Risk of Bias", path: "/project/current/risk-of-bias", Icon: ShieldCheck },
  { key: "exports", label: "Exports", path: "/project/current/exports", Icon: Download },
  { key: "settings", label: "Settings", path: "/project/current/settings", Icon: Settings }
];

type NewProjectForm = {
  title: string;
  organization: string;
  protocolId: string;
  description: string;
  dueDate: string;
  blindMode: boolean;
  abstractRequiredVotes: number;
  fullTextRequiredVotes: number;
  maybePolicy: "advance_to_full_text" | "conflict" | "third_vote";
  memberIds: string[];
};

const exclusionReasons = Object.keys(prismaCounts.reportsExcludedWithReasons);

const emptyProjectForm: NewProjectForm = {
  title: "",
  organization: "Evidence Methods Unit",
  protocolId: "",
  description: "",
  dueDate: "30-09-2026",
  blindMode: true,
  abstractRequiredVotes: 2,
  fullTextRequiredVotes: 2,
  maybePolicy: "advance_to_full_text",
  memberIds: []
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

export function PrismaReviewApp() {
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [users, setUsers] = useState<AppUser[]>(seedUsers);
  const [projects, setProjects] = useState<ReviewProject[]>(reviewProjects);
  const [currentUserId, setCurrentUserId] = useState(seedUsers[0].id);
  const [selectedProjectId, setSelectedProjectId] = useState(reviewProjects[0].id);
  const [authMode, setAuthMode] = useState<"signIn" | "register">("signIn");
  const [loginEmail, setLoginEmail] = useState(seedUsers[0].email);
  const [loginPassword, setLoginPassword] = useState("review-demo");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    organization: "",
    title: "Reviewer",
    password: ""
  });
  const [teamUserId, setTeamUserId] = useState("");
  const [inviteForm, setInviteForm] = useState({
    name: "",
    email: "",
    title: "Reviewer"
  });
  const [teamMessage, setTeamMessage] = useState("");
  const [newProjectForm, setNewProjectForm] = useState<NewProjectForm>({
    ...emptyProjectForm,
    memberIds: [seedUsers[0].id, seedUsers[1].id]
  });
  const [decisions, setDecisions] = useState<Decision[]>(initialDecisions);
  const [events, setEvents] = useState<WorkflowEvent[]>(initialWorkflowEvents);
  const [dedupCandidates, setDedupCandidates] = useState<DedupCandidate[]>(seedDedupCandidates);
  const [studyIndex, setStudyIndex] = useState(0);
  const [decisionActions, setDecisionActions] = useState<DecisionAction[]>([]);
  const [screeningNote, setScreeningNote] = useState("");
  const [activeReport, setActiveReport] = useState<Report>(reportQueue[0]);
  const [retrievalStatus, setRetrievalStatus] = useState<Report["retrievalStatus"]>(reportQueue[0].retrievalStatus);
  const [fullTextDecision, setFullTextDecision] = useState<DecisionValue | null>(null);
  const [fullTextReason, setFullTextReason] = useState(exclusionReasons[0]);

  const currentUser = users.find((user) => user.id === currentUserId) ?? users[0] ?? seedUsers[0];
  const userProjects = useMemo(
    () => projects.filter((project) => project.memberIds.includes(currentUser.id) || project.ownerId === currentUser.id),
    [currentUser.id, projects]
  );
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? userProjects[0] ?? projects[0] ?? reviewProjects[0];
  const activeCounts = useMemo(() => getCountsForProject(selectedProject), [selectedProject]);
  const isProjectView = activeView !== "dashboard" && activeView !== "newProject" && activeView !== "profile";
  const hasProjectSeedData = selectedProject.id === "demo-review";
  const projectImportBatches = hasProjectSeedData ? importBatches : [];
  const projectDedupCandidates = hasProjectSeedData ? dedupCandidates : [];
  const projectScreeningStudies = hasProjectSeedData ? screeningStudies : [];
  const projectReportQueue = hasProjectSeedData ? reportQueue : [];
  const projectIdSet = useMemo(() => new Set(projects.map((project) => project.id)), [projects]);
  const projectEvents = hasProjectSeedData
    ? events.filter((event) => !projectIdSet.has(event.entity) || event.entity === selectedProject.id)
    : events.filter((event) => event.entity === selectedProject.id);
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
          setIsAuthenticated(false);
        }
      }
    }

    loadServerSession();
    return () => {
      isMounted = false;
    };
  }, []);

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

  function applyAppState(payload: AppStatePayload | AppMutationPayload) {
    setUsers(payload.users);
    setProjects(payload.projects);
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
    const email = registerForm.email.trim().toLowerCase();
    const name = registerForm.name.trim();
    const organization = registerForm.organization.trim();

    if (!name || !email || !organization || !registerForm.password.trim()) {
      setLoginError("Complete name, email, organization, and password to register.");
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
          password: registerForm.password
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
        password: ""
      });
      setIsAuthenticated(true);
      setActiveView("dashboard");
    } catch (error) {
      setLoginError(getErrorMessage(error));
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
    setLoginPassword("review-demo");
  }

  function selectLoginUser(user: AppUser) {
    setLoginEmail(user.email);
    setLoginError("");
  }

  function openProject(projectId: string, view: ViewKey = "projectDashboard") {
    setSelectedProjectId(projectId);
    setActiveView(view);
    setStudyIndex(0);
    setActiveReport(reportQueue[0]);
    setRetrievalStatus(reportQueue[0].retrievalStatus);
    setFullTextDecision(null);
  }

  function updateNewProjectForm<Key extends keyof NewProjectForm>(key: Key, value: NewProjectForm[Key]) {
    setNewProjectForm((previous) => ({
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

  async function updateProjectMembers(projectId: string, memberIds: string[], eventLabel: string) {
    try {
      const payload = await apiRequest<AppMutationPayload>(`/api/projects/${projectId}/members`, {
        method: "PATCH",
        body: JSON.stringify({ memberIds, eventLabel })
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

    const didUpdate = await updateProjectMembers(selectedProject.id, [...selectedProject.memberIds, user.id], `Added ${user.name} to project team`);
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

    if (userId === selectedProject.ownerId) {
      setTeamMessage("The project owner cannot be removed.");
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
      case "settings":
        return renderSettings();
      case "newProject":
        return renderNewProject();
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
              {currentUser.name} · {currentUser.organization} · {userProjects.length} accessible reviews
            </p>
          </div>
          <div className="toolbarCluster">
            <button className="ghostButton" type="button" title="Open profile" onClick={() => setActiveView("profile")}>
              <UserCircle size={17} />
              Profile
            </button>
            <button className="primaryButton" type="button" title="Create a new review" onClick={() => setActiveView("newProject")}>
              <Plus size={17} />
              New Review
            </button>
          </div>
        </section>

        <section className="metricGrid" aria-label="Portfolio metrics">
          <Metric label="Accessible reviews" value={userProjects.length.toString()} tone="blue" detail={`${activeReviews} active review projects`} />
          <Metric label="Records across reviews" value={totalRecords.toLocaleString()} tone="teal" detail="Counts visible by membership" />
          <Metric label="Open conflicts" value={totalConflicts.toString()} tone="amber" detail="Title/abstract and full-text queues" />
          <Metric label="Team members" value={users.length.toString()} tone="green" detail="Users with review-specific access" />
        </section>

        {userProjects.length > 0 ? (
        <section className="reviewGrid">
          {userProjects.map((project) => {
            const owner = users.find((user) => user.id === project.ownerId);
            const progress = project.recordsTotal > 0 ? Math.round((project.recordsScreened / project.recordsTotal) * 100) : 0;
            return (
              <article className="panel projectCard" key={project.id}>
                <div className="projectCardHeader">
                  <div>
                    <Badge label={project.status} tone={project.status === "active" ? "success" : project.status === "draft" ? "warning" : "neutral"} />
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
                    {owner?.name ?? "Unassigned owner"}
                  </span>
                  <span>
                    <CalendarClock size={15} />
                    Due {formatEuDate(project.dueDate)}
                  </span>
                </div>
                <div className="progressBlock">
                  <span>{progress}% screened · {project.recordsScreened.toLocaleString()} of {project.recordsTotal.toLocaleString()} records</span>
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
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderProjectDashboard() {
    const activeStudies = activeCounts.reportsSought + activeCounts.studiesIncluded;
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Project dashboard</p>
            <h1>{selectedProject.title}</h1>
            <p className="subtle">
              {selectedProject.protocolId} · {selectedProject.organization}
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
          <Metric label="Records identified" value={recordsIdentified.toLocaleString()} tone="blue" detail="Database, register, and manual sources" />
          <Metric label="Duplicates removed" value={activeCounts.duplicateRecordsRemoved.toString()} tone="teal" detail="Preserved for PRISMA provenance" />
          <Metric label="Records screened" value={activeCounts.recordsScreened.toString()} tone="amber" detail={`${activeCounts.recordsExcluded} excluded at title/abstract`} />
          <Metric label="Studies included" value={activeCounts.studiesIncluded.toString()} tone="green" detail={`${activeCounts.studiesIncludedMetaAnalysis} in meta-analysis`} />
        </section>

        <section className="dashboardGrid">
          <div className="panel largePanel">
            <SectionTitle icon={Activity} title="Review Workflow" action="Live state machine" />
            <div className="workflowMap" aria-label="Review workflow">
              {[
                ["Import", `${recordsIdentified.toLocaleString()} records`, recordsIdentified > 0 ? "complete" : "pending"],
                ["Deduplicate", `${activeCounts.duplicateRecordsRemoved} removed`, recordsIdentified > 0 ? "active" : "pending"],
                ["Screen", `${activeCounts.recordsScreened} records`, activeCounts.recordsScreened > 0 ? "active" : "pending"],
                ["Full text", `${activeCounts.reportsSought} reports`, activeCounts.reportsSought > 0 ? "active" : "pending"],
                ["Extract", `${activeStudies} items`, activeCounts.studiesIncluded > 0 ? "active" : "pending"],
                ["Export", "PRISMA 2020", activeCounts.studiesIncluded > 0 ? "ready" : "pending"]
              ].map(([label, value, status]) => (
                <div className={`workflowNode ${status}`} key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="stateRows">
              <StatusRow label="Blind mode" value={selectedProject.blindMode ? "Server-enforced visibility model" : "Disabled"} tone="secure" />
              <StatusRow label="Maybe policy" value={formatMaybePolicy(selectedProject.maybePolicy)} tone="info" />
              <StatusRow label="Unresolved conflicts" value={`${selectedProject.conflicts} open conflicts`} tone="warning" />
            </div>
          </div>

          <div className="panel">
            <SectionTitle icon={History} title="Audit Trail" action="Append-only" />
            {projectEvents.length > 0 ? (
            <div className="eventList">
              {projectEvents.map((event) => (
                <article className="eventItem" key={event.id}>
                  <div>
                    <strong>{event.action}</strong>
                    <span>
                      {event.actor} · {event.entity}
                    </span>
                  </div>
                  <time>{event.time}</time>
                </article>
              ))}
            </div>
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
          <SectionTitle icon={BarChart3} title="PRISMA Count Preview" action="Validated counts" />
          <PrismaFlow counts={activeCounts} reportsExcludedTotal={reportsExcludedTotal} />
        </section>
      </div>
    );
  }

  function renderImports() {
    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Import and provenance</p>
            <h1>Record Intake</h1>
            <p className="subtle">RIS, BibTeX, EndNote XML, and CSV batches remain traceable to the original payload.</p>
          </div>
          <div className="toolbarCluster">
            <button className="ghostButton" type="button" title="Upload a BibTeX file">
              <FileArchive size={17} />
              BibTeX
            </button>
            <button className="primaryButton" type="button" title="Upload an RIS file">
              <Upload size={17} />
              RIS Upload
            </button>
          </div>
        </section>

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
                    </tr>
                  </thead>
                  <tbody>
                    {projectImportBatches.map((batch) => (
                      <tr key={batch.id}>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={Upload}
                title="No imports yet"
                description="Upload RIS, BibTeX, EndNote XML, or CSV files to populate records for this review."
              />
            )}
          </div>

          <div className="panel">
            <SectionTitle icon={FileText} title="Provenance Model" action="Record -> Report -> Study" />
            <div className="provenanceStack">
              <div>
                <Database size={22} />
                <strong>Imported record</strong>
                <span>One citation from PubMed, Embase, Scopus, or manual entry.</span>
              </div>
              <ChevronRight size={18} />
              <div>
                <GitMerge size={22} />
                <strong>Study candidate</strong>
                <span>Canonical review unit created after deduplication.</span>
              </div>
              <ChevronRight size={18} />
              <div>
                <BookOpen size={22} />
                <strong>Report</strong>
                <span>Full-text article or PDF associated with the study.</span>
              </div>
            </div>
            {projectImportBatches.length > 0 ? (
              <div className="warningBox">
                <AlertTriangle size={18} />
                <span>Scopus has 24 parser warnings: nested BibTeX braces and two missing years need review.</span>
              </div>
            ) : (
              <div className="secureBox">
                <Lock size={17} />
                <span>Record provenance will appear here after the first committed import batch.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderDedup() {
    if (!latestPendingDedup) {
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
              title="No duplicate candidates"
              description="This review is waiting for imported records before deduplication can generate candidate pairs."
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
            <p className="doiNote">{latestPendingDedup.explanation.doi}</p>
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
              description="Import records, run deduplication, and commit canonical studies to open this queue."
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
                return (
                  <button
                    className={index === studyIndex ? "queueItem active" : "queueItem"}
                    type="button"
                    key={study.id}
                    onClick={() => setStudyIndex(index)}
                  >
                    <span>{study.title}</span>
                    {decision ? <Badge label={formatDecision(decision.decisionValue)} tone={decisionTone(decision.decisionValue)} /> : <Badge label="open" tone="neutral" />}
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
                  {currentStudy.authors.join(", ")} · {currentStudy.journal} · {currentStudy.year}
                </p>
              </div>
              <Badge label={stageEvaluation.label} tone={stageEvaluation.state === "conflict" ? "danger" : "info"} />
            </div>
            <div className="metaStrip">
              <span>DOI {currentStudy.doi}</span>
              <span>{currentStudy.keywords.join(" · ")}</span>
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

    const currentReportStudy = projectScreeningStudies.find((study) => study.id === activeReport.studyId) ?? screeningStudies[0];
    const canExclude = fullTextDecision === "exclude";

    return (
      <div className="viewStack">
        <section className="overviewBand compactBand">
          <div>
            <p className="eyebrow">Full-text screening</p>
            <h1>Report Review</h1>
            <p className="subtle">Retrieval status and report-level exclusion reasons feed the PRISMA export.</p>
          </div>
          <div className="segmented">
            {projectReportQueue.map((report) => (
              <button
                className={report.id === activeReport.id ? "active" : ""}
                type="button"
                key={report.id}
                onClick={() => {
                  setActiveReport(report);
                  setRetrievalStatus(report.retrievalStatus);
                  setFullTextDecision(null);
                }}
              >
                {report.id.replace("report-", "Report ")}
              </button>
            ))}
          </div>
        </section>

        <section className="fullTextLayout">
          <div className="pdfPane">
            <div className="pdfToolbar">
              <strong>{activeReport.pdfName}</strong>
              <div className="toolbarCluster">
                <button className="ghostButton iconOnly" type="button" title="Search PDF">
                  <Search size={16} />
                </button>
                <button className="ghostButton iconOnly" type="button" title="Zoom in">
                  <ZoomIn size={16} />
                </button>
                <button className="ghostButton iconOnly" type="button" title="Show notes">
                  <MessageSquareText size={16} />
                </button>
              </div>
            </div>
            <div className="pdfCanvas" aria-label="PDF viewer mock">
              <div className="paperPage">
                <p className="paperEyebrow">Journal article</p>
                <h2>{currentReportStudy.title}</h2>
                <div className="paperLine wide" />
                <div className="paperLine" />
                <div className="paperLine short" />
                <h3>Methods</h3>
                <div className="paperColumns">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <h3>Results</h3>
                <div className="miniChart">
                  <i style={{ height: "62%" }} />
                  <i style={{ height: "44%" }} />
                  <i style={{ height: "78%" }} />
                  <i style={{ height: "52%" }} />
                </div>
              </div>
            </div>
          </div>

          <aside className="panel fullTextPanel">
            <SectionTitle icon={BookOpen} title="Report Metadata" action={`${activeReport.notes} notes`} />
            <h2>{activeReport.title}</h2>
            <p className="subtle">{activeReport.citation}</p>

            <label className="fieldLabel" htmlFor="retrieval-status">
              Retrieval status
            </label>
            <select id="retrieval-status" value={retrievalStatus} onChange={(event) => setRetrievalStatus(event.target.value as Report["retrievalStatus"])}>
              <option value="not_sought">Not sought</option>
              <option value="sought">Sought</option>
              <option value="retrieved">Retrieved</option>
              <option value="not_retrieved">Not retrieved</option>
            </select>

            <div className="decisionButtons compactButtons">
              <button className={fullTextDecision === "include" ? "includeButton active" : "includeButton"} type="button" onClick={() => setFullTextDecision("include")}>
                <CheckCircle2 size={18} />
                Include
              </button>
              <button className={fullTextDecision === "exclude" ? "excludeButton active" : "excludeButton"} type="button" onClick={() => setFullTextDecision("exclude")}>
                <XCircle size={18} />
                Exclude
              </button>
            </div>

            <label className="fieldLabel" htmlFor="exclusion-reason">
              Exclusion reason
            </label>
            <select id="exclusion-reason" value={fullTextReason} disabled={!canExclude} onChange={(event) => setFullTextReason(event.target.value)}>
              {exclusionReasons.map((reason) => (
                <option value={reason} key={reason}>
                  {reason}
                </option>
              ))}
            </select>

            <div className={canExclude ? "validationBox ok" : "validationBox"}>
              {canExclude ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{canExclude ? `Exclusion will be exported as ${fullTextReason}.` : "A full-text exclusion requires a reason."}</span>
            </div>
          </aside>
        </section>
      </div>
    );
  }

  function renderExtraction() {
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
          <section className="panel">
            <EmptyState
              icon={ClipboardCheck}
              title="No included studies yet"
              description="Complete screening and full-text eligibility before creating extraction assignments."
            />
          </section>
        </div>
      );
    }

    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Data extraction</p>
            <h1>Consensus Workspace</h1>
            <p className="subtle">Versioned form schemas keep historic responses reproducible.</p>
          </div>
          <button className="primaryButton" type="button" title="Create a form version">
            <FileCheck2 size={17} />
            New Version
          </button>
        </section>

        <section className="twoColumn">
          <div className="panel">
            <SectionTitle icon={ClipboardCheck} title="Form Schema" action="Version 3 active" />
            <div className="schemaList">
              {[
                ["Study characteristics", "Country, sample size, design"],
                ["Intervention details", "Mode, duration, personnel"],
                ["Outcomes", "Primary endpoint, time point, effect size"],
                ["Implementation", "Setting, fidelity, attrition"]
              ].map(([title, fields]) => (
                <div key={title}>
                  <strong>{title}</strong>
                  <span>{fields}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <SectionTitle icon={UserRoundCheck} title="Assignment Status" action="Dual extraction" />
            <div className="assignmentBars">
              <ScoreBar label="Assigned" value={0.84} />
              <ScoreBar label="Submitted" value={0.63} />
              <ScoreBar label="Consensus" value={0.41} />
            </div>
          </div>
        </section>

        <section className="panel">
          <SectionTitle icon={ListChecks} title="Consensus Table" action="Field comparison" />
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Reviewer A</th>
                  <th>Reviewer B</th>
                  <th>Consensus</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {extractionRows.map((row) => (
                  <tr key={row.field}>
                    <td>{row.field}</td>
                    <td>{row.reviewerA}</td>
                    <td>{row.reviewerB}</td>
                    <td>
                      <strong>{row.consensus}</strong>
                    </td>
                    <td>
                      <Badge label={row.status} tone={row.status === "matched" ? "success" : "info"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

  function renderSettings() {
    const projectMembers = selectedProject.memberIds
      .map((memberId) => users.find((user) => user.id === memberId))
      .filter((user): user is AppUser => Boolean(user));
    const availableUsers = users.filter((user) => !selectedProject.memberIds.includes(user.id));

    return (
      <div className="viewStack">
        <section className="overviewBand">
          <div>
            <p className="eyebrow">Project settings</p>
            <h1>Review Controls</h1>
            <p className="subtle">Authorization, blind-mode visibility, and transition policy are separate controls.</p>
          </div>
          <button className="primaryButton" type="button" title="Save settings">
            <Check size={17} />
            Save
          </button>
        </section>

        <section className="settingsGrid">
          <div className="panel">
            <SectionTitle icon={Lock} title="Blind Mode" action={selectedProject.blindMode ? "Enabled" : "Disabled"} />
            <label className="toggleRow">
              <input type="checkbox" checked={selectedProject.blindMode} readOnly />
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
            <div className="settingList">
              <div>
                <span>Title/abstract votes</span>
                <strong>{selectedProject.abstractRequiredVotes}</strong>
              </div>
              <div>
                <span>Full-text votes</span>
                <strong>{selectedProject.fullTextRequiredVotes}</strong>
              </div>
              <div>
                <span>Maybe policy</span>
                <strong>Advance to full text</strong>
              </div>
            </div>
          </div>
        </section>

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
                  <Badge label={member.id === selectedProject.ownerId ? "owner" : "reviewer"} tone={member.id === selectedProject.ownerId ? "info" : "neutral"} />
                  <button
                    className="ghostButton iconOnly"
                    type="button"
                    title={member.id === selectedProject.ownerId ? "Project owner cannot be removed" : "Remove member"}
                    disabled={member.id === selectedProject.ownerId}
                    onClick={() => removeUserFromProject(member.id)}
                  >
                    <X size={16} />
                  </button>
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
                  <th>Members</th>
                  <th>Capabilities</th>
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
                        <strong>{member.id === selectedProject.ownerId ? "Owner" : "Reviewer"}</strong>
                      </td>
                      <td>1</td>
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
                    min={1}
                    max={4}
                    value={newProjectForm.fullTextRequiredVotes}
                    onChange={(event) => updateNewProjectForm("fullTextRequiredVotes", Number(event.target.value))}
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

  function renderProfile() {
    const ownedProjects = projects.filter((project) => project.ownerId === currentUser.id);

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

        <section className="settingsGrid">
          <div className="panel">
            <SectionTitle icon={UserCircle} title="Account" action="Server session" />
            <div className="profileRows">
              <StatusRow label="Organization" value={currentUser.organization} tone="info" />
              <StatusRow label="Timezone" value={currentUser.timezone} tone="secure" />
              <StatusRow label="Owned reviews" value={ownedProjects.length.toString()} tone="warning" />
            </div>
          </div>

          <div className="panel">
            <SectionTitle icon={Users} title="Team Directory" action="Server accounts" />
            <div className="memberPicker">
              {users.map((user) => (
                <div
                  className={user.id === currentUser.id ? "userSwitch active" : "userSwitch"}
                  key={user.id}
                >
                  <span className="avatar" style={{ background: user.avatarColor }}>
                    {user.initials}
                  </span>
                  <div>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <SectionTitle icon={LayoutDashboard} title="My Reviews" action={`${userProjects.length} accessible`} />
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Review</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {userProjects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <strong>{project.title}</strong>
                      <span>{project.organization}</span>
                    </td>
                    <td>{project.ownerId === currentUser.id ? "Owner" : "Member"}</td>
                    <td>
                      <Badge label={project.status} tone={project.status === "active" ? "success" : project.status === "draft" ? "warning" : "neutral"} />
                    </td>
                    <td>{formatEuDate(project.updatedAt)}</td>
                    <td>
                      <button className="ghostButton" type="button" onClick={() => openProject(project.id)}>
                        <ChevronRight size={17} />
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="loginShell">
        <section className="loginPanel">
          <div className="brandBlock loginBrand">
            <div className="brandMark">
              <FileSearch size={25} />
            </div>
            <div>
              <strong>Prismatica</strong>
              <span>Open source PRISMA review platform</span>
            </div>
          </div>

          <div className="segmented authTabs">
            <button className={authMode === "signIn" ? "active" : ""} type="button" onClick={() => { setAuthMode("signIn"); setLoginError(""); }}>
              Sign In
            </button>
            <button className={authMode === "register" ? "active" : ""} type="button" onClick={() => { setAuthMode("register"); setLoginError(""); }}>
              Register
            </button>
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

        <section className="loginUsers">
          <div>
            <p className="eyebrow">Seed accounts</p>
            <h2>Choose email</h2>
          </div>
          <div className="userGrid">
            {users.map((user) => (
              <button
                className={loginEmail === user.email ? "loginUserCard active" : "loginUserCard"}
                type="button"
                key={user.id}
                onClick={() => selectLoginUser(user)}
              >
                <span className="avatar" style={{ background: user.avatarColor }}>
                  {user.initials}
                </span>
                <strong>{user.name}</strong>
                <small>{user.title}</small>
                <em>{projects.filter((project) => project.memberIds.includes(user.id) || project.ownerId === user.id).length} reviews</em>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="appFrame">
      <aside className="sidebar" aria-label="Project navigation">
        <div className="brandBlock">
          <div className="brandMark">
            <FileSearch size={24} />
          </div>
          <div>
            <strong>Prismatica</strong>
            <span>Open source PRISMA review platform</span>
          </div>
        </div>

        {isProjectView ? (
          <div className="projectContext">
            <button className="ghostButton" type="button" onClick={() => setActiveView("dashboard")}>
              <ArrowLeft size={16} />
              All Reviews
            </button>
            <div>
              <Badge label={selectedProject.status} tone={selectedProject.status === "active" ? "success" : selectedProject.status === "draft" ? "warning" : "neutral"} />
              <strong>{selectedProject.title}</strong>
              <span>{selectedProject.protocolId}</span>
            </div>
            <div className="progressTrack">
              <i style={{ width: `${selectedProject.recordsTotal > 0 ? Math.round((selectedProject.recordsScreened / selectedProject.recordsTotal) * 100) : 0}%` }} />
            </div>
          </div>
        ) : null}

        <nav className="navList">
          {(isProjectView ? projectNavItems : globalNavItems).map(({ key, label, path, Icon }) => (
            <button
              className={activeView === key ? "navItem active" : "navItem"}
              type="button"
              key={key}
              aria-current={activeView === key ? "page" : undefined}
              onClick={() => setActiveView(key)}
              title={path}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebarFooter">
          <Lock size={16} />
          <span>{isProjectView ? "Blind mode is enforced for reviewer views." : "Project access follows membership."}</span>
        </div>
      </aside>

      <main className="mainArea">
        <header className="topbar">
          <div className="projectCrumb">
            <span>{!isProjectView ? currentUser.organization : selectedProject.organization}</span>
            <ChevronRight size={15} />
            <strong>{!isProjectView ? (activeView === "newProject" ? "New review" : activeView === "profile" ? "Profile" : "All reviews") : selectedProject.protocolId}</strong>
          </div>
          <div className="topbarActions">
            <button className="ghostButton iconOnly" type="button" title="Search records">
              <Search size={17} />
            </button>
            <button className="ghostButton" type="button" title="Open audit log">
              <History size={17} />
              Audit
            </button>
            <button className="userPill" type="button" onClick={() => setActiveView("profile")} title="Open profile">
              <span style={{ background: currentUser.avatarColor }}>{currentUser.initials}</span>
              <strong>{currentUser.name}</strong>
            </button>
          </div>
        </header>

        {renderActiveView()}
      </main>
    </div>
  );
}

function getCountsForProject(project: ReviewProject): PrismaCounts {
  return (
    seedProjectCounts[project.id] ?? {
      recordsIdentifiedDatabase: project.recordsTotal,
      recordsIdentifiedRegisters: 0,
      recordsIdentifiedOther: 0,
      duplicateRecordsRemoved: 0,
      automationRemoved: 0,
      removedOtherReasons: 0,
      recordsScreened: project.recordsScreened,
      recordsExcluded: Math.max(project.recordsScreened - project.studiesIncluded, 0),
      reportsSought: project.studiesIncluded,
      reportsNotRetrieved: 0,
      reportsAssessed: 0,
      reportsExcludedWithReasons: {
        "Wrong population": 0,
        "Wrong intervention": 0,
        "Wrong comparator": 0,
        "Wrong outcome": 0,
        "Wrong study design": 0,
        "Full text unavailable": 0
      },
      studiesIncluded: project.studiesIncluded,
      studiesIncludedMetaAnalysis: 0
    }
  );
}

function SectionTitle({ icon: Icon, title, action }: { icon: LucideIcon; title: string; action: string }) {
  return (
    <div className="sectionTitle">
      <div>
        <Icon size={18} />
        <h2>{title}</h2>
      </div>
      <span>{action}</span>
    </div>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "blue" | "teal" | "amber" | "green" }) {
  return (
    <article className={`metricCard ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: "secure" | "info" | "warning" }) {
  return (
    <div className={`statusRow ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}

function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="emptyState">
      <Icon size={28} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="scoreBar">
      <div>
        <span>{label}</span>
        <strong>{Math.round(value * 100)}%</strong>
      </div>
      <i>
        <b style={{ width: `${Math.round(value * 100)}%` }} />
      </i>
    </div>
  );
}

function RecordComparison({ title, source, study }: { title: string; source: string; study: (typeof screeningStudies)[number] }) {
  return (
    <article className="panel recordCard">
      <SectionTitle icon={Archive} title={title} action={source} />
      <dl>
        <div>
          <dt>Title</dt>
          <dd>{study.title}</dd>
        </div>
        <div>
          <dt>Authors</dt>
          <dd>{study.authors.join(", ")}</dd>
        </div>
        <div>
          <dt>Journal</dt>
          <dd>{study.journal}</dd>
        </div>
        <div>
          <dt>Year</dt>
          <dd>{study.year}</dd>
        </div>
        <div>
          <dt>DOI</dt>
          <dd>{study.doi || "Missing"}</dd>
        </div>
      </dl>
    </article>
  );
}

function PrismaFlow({ counts, reportsExcludedTotal }: { counts: PrismaCounts; reportsExcludedTotal: number }) {
  return (
    <div className="prismaFlow">
      <div className="flowColumn">
        <FlowBox label="Records identified from databases" value={counts.recordsIdentifiedDatabase} icon={Database} />
        <FlowBox label="Records identified from registers" value={counts.recordsIdentifiedRegisters} icon={Archive} />
        <FlowBox label="Records identified from other sources" value={counts.recordsIdentifiedOther} icon={FileText} />
      </div>
      <div className="flowColumn">
        <FlowBox label="Duplicate records removed" value={counts.duplicateRecordsRemoved} icon={GitMerge} tone="teal" />
        <FlowBox label="Removed by automation or other reasons" value={counts.automationRemoved + counts.removedOtherReasons} icon={AlertTriangle} tone="amber" />
      </div>
      <div className="flowColumn mainFlow">
        <FlowBox label="Records screened" value={counts.recordsScreened} icon={Eye} tone="blue" />
        <FlowBox label="Reports sought for retrieval" value={counts.reportsSought} icon={BookOpen} tone="blue" />
        <FlowBox label="Reports assessed for eligibility" value={counts.reportsAssessed} icon={FileSearch} tone="blue" />
        <FlowBox label="Studies included in review" value={counts.studiesIncluded} icon={CheckCircle2} tone="green" />
      </div>
      <div className="flowColumn">
        <FlowBox label="Records excluded" value={counts.recordsExcluded} icon={XCircle} tone="coral" />
        <FlowBox label="Reports not retrieved" value={counts.reportsNotRetrieved} icon={AlertTriangle} tone="amber" />
        <FlowBox label="Reports excluded with reasons" value={reportsExcludedTotal} icon={ListChecks} tone="coral" />
        <FlowBox label="Included in meta-analysis" value={counts.studiesIncludedMetaAnalysis} icon={BarChart3} tone="green" />
      </div>
    </div>
  );
}

function FlowBox({
  label,
  value,
  icon: Icon,
  tone = "neutral"
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "neutral" | "blue" | "teal" | "amber" | "coral" | "green";
}) {
  return (
    <div className={`flowBox ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
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

function formatDecision(value: DecisionValue) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
