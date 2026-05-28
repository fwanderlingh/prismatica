import type { DecisionValue, MaybePolicy, Stage } from "./workflow";

export type ViewKey =
  | "dashboard"
  | "projectDashboard"
  | "imports"
  | "dedup"
  | "screening"
  | "fullText"
  | "extraction"
  | "risk"
  | "exports"
  | "settings"
  | "newProject"
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
};

export type ProjectSummary = {
  id: string;
  title: string;
  organization: string;
  protocolId: string;
  blindMode: boolean;
  abstractRequiredVotes: number;
  fullTextRequiredVotes: number;
  maybePolicy: MaybePolicy;
  reviewers: number;
  lastEvent: string;
};

export type ReviewProject = ProjectSummary & {
  description: string;
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
  uploadedBy: string;
  uploadedAt: string;
};

export type Study = {
  id: string;
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
  keywords: string[];
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
  uploadedByUserId?: string;
  uploadedByUserName?: string;
  fullTextStatus?: string;
  fullTextStatusLabel?: string;
  fullTextVoteCount?: number;
  fullTextRequiredVotes?: number;
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
  title: "Digital Health Interventions for Chronic Disease Self-Management",
  organization: "Evidence Methods Unit",
  protocolId: "PROSPERO CRD42026002184",
  blindMode: true,
  abstractRequiredVotes: 2,
  fullTextRequiredVotes: 2,
  maybePolicy: "advance_to_full_text",
  reviewers: 8,
  lastEvent: "PRISMA counts recalculated 7 minutes ago"
};

export const reviewProjects: ReviewProject[] = [
  {
    ...projectSummary,
    description: "Evaluate randomized and pragmatic trials of digital self-management support for chronic disease.",
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
  },
  {
    id: "maternal-telehealth",
    title: "Telehealth Follow-Up After High-Risk Pregnancy",
    organization: "Community Health Reviews",
    protocolId: "PROSPERO CRD42026004419",
    blindMode: true,
    abstractRequiredVotes: 2,
    fullTextRequiredVotes: 2,
    maybePolicy: "third_vote",
    reviewers: 5,
    lastEvent: "Import batch parsed 2 hours ago",
    description: "Review remote monitoring and telehealth follow-up models after high-risk pregnancy discharge.",
    status: "active",
    stage: "import",
    ownerId: "user-patel",
    ownerIds: ["user-patel"],
    memberIds: ["user-patel", "user-rivera", "user-okafor"],
    createdAt: "2026-05-10",
    updatedAt: "2026-05-27",
    dueDate: "03-08-2026",
    recordsTotal: 684,
    recordsScreened: 138,
    conflicts: 2,
    studiesIncluded: 0
  },
  {
    id: "ai-triage-review",
    title: "AI-Assisted Triage Safety in Emergency Care",
    organization: "Clinical Evidence Lab",
    protocolId: "Draft protocol",
    blindMode: false,
    abstractRequiredVotes: 2,
    fullTextRequiredVotes: 2,
    maybePolicy: "conflict",
    reviewers: 4,
    lastEvent: "Project settings created yesterday",
    description: "Map clinical safety outcomes and implementation factors in AI triage studies.",
    status: "draft",
    stage: "setup",
    ownerId: "user-okafor",
    ownerIds: ["user-okafor"],
    memberIds: ["user-okafor", "user-chen"],
    createdAt: "2026-05-26",
    updatedAt: "2026-05-26",
    dueDate: "12-09-2026",
    recordsTotal: 0,
    recordsScreened: 0,
    conflicts: 0,
    studiesIncluded: 0
  }
];

