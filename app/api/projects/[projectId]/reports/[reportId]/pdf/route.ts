import { jsonError, jsonOk, readJsonBody, requireSessionUserId } from "@/lib/serverRoute";
import { uploadReportPdfForUser } from "@/lib/serverStore";

export async function POST(request: Request, context: { params: Promise<{ projectId: string; reportId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId, reportId } = await context.params;
    const body = await readJsonBody(request);
    return jsonOk(
      uploadReportPdfForUser(userId, projectId, reportId, {
        fileName: String(body.fileName ?? ""),
        mimeType: String(body.mimeType ?? ""),
        size: typeof body.size === "number" ? body.size : undefined,
        contentBase64: String(body.contentBase64 ?? "")
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
