import type {
  AppUser,
  Decision,
  DedupCandidate,
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
  users: AppUser[];
  projects: ReviewProject[];
  imports: ImportBatch[];
  studies: Study[];
  reports: Report[];
  extractionTemplates: ExtractionTemplate[];
  extractionResponses: ExtractionResponse[];
  decisions: Decision[];
  events: WorkflowEvent[];
  dedupCandidates: DedupCandidate[];
};

export type AppMutationPayload = AppStatePayload & {
  selectedProjectId?: string;
  message?: string;
  temporaryPassword?: string;
  decisionAction?: DecisionActionPayload;
};

export type ApiErrorPayload = {
  error: string;
};
