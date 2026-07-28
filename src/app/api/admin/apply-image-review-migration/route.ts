import { timingSafeEqual } from "node:crypto";
import { ensureImageWorkAssignments } from "@/lib/image-work-assignments";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.IMAGE_MIGRATION_TOKEN ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!expected || expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export async function POST(request: Request) {
  if (!authorized(request)) return jsonError("Unauthorized", 401);
  await ensureImageWorkAssignments();
  return Response.json({ ok: true });
}