export const importBatches: ImportBatch[] = [
  {
    id: "imp-001",
    projectId: "demo-review",
    sourceName: "PubMed",
    format: "ris",
    filename: "pubmed_chronic_digital_health.ris",
    status: "committed",
    records: 412,
    parserWarnings: 3,
    uploadedBy: "M. Rivera",
    uploadedAt: "2026-05-22 09:18"
  },
  {
    id: "imp-002",
    projectId: "demo-review",
    sourceName: "Embase",
    format: "ris",
    filename: "embase_export_week20.ris",
    status: "committed",
    records: 536,
    parserWarnings: 11,
    uploadedBy: "A. Chen",
    uploadedAt: "2026-05-22 11:42"
  },
  {
    id: "imp-003",
    projectId: "demo-review",
    sourceName: "ClinicalTrials.gov",
    format: "csv",
    filename: "registry_trials.csv",
    status: "parsed",
    records: 126,
    parserWarnings: 0,
    uploadedBy: "S. Patel",
    uploadedAt: "2026-05-24 14:05"
  },
  {
    id: "imp-004",
    projectId: "demo-review",
    sourceName: "Scopus",
    format: "bib",
    filename: "scopus_citations.bib",
    status: "needs_review",
    records: 332,
    parserWarnings: 24,
    uploadedBy: "M. Rivera",
    uploadedAt: "2026-05-25 16:40"
  }
];

export const screeningStudies: Study[] = [
  {
    id: "study-001",
    title: "Remote blood pressure self-monitoring supported by pharmacist messaging in adults with hypertension",
    abstract:
      "Adults with uncontrolled hypertension were randomized to connected home monitoring with pharmacist messaging or usual care. The intervention improved systolic blood pressure control at six months and increased medication adherence without increasing emergency visits.",
    authors: ["Nolan P", "Rivera M", "Sharma T"],
    journal: "Journal of Digital Therapeutics",
    year: 2025,
    doi: "10.1186/jdt.2025.0142",
    source: "PubMed",
    stage: "title_abstract",
    keywords: ["hypertension", "remote monitoring", "adherence"]
  },
  {
    id: "study-002",
    title: "Mobile coaching for glycemic control in type 2 diabetes: a pragmatic cluster trial",
    abstract:
      "Primary care practices were allocated to a mobile coaching pathway or usual education. Participants receiving coaching reported higher self-efficacy and a moderate reduction in HbA1c after twelve months. The intervention combined automated prompts, nurse review, and shared dashboards.",
    authors: ["Ibrahim H", "Kwon J", "Foster L", "Bell G"],
    journal: "Implementation Science in Health",
    year: 2024,
    doi: "10.1097/ish.2024.0761",
    source: "Embase",
    stage: "title_abstract",
    keywords: ["diabetes", "mobile coaching", "HbA1c"]
  },
  {
    id: "study-003",
    title: "Protocol for a wearable step-count intervention in people with multimorbidity",
    abstract:
      "This protocol describes the design of a planned randomized feasibility study. No participant outcomes are reported. The future intervention will combine wearable activity tracking with weekly digital encouragement.",
    authors: ["Larsson E", "De Luca F"],
    journal: "Trials Protocols",
    year: 2023,
    doi: "10.21203/trials.2023.2031",
    source: "Scopus",
    stage: "title_abstract",
    keywords: ["protocol", "wearable", "multimorbidity"]
  },
  {
    id: "study-004",
    title: "Digital pulmonary rehabilitation after hospitalization for COPD exacerbation",
    abstract:
      "Patients discharged after COPD exacerbation used a tablet-based rehabilitation program with asynchronous therapist review. The comparative cohort showed fewer readmissions at 90 days and better activity tolerance, although attrition was higher in older participants.",
    authors: ["McArthur L", "Nguyen P", "Osei K"],
    journal: "Respiratory Care Research",
    year: 2022,
    doi: "10.1378/rcr.2022.088",
    source: "PubMed",
    stage: "title_abstract",
    keywords: ["COPD", "rehabilitation", "readmission"]
  },
  {
    id: "study-005",
    title: "Consumer sleep apps and self-management of chronic pain: cross-sectional survey",
    abstract:
      "The survey explored associations between commercial sleep app use and pain coping behaviors. Because the design was cross-sectional and lacked a clinical intervention, the paper may not satisfy the review protocol eligibility criteria.",
    authors: ["Ramos V", "Archer K", "Singh N"],
    journal: "JMIR Formative Research",
    year: 2024,
    doi: "10.2196/57110",
    source: "Manual",
    stage: "title_abstract",
    keywords: ["cross-sectional", "pain", "sleep app"]
  }
];

