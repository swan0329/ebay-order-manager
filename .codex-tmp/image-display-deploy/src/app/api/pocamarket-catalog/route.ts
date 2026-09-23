import { after } from "next/server";
import { z } from "zod";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { getCatalogStates, requestCatalogScan, setCatalogEnabled, continueCatalogScan } from "@/lib/pocamarket-catalog";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (error instanceof z.ZodError) return Response.json({ error: "자동 수집 설정을 확인해 주세요." }, { status: 422 });
  console.error("Catalog request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "신상품 수집 상태를 처리하지 못했습니다." }, { status: 500 });
}
export async function GET() {
  try { await requireApiUser(); return Response.json({ states: await getCatalogStates() }); }
  catch (error) { return errorResponse(error); }
}
export async function POST() {
  try {
    await requireApiUser(); await requestCatalogScan();
    after(() => continueCatalogScan());
    return Response.json({ queued: true }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    await requireApiUser();
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await request.json());
    await setCatalogEnabled(enabled);
    if (enabled) after(() => continueCatalogScan());
    return Response.json({ states: await getCatalogStates() });
  } catch (error) { return errorResponse(error); }
}
