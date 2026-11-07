"use client";

import { MessageSquare, Save } from "lucide-react";
import { useEffect, useId, useSyncExternalStore } from "react";
import type { AppUser, Study } from "@/lib/prismaData";

export type SavePaperComment = (projectId: string, studyId: string, comment: string) => Promise<void>;

type PaperCommentsProps = {
  projectId: string;
  study: Study;
  currentUser: AppUser;
  onSaveComment: SavePaperComment;
};

type CommentDraft = {
  text: string;
  baseline: string;
  sourceText: string;
  isSaving: boolean;
  error: string;
  notice: string;
};

// Keep in-progress comments available when moving between papers or review stages.
const commentDrafts = new Map<string, CommentDraft>();
const draftListeners = new Set<() => void>();

function subscribeToDrafts(listener: () => void) {
  draftListeners.add(listener);
  return () => { draftListeners.delete(listener); };
}

function updateDraft(key: string, draft: CommentDraft) {
  commentDrafts.set(key, draft);
  for (const listener of draftListeners) {
    listener();
  }
}

function initialDraft(text: string): CommentDraft {
  return { text, baseline: text, sourceText: text, isSaving: false, error: "", notice: "" };
}

function commentDate(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  try {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: timezone || "UTC" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
  }
}

export function PaperComments({ projectId, study, currentUser, onSaveComment }: PaperCommentsProps) {
  const id = useId();
  const draftKey = JSON.stringify([projectId, study.id, currentUser.id]);
  const ownComment = study.comments?.find((comment) => comment.userId === currentUser.id);
  const otherComments = study.comments?.filter((comment) => comment.userId !== currentUser.id && comment.text.trim()) ?? [];
  const savedText = ownComment?.text ?? "";
  const storedDraft = useSyncExternalStore(
    subscribeToDrafts,
    () => commentDrafts.get(draftKey) ?? null,
    () => null
  );
  const draft = storedDraft ?? initialDraft(savedText);
  const isDirty = draft.text.trim() !== draft.baseline;
  const ownUpdatedAt = ownComment?.updatedAt || ownComment?.createdAt;
  const ownDate = ownUpdatedAt ? commentDate(ownUpdatedAt, currentUser.timezone) : "";

  useEffect(() => {
    const currentDraft = commentDrafts.get(draftKey);
    if (!currentDraft || currentDraft.sourceText === savedText) {
      return;
    }
    const wasUnchanged = currentDraft.text.trim() === currentDraft.baseline;
    updateDraft(draftKey, {
      ...currentDraft,
      text: wasUnchanged ? savedText : currentDraft.text,
      baseline: savedText,
      sourceText: savedText,
      notice: ""
    });
  }, [draftKey, savedText]);

  async function saveComment() {
    const currentDraft = commentDrafts.get(draftKey) ?? initialDraft(savedText);
    const text = currentDraft.text.trim();
    if (currentDraft.isSaving || text === currentDraft.baseline) {
      return;
    }
    updateDraft(draftKey, { ...currentDraft, isSaving: true, error: "", notice: "" });
    try {
      await onSaveComment(projectId, study.id, text);
      const latestDraft = commentDrafts.get(draftKey) ?? currentDraft;
      updateDraft(draftKey, {
        ...latestDraft,
        text: latestDraft.text.trim() === text ? text : latestDraft.text,
        baseline: text,
        sourceText: text,
        isSaving: false,
        error: "",
        notice: text ? "Comment saved." : "Comment removed."
      });
    } catch (saveError) {
      const latestDraft = commentDrafts.get(draftKey) ?? currentDraft;
      updateDraft(draftKey, {
        ...latestDraft,
        isSaving: false,
        error: saveError instanceof Error ? saveError.message : "Could not save your comment. Your draft is still available.",
        notice: ""
      });
    }
  }

  return (
    <section className="paperComments" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}><MessageSquare size={18} aria-hidden="true" /> Paper comments</h3>
      <p className="paperCommentsHint" id={`${id}-hint`}>Comments are shared with project reviewers across review stages.</p>

      <div className="paperCommentEditor" aria-busy={draft.isSaving}>
        <div className="paperCommentMeta">
          <label htmlFor={`${id}-comment`}>Your comment <span>({currentUser.name})</span></label>
          {ownUpdatedAt && ownDate ? <time dateTime={ownUpdatedAt}>Updated {ownDate}</time> : null}
        </div>
        <textarea
          id={`${id}-comment`}
          value={draft.text}
          maxLength={10000}
          rows={4}
          placeholder="Add a comment for the other reviewers…"
          aria-describedby={`${id}-hint${draft.error ? ` ${id}-error` : ""}`}
          disabled={draft.isSaving}
          onChange={(event) => updateDraft(draftKey, { ...draft, text: event.target.value, error: "", notice: "" })}
        />
        <div className="paperCommentActions">
          <button type="button" className="primaryButton" disabled={draft.isSaving || !isDirty} onClick={() => { void saveComment(); }}>
            {draft.isSaving ? <span className="inlineSpinner" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            {draft.isSaving ? "Saving…" : "Save comment"}
          </button>
          <span className="paperCommentStatus" role="status" aria-live="polite">
            {draft.isSaving ? "Saving your comment…" : isDirty ? "Unsaved comment" : draft.notice}
          </span>
        </div>
        {draft.baseline ? <p className="paperCommentHelp">Clear the text and save to remove your comment.</p> : null}
        {draft.error ? <p className="paperCommentError" id={`${id}-error`} role="alert">{draft.error}</p> : null}
      </div>

      {otherComments.length ? (
        <div className="paperCommentList" aria-label="Other reviewers’ comments">
          {otherComments.map((comment) => {
            const updatedAt = comment.updatedAt || comment.createdAt;
            const date = commentDate(updatedAt, currentUser.timezone);
            return (
              <article className="paperComment" key={comment.userId}>
                <div className="paperCommentMeta">
                  <h4>{comment.userName}</h4>
                  {date ? <time dateTime={updatedAt}>Updated {date}</time> : null}
                </div>
                <p className="paperCommentText">{comment.text}</p>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
