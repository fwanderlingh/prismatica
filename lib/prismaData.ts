import type { DecisionValue, MaybePolicy, Stage } from "./workflow";

export type ViewKey =
  | "dashboard"
  | "projectDashboard"
  | "imports"
  | "dedup"
  | "screening"
  | "fullText"
  | "extraction"
  | "consensus"
  | "risk"
  | "exports"
  | "audit"
  | "settings"
  | "newProject"
  | "about"
  | "adminReviews"
  | "registeredUsers"
  | "profile";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  initials: string;
  organization: string;
  title: string;
  timezone: string;
  avatarColor: string;
  websiteTheme?: WebsiteTheme;
};

export type WebsiteTheme = "light" | "dark" | "system";

export type ProjectSummary = {
  id: string;
  title: string;
  organization: string;
  protocolId: string;
  blindMode: boolean;
  abstractRequiredVotes: number;
  fullTextRequiredVotes: number;
  extractionRequiredVotes: number;
  exclusionReasons: string[];
  maybePolicy: MaybePolicy;
  requireSequentialPhases: boolean;
  reviewers: number;
  lastEvent: string;
};

export type ReviewProject = ProjectSummary & {
  description: string;
  searchStrategies: string;
  status: "active" | "draft" | "archived";
  stage: "setup" | "import" | "screening" | "full_text" | "extraction" | "complete";
  ownerId: string;
  ownerIds: string[];
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
  dueDate: string;
  recordsTotal: number;
  recordsScreened: number;
  conflicts: number;
  studiesIncluded: number;
};

export type ImportBatch = {
  id: string;
  projectId: string;
  sourceName: string;
  format: "ris" | "bib" | "endnote_xml" | "csv";
  filename: string;
  status: "processing" | "parsed" | "committed" | "needs_review";
  records: number;
  parserWarnings: number;
  parserWarningMessages?: string[];
  pdfLinks?: number;
  pdfsRetrieved?: number;
  pdfRetrievalFailures?: number;
  uploadedBy: string;
  uploadedAt: string;
};

export type Study = {
  id: string;
  importItemId?: number;
  projectId?: string;
  importBatchId?: string;
  title: string;
  abstract: string;
  authors: string[];
  journal: string;
  year: number;
  doi: string;
  source: string;
  stage: "title_abstract" | "full_text" | "extraction";
  titleAbstractStatus?: string;
  titleAbstractStatusLabel?: string;
  titleAbstractVoteCount?: number;
  titleAbstractRequiredVotes?: number;
  titleAbstractActiveViewerCount?: number;
  titleAbstractCheckedOutByCurrentUser?: boolean;
  titleAbstractCheckoutExpiresAt?: string;
  keywords: string[];
  pdfUrl?: string;
  rawCitation?: string;
  parserWarnings?: string[];
};

export type Report = {
  id: string;
  projectId: string;
  studyId: string;
  title: string;
  citation: string;
  retrievalStatus: "not_sought" | "sought" | "retrieved" | "not_retrieved";
  pdfName?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  checksum?: string;
  storagePath?: string;
  sourcePdfUrl?: string;
  uploadedByUserId?: string;
  uploadedByUserName?: string;
  fullTextStatus?: string;
  fullTextStatusLabel?: string;
  fullTextVoteCount?: number;
  fullTextRequiredVotes?: number;
  fullTextActiveViewerCount?: number;
  fullTextCheckedOutByCurrentUser?: boolean;
  fullTextCheckoutExpiresAt?: string;
  extractionTemplateId?: string;
  extractionVoteCount?: number;
  extractionRequiredVotes?: number;
  extractionActiveViewerCount?: number;
  extractionCheckedOutByCurrentUser?: boolean;
  isPdfValidated: boolean;
  validationNotes: string[];
  notes: number;
};

export type Decision = {
  id: string;
  projectId: string;
  studyId: string;
  reportId?: string;
  stage: Stage;
  userId: string;
  userName: string;
  decisionValue: DecisionValue;
  exclusionReasonId?: string;
  note?: string;
  isCurrent: boolean;
  supersedesDecisionId?: string;
  createdAt: string;
};

export type ProjectWorkflowConflict = {
  id: string;
  projectId: string;
  stage: "title_abstract" | "full_text";
  title: string;
  subtitle: string;
  label: string;
  decisions: Decision[];
  studyId?: string;
  reportId?: string;
};

export type ExtractionFieldType = "multiline_text" | "single_choice" | "multiple_choice";

