import type {
  AppUser,
  Decision,
  DedupCandidate,
  ExtractionConsensus,
  ExtractionResponse,
  ExtractionTemplate,
  ImportBatch,
  ProjectWorkflowConflict,
  Report,
  ReviewProject,
  Study,
  WorkflowEvent
} from "./prismaData";

export type DecisionActionPayload = {
  studyId: string;
  previousDecisionId?: string;
};

export type AppStatePayload = {
  currentUser: AppUser;
  authSettings: AppAuthSettings;
  users: AppUser[];
  projects: ReviewProject[];
  imports: ImportBatch[];
  studies: Study[];
  reports: Report[];
  extractionTemplates: ExtractionTemplate[];
  extractionResponses: ExtractionResponse[];
  extractionConsensus: ExtractionConsensus[];
  decisions: Decision[];
  workflowConflicts: ProjectWorkflowConflict[];
  events: WorkflowEvent[];
  dedupCandidates: DedupCandidate[];
};

export type AppAuthSettings = {
  registrationEnabled: boolean;
  screeningCheckoutWindowMinutes: number;
  extractionCheckoutWindowMinutes: number;
};

export type PublicAuthConfigPayload = {
  authSettings: AppAuthSettings;
  captcha: {
    question: string;
    token: string;
  };
};

export type AppMutationPayload = AppStatePayload & {
  selectedProjectId?: string;
  createdUserId?: string;
  message?: string;
  temporaryPassword?: string;
  decisionAction?: DecisionActionPayload;
};

export type ApiErrorPayload = {
  error: string;
};