export const reportQueue: Report[] = [
  {
    id: "report-001",
    projectId: "demo-review",
    studyId: "study-001",
    title: "Remote blood pressure self-monitoring supported by pharmacist messaging in adults with hypertension",
    citation: "Nolan P, Rivera M, Sharma T. Journal of Digital Therapeutics. 2025;18(2):101-114.",
    retrievalStatus: "retrieved",
    pdfName: "nolan-2025-hypertension-monitoring.pdf",
    fileName: "nolan-2025-hypertension-monitoring.pdf",
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
    title: "Digital pulmonary rehabilitation after hospitalization for COPD exacerbation",
    citation: "McArthur L, Nguyen P, Osei K. Respiratory Care Research. 2022;41(7):619-631.",
    retrievalStatus: "sought",
    pdfName: "mcarthur-2022-copd-rehab.pdf",
    fileName: "mcarthur-2022-copd-rehab.pdf",
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
      source: "Embase",
      title: "Remote BP self-monitoring supported by pharmacist messaging among adults with hypertension",
      doi: "https://doi.org/10.1186/jdt.2025.0142"
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
      title: "Commercial sleep applications for chronic pain self-management",
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
    "Wrong population": 42,
    "Wrong intervention": 31,
    "Wrong comparator": 28,
    "Wrong outcome": 19,
    "Wrong study design": 18,
    "Full text unavailable": 12
  },
  studiesIncluded: 121,
  studiesIncludedMetaAnalysis: 46
};

export const projectCounts: Record<string, PrismaCounts> = {
  "demo-review": prismaCounts,
  "maternal-telehealth": {
    recordsIdentifiedDatabase: 604,
    recordsIdentifiedRegisters: 42,
    recordsIdentifiedOther: 38,
    duplicateRecordsRemoved: 87,
    automationRemoved: 12,
    removedOtherReasons: 4,
    recordsScreened: 138,
    recordsExcluded: 86,
    reportsSought: 52,
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
    studiesIncluded: 0,
    studiesIncludedMetaAnalysis: 0
  },
  "ai-triage-review": {
    recordsIdentifiedDatabase: 0,
    recordsIdentifiedRegisters: 0,
    recordsIdentifiedOther: 0,
    duplicateRecordsRemoved: 0,
    automationRemoved: 0,
    removedOtherReasons: 0,
    recordsScreened: 0,
    recordsExcluded: 0,
    reportsSought: 0,
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
    studiesIncluded: 0,
    studiesIncludedMetaAnalysis: 0
  }
};

export const highlightRules: HighlightRule[] = [
  { term: "randomized", type: "include" },
  { term: "intervention", type: "include" },
  { term: "self-monitoring", type: "include" },
  { term: "usual care", type: "neutral" },
  { term: "protocol", type: "exclude" },
  { term: "cross-sectional", type: "exclude" }
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

export const extractionRows = [
  {
    field: "Country",
    reviewerA: "United States",
    reviewerB: "USA",
    consensus: "United States",
    status: "normalized"
  },
  {
    field: "Sample size",
    reviewerA: "248",
    reviewerB: "248",
    consensus: "248",
    status: "matched"
  },
  {
    field: "Study design",
    reviewerA: "Cluster RCT",
    reviewerB: "Pragmatic RCT",
    consensus: "Cluster randomized trial",
    status: "resolved"
  },
  {
    field: "Primary outcome",
    reviewerA: "HbA1c at 12 months",
    reviewerB: "Change in HbA1c",
    consensus: "Change in HbA1c at 12 months",
    status: "resolved"
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
    support: "Participants were not masked, but outcomes were objective."
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