export type ExtractionTemplateField = {
  id: string;
  title: string;
  type: ExtractionFieldType;
  options: string[];
};

export type ExtractionTemplate = {
  id: string;
  projectId: string;
  title: string;
  version: number;
  fields: ExtractionTemplateField[];
  createdByUserId: string;
  createdByUserName: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
};

export type ExtractionResponseValue = string | string[];

export type ExtractionResponse = {
  id: string;
  projectId: string;
  studyId: string;
  reportId: string;
  templateId: string;
  userId: string;
  userName: string;
  values: Record<string, ExtractionResponseValue>;
  isSubmitted: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
};

export type ExtractionConsensusStatus = "pending" | "finalized";

export type ExtractionConsensus = {
  id: string;
  projectId: string;
  studyId: string;
  reportId: string;
  templateId: string;
  requiredVotes: number;
  reviewerResponseIds: string[];
  sourceFingerprint: string;
  flaggedFieldIds: string[];
  resolvedValues: Record<string, ExtractionResponseValue>;
  status: ExtractionConsensusStatus;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  finalizedByUserId?: string;
  finalizedByUserName?: string;
};

export type DedupCandidate = {
  id: string;
  recordA: Study;
  recordB: Study;
  score: number;
  method: string;
  status: "pending" | "confirmed" | "rejected" | "auto_confirmed";
  explanation: {
    title: number;
    author: number;
    year: number;
    doi: string;
    notes: string[];
  };
};

export type PrismaCounts = {
  recordsIdentifiedDatabase: number;
  recordsIdentifiedRegisters: number;
  recordsIdentifiedOther: number;
  duplicateRecordsRemoved: number;
  automationRemoved: number;
  removedOtherReasons: number;
  recordsScreened: number;
  recordsExcluded: number;
  reportsSought: number;
  reportsNotRetrieved: number;
  reportsAssessed: number;
  reportsExcludedWithReasons: Record<string, number>;
  studiesIncluded: number;
  studiesExtracted: number;
  studiesIncludedMetaAnalysis: number;
};

export type HighlightRule = {
  term: string;
  type: "include" | "exclude" | "neutral";
};

export type WorkflowEvent = {
  id: string;
  actor: string;
  action: string;
  entity: string;
  time: string;
};

export const projectSummary: ProjectSummary = {
  id: "demo-review",
  title: "Collaborative Evidence Synthesis Workflow Benchmark",
  organization: "Methods Sandbox",
  protocolId: "PROTO-2026-0001",
  blindMode: true,
  abstractRequiredVotes: 2,
  fullTextRequiredVotes: 2,
  extractionRequiredVotes: 2,
  exclusionReasons: [
    "Wrong population",
    "Wrong intervention",
    "Wrong comparator",
    "Wrong outcome",
    "Wrong study design",
    "Full text unavailable"
  ],
  maybePolicy: "advance_to_full_text",
  requireSequentialPhases: true,
  reviewers: 8,
  lastEvent: "PRISMA counts recalculated 7 minutes ago"
};

export const reviewProjects: ReviewProject[] = [
  {
    ...projectSummary,
    description: "Evaluate reproducibility and workflow quality across collaborative evidence synthesis studies.",
    searchStrategies: "",
    status: "active",
    stage: "screening",
    ownerId: "user-rivera",
    ownerIds: ["user-rivera"],
    memberIds: ["user-rivera", "user-chen", "user-patel", "user-okafor"],
    createdAt: "2026-05-20",
    updatedAt: "2026-05-27",
    dueDate: "15-07-2026",
    recordsTotal: 1192,
    recordsScreened: 924,
    conflicts: 5,
    studiesIncluded: 121
  }
];

