import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { deleteImportStudyForUser, updateImportStudyForUser } from "@/lib/serverStore";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; importId: string; studyId: string }> }
) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, importId, studyId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(
      updateImportStudyForUser(userId, projectId, importId, studyId, {
        title: String(body.title ?? ""),
        abstract: String(body.abstract ?? ""),
        authors: Array.isArray(body.authors) ? body.authors.map(String) : String(body.authors ?? ""),
        journal: String(body.journal ?? ""),
        year: typeof body.year === "number" ? body.year : String(body.year ?? ""),
        doi: String(body.doi ?? ""),
        keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : String(body.keywords ?? "")
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string; importId: string; studyId: string }> }
) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, importId, studyId } = await context.params;
    return jsonOk(deleteImportStudyForUser(userId, projectId, importId, studyId));
  } catch (error) {
    return jsonError(error);
  }
}
