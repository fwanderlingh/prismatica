import { jsonError, jsonOk, requireSessionUserId } from "@/lib/serverRoute";
import { ApiError, markImportBatchReviewedForUser } from "@/lib/serverStore";

export async function POST(request: Request, context: { params: Promise<{ projectId: string; importId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, importId } = await context.params;
    const rawBody = await request.text();
    let body: Record<string, unknown> = {};
    if (rawBody.trim()) {
      try {
        const parsedBody = JSON.parse(rawBody) as unknown;
        body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody as Record<string, unknown> : {};
      } catch {
        throw new ApiError("Request body must be valid JSON.");
      }
    }
    return jsonOk(
      markImportBatchReviewedForUser(userId, projectId, importId, {
        sourceName: typeof body.sourceName === "string" ? body.sourceName : undefined,
        filename: typeof body.filename === "string" ? body.filename : undefined
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
