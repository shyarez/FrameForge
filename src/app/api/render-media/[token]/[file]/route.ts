import { isVideoKind, readAsset } from "@/lib/server/assets";
import { errorResponse } from "@/lib/server/http";
import { rangeResponse } from "@/lib/server/range";
import { lookupRenderMedia } from "@/lib/server/renderMedia";
import { StorageError } from "@/lib/server/storage";

type Ctx = { params: Promise<{ token: string; file: string }> };

/** Video bytes for the export browser, authorised by a short-lived grant instead of a session. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { token, file } = await params;
    const grant = lookupRenderMedia(token);
    if (!grant || !isVideoKind(file.split(".").pop() ?? "")) throw new StorageError("Not found", 404);
    const { data, mime } = await readAsset(grant.owner, grant.projectId, file);
    return rangeResponse(req, data, { "Content-Type": mime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  } catch (err) {
    return errorResponse(err);
  }
}