export const screeningStudies: Study[] = [
  {
    id: "study-001",
    title: "Asynchronous task hand-off with structured reviewer prompts in distributed teams",
    abstract:
      "Teams were randomized to structured hand-off prompts or standard unstructured notes. The intervention improved completion consistency and reduced rework in multi-reviewer workflows.",
    authors: ["Nolan P", "Rivera M", "Sharma T"],
    journal: "Journal of Collaborative Systems",
    year: 2025,
    doi: "10.5555/jcs.2025.0142",
    source: "IEEE Xplore",
    stage: "title_abstract",
    keywords: ["handoff", "asynchronous", "workflow"]
  },
  {
    id: "study-002",
    title: "Automated reviewer coaching for consistency in document screening: a pragmatic cluster trial",
    abstract:
      "Project teams were allocated to an automated coaching pathway or usual onboarding. Teams using coaching reported higher screening agreement and faster onboarding with shared dashboards.",
    authors: ["Ibrahim H", "Kwon J", "Foster L", "Bell G"],
    journal: "Implementation Practice Quarterly",
    year: 2024,
    doi: "10.5555/ipq.2024.0761",
    source: "Scopus",
    stage: "title_abstract",
    keywords: ["coaching", "screening", "agreement"]
  },
  {
    id: "study-003",
    title: "Protocol for a dashboard-based prioritization intervention in large review queues",
    abstract:
      "This protocol describes a planned randomized feasibility study. No operational outcomes are reported yet. The intervention will combine queue scoring with weekly reviewer calibration.",
    authors: ["Larsson E", "De Luca F"],
    journal: "Trials Protocols",
    year: 2023,
    doi: "10.5555/trials.2023.2031",
    source: "Scopus",
    stage: "title_abstract",
    keywords: ["protocol", "prioritization", "queue"]
  },
  {
    id: "study-004",
    title: "Interactive reviewer training after major workflow migration",
    abstract:
      "Teams used a tablet-based training module with asynchronous mentor review. The comparative cohort showed fewer process regressions at 90 days, with some attrition in later phases.",
    authors: ["McArthur L", "Nguyen P", "Osei K"],
    journal: "Operations Learning Review",
    year: 2022,
    doi: "10.5555/olr.2022.088",
    source: "IEEE Xplore",
    stage: "title_abstract",
    keywords: ["training", "migration", "regression"]
  },
  {
    id: "study-005",
    title: "Consumer productivity tools and team self-management: cross-sectional survey",
    abstract:
      "The survey explored associations between commercial productivity tool use and collaboration behaviors. Because the design was cross-sectional and lacked an intervention, the paper may not satisfy protocol eligibility criteria.",
    authors: ["Ramos V", "Archer K", "Singh N"],
    journal: "Digital Work Practices",
    year: 2024,
    doi: "10.5555/dwp.57110",
    source: "Manual",
    stage: "title_abstract",
    keywords: ["cross-sectional", "productivity", "tooling"]
  }
];

export const reportQueue: Report[] = [
  {
    id: "report-001",
    projectId: "demo-review",
    studyId: "study-001",
    title: "Asynchronous task hand-off with structured reviewer prompts in distributed teams",
    citation: "Nolan P, Rivera M, Sharma T. Journal of Collaborative Systems. 2025;18(2):101-114.",
    retrievalStatus: "retrieved",
    pdfName: "nolan-2025-handoff-prompts.pdf",
    fileName: "nolan-2025-handoff-prompts.pdf",
    mimeType: "application/pdf",
    size: 3145728,
    checksum: "demo-report-001",
    storagePath: "demo/report-001.pdf",
    isPdfValidated: true,
    validationNotes: [],
    notes: 4
  },
  {
    id: "report-002",
    projectId: "demo-review",
    studyId: "study-004",
    title: "Interactive reviewer training after major workflow migration",
    citation: "McArthur L, Nguyen P, Osei K. Operations Learning Review. 2022;41(7):619-631.",
    retrievalStatus: "sought",
    pdfName: "mcarthur-2022-workflow-migration.pdf",
    fileName: "mcarthur-2022-workflow-migration.pdf",
    mimeType: "application/pdf",
    size: 0,
    checksum: "",
    storagePath: "",
    isPdfValidated: false,
    validationNotes: ["PDF retrieval is still pending."],
    notes: 1
  }
];

export const initialDecisions: Decision[] = [
  {
    id: "dec-001",
    projectId: projectSummary.id,
    studyId: "study-001",
    stage: "title_abstract",
    userId: "user-rivera",
    userName: "M. Rivera",
    decisionValue: "include",
    isCurrent: true,
    createdAt: "2026-05-26 10:22"
  },
  {
    id: "dec-002",
    projectId: projectSummary.id,
    studyId: "study-002",
    stage: "title_abstract",
    userId: "user-chen",
    userName: "A. Chen",
    decisionValue: "include",
    isCurrent: true,
    createdAt: "2026-05-26 11:07"
  },
  {
    id: "dec-003",
    projectId: projectSummary.id,
    studyId: "study-005",
    stage: "title_abstract",
    userId: "user-patel",
    userName: "S. Patel",
    decisionValue: "exclude",
    note: "Wrong study design",
    isCurrent: true,
    createdAt: "2026-05-26 12:18"
  }
];

