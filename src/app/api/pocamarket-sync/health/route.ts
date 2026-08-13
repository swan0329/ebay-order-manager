import { jsonError } from "@/lib/http";
import {
  fetchPocamarketProductState,
  loadPocamarketApiConfig,
  PocamarketSchemaError,
} from "@/lib/pocamarket-api-collector";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 60;

export async function POST() {
  try {
    await requireApiUser();
    const candidates = await prisma.product.findMany({
      where: { pocamarketId: { not: null } },
      orderBy: { pocamarketSyncedAt: { sort: "desc", nulls: "last" } },
      take: 50,
      select: { pocamarketId: true },
    });
    const sample = candidates.find((product) =>
      /^\d+$/.test(product.pocamarketId ?? ""),
    );
    if (!sample?.pocamarketId) {
      return jsonError("점검할 유효한 포카마켓 상품번호가 없습니다.", 422);
    }
    const startedAt = Date.now();
    const state = await fetchPocamarketProductState(
      sample.pocamarketId,
      loadPocamarketApiConfig(),
    );
    return Response.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      adapter: state.adapter ?? "UNKNOWN",
      sampleResult: {
        isSoldOut: state.isSoldOut,
        hasPrice: state.isSoldOut || state.price > 0,
        availableCountDetected: state.availableCount !== null,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    const schemaChanged = error instanceof PocamarketSchemaError;
    return Response.json(
      {
        ok: false,
        schemaChanged,
        error:
          error instanceof Error
            ? error.message
            : "포카마켓 API 연결을 확인하지 못했습니다.",
      },
      { status: schemaChanged ? 502 : 503 },
    );
  }
}
