import { jsonError, requireSessionUserId } from "@/lib/serverRoute";
import { getConsensusExtractionCsvForUser } from "@/lib/serverStore";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { projectId } = await context.params;
    const exported = getConsensusExtractionCsvForUser(userId, projectId);

    return new Response(exported.csv, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${exported.fileName.replace(/["\r\n]/g, "_")}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
