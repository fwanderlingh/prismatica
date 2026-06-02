import type {
  AppUser,
  Decision,
  DedupCandidate,
  ExtractionConsensus,
  ExtractionResponse,
  ExtractionTemplate,
  ImportBatch,
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
  events: WorkflowEvent[];
  dedupCandidates: DedupCandidate[];
};

export type AppAuthSettings = {
  registrationEnabled: boolean;
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
