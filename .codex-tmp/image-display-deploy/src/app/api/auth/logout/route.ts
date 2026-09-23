import { deleteSession } from "@/lib/session";

export async function POST() {
  await deleteSession();
  return Response.json({ ok: true });
}
