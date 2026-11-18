import { Readable } from "node:stream";
import { createContentDisposition } from "@/lib/contentDisposition";
import { downloadDatabaseBackupForAdmin } from "@/lib/serverStore";
import { jsonError, requireSessionUserId } from "@/lib/serverRoute";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ backupId: string }> }) {
  try {
    const userId = await requireSessionUserId();
    const { backupId } = await context.params;
    const file = downloadDatabaseBackupForAdmin(userId, backupId);
    return new Response(Readable.toWeb(file.stream) as ReadableStream<Uint8Array>, { headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": createContentDisposition("attachment", file.fileName, "prismatica-backup.dump"),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    } });
  } catch (error) { return jsonError(error); }
}