export const dedupCandidates: DedupCandidate[] = [
  {
    id: "dup-001",
    score: 0.962,
    method: "Title fingerprint + first author + year",
    status: "pending",
    recordA: screeningStudies[0],
    recordB: {
      ...screeningStudies[0],
      id: "record-duplicate-001",
      source: "Scopus",
      title: "Asynchronous reviewer handoff supported by structured prompts in distributed teams",
      doi: "https://doi.org/10.5555/jcs.2025.0142"
    },
    explanation: {
      title: 0.94,
      author: 1,
      year: 1,
      doi: "Normalized DOI match",
      notes: ["Same first author", "Same year", "Journal abbreviation differs"]
    }
  },
  {
    id: "dup-002",
    score: 0.887,
    method: "Fuzzy title + author similarity",
    status: "pending",
    recordA: screeningStudies[4],
    recordB: {
      ...screeningStudies[4],
      id: "record-duplicate-002",
      source: "Scopus",
      title: "Commercial productivity applications for team self-management",
      doi: ""
    },
    explanation: {
      title: 0.82,
      author: 0.75,
      year: 1,
      doi: "No DOI on candidate record",
      notes: ["Possible conference-to-journal pair", "Manual check recommended"]
    }
  }
];

export const prismaCounts: PrismaCounts = {
  recordsIdentifiedDatabase: 982,
  recordsIdentifiedRegisters: 126,
  recordsIdentifiedOther: 84,
  duplicateRecordsRemoved: 214,
  automationRemoved: 38,
  removedOtherReasons: 16,
  recordsScreened: 924,
  recordsExcluded: 632,
  reportsSought: 292,
  reportsNotRetrieved: 21,
  reportsAssessed: 271,
  reportsExcludedWithReasons: {
    "Wrong domain": 42,
    "Wrong method": 31,
    "Wrong comparator": 28,
    "Wrong outcome": 19,
    "Wrong publication type": 18,
    "Full text unavailable": 12
  },
  studiesIncluded: 121,
  studiesExtracted: 46,
  studiesIncludedMetaAnalysis: 46
};

export const projectCounts: Record<string, PrismaCounts> = {
  "demo-review": prismaCounts
};

export const highlightRules: HighlightRule[] = [
  { term: "randomized", type: "include" },
  { term: "controlled", type: "include" },
  { term: "benchmark", type: "include" },
  { term: "baseline", type: "neutral" },
  { term: "protocol", type: "exclude" },
  { term: "editorial", type: "exclude" }
];

export const initialWorkflowEvents: WorkflowEvent[] = [
  {
    id: "evt-001",
    actor: "System",
    action: "Recalculated PRISMA export preview",
    entity: "Export engine",
    time: "7 min ago"
  },
  {
    id: "evt-002",
    actor: "A. Chen",
    action: "Confirmed duplicate group",
    entity: "dup-042",
    time: "22 min ago"
  },
  {
    id: "evt-003",
    actor: "S. Patel",
    action: "Resolved full-text conflict",
    entity: "report-088",
    time: "44 min ago"
  },
  {
    id: "evt-004",
    actor: "M. Rivera",
    action: "Updated exclusion reason taxonomy",
    entity: "Project settings",
    time: "1 hr ago"
  }
];

export const qualityDomains = [
  {
    domain: "Randomization process",
    judgement: "Low risk",
    support: "Allocation sequence generated centrally."
  },
  {
    domain: "Deviations from intended intervention",
    judgement: "Some concerns",
    support: "Reviewers were not masked, but outcomes were objectively logged."
  },
  {
    domain: "Missing outcome data",
    judgement: "High risk",
    support: "Attrition reached 24 percent in the intervention arm."
  },
  {
    domain: "Outcome measurement",
    judgement: "Low risk",
    support: "Validated electronic device and prespecified endpoint."
  }
];

export const roleRows = [
  {
    role: "Owner",
    members: 1,
    capabilities: "All project controls, billing, deletion"
  },
  {
    role: "Admin",
    members: 2,
    capabilities: "Imports, deduplication, settings, exports"
  },
  {
    role: "Reviewer",
    members: 5,
    capabilities: "Assigned screening, extraction, quality tasks"
  },
  {
    role: "Adjudicator",
    members: 2,
    capabilities: "Conflict queues and final decisions"
  },
  {
    role: "Viewer",
    members: 3,
    capabilities: "Read-only access under blind-mode rules"
  }
];
