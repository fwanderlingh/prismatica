"use client";

import { Check, Pencil, X } from "lucide-react";
import { createContext, useContext, useState, type FormEvent } from "react";
import type { Study } from "@/lib/prismaData";

export type SaveStudyDoi = (study: Study, doi: string) => Promise<void>;

export const StudyDoiEditContext = createContext<SaveStudyDoi | null>(null);

export function EditableDoiPill({ study, label }: { study: Study; label: string }) {
  const saveStudyDoi = useContext(StudyDoiEditContext);
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const normalizedDoi = study.doi.trim().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");
  const canEdit = Boolean(saveStudyDoi && study.importBatchId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    const doi = value.trim();
    if (!saveStudyDoi || isSaving) {
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await saveStudyDoi(study, doi);
      setIsEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the DOI.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <form className="doiEditForm" onSubmit={submit} aria-busy={isSaving}>
        <input
          autoFocus
          aria-label="DOI"
          placeholder="10.xxxx/xxxxx (empty clears)"
          value={value}
          disabled={isSaving}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setIsEditing(false);
            }
          }}
        />
        <button type="submit" className="doiEditButton" aria-label="Save DOI" title="Save DOI" disabled={isSaving}>
          {isSaving ? <span className="inlineSpinner" aria-hidden="true" /> : <Check size={14} />}
        </button>
        <button type="button" className="doiEditButton" aria-label="Cancel" title="Cancel" disabled={isSaving} onClick={() => setIsEditing(false)}>
          <X size={14} />
        </button>
        {error ? <span className="doiEditError" role="alert">{error}</span> : null}
      </form>
    );
  }

  return (
    <span className="doiLinkPill doiLinkPillMissing">
      {normalizedDoi ? (
        <a href={`https://doi.org/${normalizedDoi}`} target="_blank" rel="noreferrer">{label}</a>
      ) : (
        label
      )}
      {canEdit ? (
        <button
          type="button"
          className="doiEditButton"
          aria-label={normalizedDoi ? "Edit DOI" : "Add DOI"}
          title={normalizedDoi ? "Edit DOI" : "Add DOI"}
          onClick={() => {
            setValue(study.doi);
            setError("");
            setIsEditing(true);
          }}
        >
          <Pencil size={13} />
        </button>
      ) : null}
    </span>
  );
}
