import { useState } from "react";
import type { AppUser } from "@/lib/prismaData";

export type NewProjectForm = {
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
  requireSequentialPhases: boolean;
  memberIds: string[];
};

const emptyNewProjectForm: NewProjectForm = {
  title: "",
  organization: "Evidence Methods Unit",
  protocolId: "",
  description: "",
  searchStrategies: "",
  dueDate: "",
  blindMode: true,
  abstractRequiredVotes: 2,
  fullTextRequiredVotes: 2,
  extractionRequiredVotes: 2,
  maybePolicy: "advance_to_full_text",
  requireSequentialPhases: true,
  memberIds: []
};

type NewProjectUserContext = Pick<AppUser, "id" | "organization">;

export function useNewProjectState(currentUser: NewProjectUserContext) {
  const [newProjectForm, setNewProjectForm] = useState<NewProjectForm>({
    ...emptyNewProjectForm,
    memberIds: []
  });

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

  function syncNewProjectUserContext(user: NewProjectUserContext) {
    setNewProjectForm((previous) => ({
      ...previous,
      organization: user.organization,
      memberIds: Array.from(new Set([user.id, ...previous.memberIds]))
    }));
  }

  function resetNewProjectForm(user: NewProjectUserContext) {
    setNewProjectForm({
      ...emptyNewProjectForm,
      organization: user.organization,
      memberIds: [user.id]
    });
  }

  const dueDate = newProjectForm.dueDate.trim();
  const hasTitle = newProjectForm.title.trim().length > 0;
  const hasValidDueDate = dueDate.length === 0 || isEuDate(dueDate);
  const canCreate = hasTitle && hasValidDueDate;
  const creationStatus = canCreate ? "Ready to create" : hasTitle ? "Use dd-mm-yyyy if you add a due date" : "Review title required";
  const creationSummary = "New reviews start as drafts with zero imports, open settings, and the selected users as members.";

  return {
    newProjectForm,
    canCreate,
    creationStatus,
    creationSummary,
    updateNewProjectForm,
    toggleProjectMember,
    syncNewProjectUserContext,
    resetNewProjectForm
  };
}

function isEuDate(value: string) {
  return /^\d{2}-\d{2}-\d{4}$/.test(value);
}
