PRISMATICA
==========

## To DO:

Full Text has no actionable workflow right now:
1. The full-text queue is hardcoded to demo data only, not derived from real screening results: prisma-review-app.tsx.
2. Screening decisions are saved, but they only write title/abstract decisions and events; they do not create report records or advance studies into a persisted full-text queue: serverStore.ts.
3. The app state payload has no reports collection at all, so the UI has nothing persistent to bind full-text actions to: apiTypes.ts.
4. In the full-text view, include/exclude/retrieval controls are local component state only (`setFullTextDecision`, `setRetrievalStatus`), not persisted through an API route.

About PDF checks:
1. There is no PDF upload/validation pipeline today.
2. Existing file import only accepts RIS/BibTeX citation files, not PDFs: prisma-review-app.tsx.
3. The “PDF pane” is currently a UI mock tied to static report metadata, not a stored file object.

A practical implementation plan:

1. Data model and state
    1. Add a persistent Report entity to server state (`reports` array) with fields:
        1. id, projectId, studyId
        2. retrievalStatus (`not_sought|sought|retrieved|not_retrieved`)
        3. pdf metadata (`fileName`, `mimeType`, `size`, `checksum`, `storagePath`)
        4. extraction flags (`isPdfValidated`, `validationNotes`)
    2. Extend app payload types to include reports.

2. Screening → Full Text transition
    1. On screening state transition to “advance_full_text”, upsert a report for that study.
    2. Move study stage from title_abstract to full_text.
    3. Make full-text queue use persisted reports (not `reportQueue` constant).

3. Full-text APIs
    1. Add routes:
        1. `GET /api/projects/:projectId/reports`
        2. `PATCH /api/projects/:projectId/reports/:reportId` (retrieval status, include/exclude, reason)
        3. `POST /api/projects/:projectId/reports/:reportId/pdf` (upload)
        4. `POST /api/projects/:projectId/reports/:reportId/validate` (run checks)
    2. Persist decisions at full-text stage with `reportId` linkage.

4. PDF checks (minimum viable)
    1. On upload, validate:
        1. MIME is PDF
        2. max size
        3. readable header (`%PDF-`)
        4. checksum and duplicate detection
    2. On “study included”, enforce:
        1. retrievalStatus must be `retrieved`
        2. at least one validated PDF attached
    3. Show blocking validation message in full-text panel if missing.

5. UI updates
    1. Replace `projectReportQueue` with report data from payload.
    2. Add “Upload PDF” in full-text panel (per report).
    3. Add “Validation status” chip:
        1. Missing PDF
        2. Uploaded, not validated
        3. Validated
    4. Disable/guard “Include” until PDF requirement passes (configurable per project).

6. Audit and compliance
    1. Append events for:
        1. report created from screening
        2. PDF uploaded
        3. PDF validation result
        4. full-text include/exclude and reason
    2. Surface in existing Audit Trail panel.

7. Rollout strategy
    1. Phase 1: persist reports + full-text decisions (no hard PDF requirement yet).
    2. Phase 2: add upload + validation checks.
    3. Phase 3: enforce “included requires validated PDF” behind a project setting.

