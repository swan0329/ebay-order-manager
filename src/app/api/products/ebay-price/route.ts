import { Prisma } from "@/generated/prisma";
import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

// 사람이 직접 정한 eBay 판매가(USD)를 여러 상품에 한 번에 저장한다.
// 포카마켓에 없는 상품을 신규등록 파일에 넣기 위한 경로이며, 이 요청은 가격을
// 저장만 하고 eBay에 게시하지 않는다. 포카마켓 가격이 있는 상품은 신규등록 파일에서
// 계산가가 우선이므로(@/lib/listing-price) 여기 값이 그 상품의 업로드가를 바꾸지 않는다.
const schema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        // null 또는 빈 문자열은 "가격 없음"으로 되돌린다.
        ebayPriceUsd: z.union([z.number(), z.string(), z.null()]),
      }),
    )
    .min(1)
    .max(500),
});

const maxPriceUsd = 100000;

type ParsedPrice =
  | { ok: true; value: Prisma.Decimal | null }
  | { ok: false; message: string };

function parsePriceUsd(value: number | string | null): ParsedPrice {
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: true, value: null };
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { ok: false, message: "0보다 큰 판매가를 입력해 주세요." };
  }
  if (numeric > maxPriceUsd) {
    return {
      ok: false,
      message: `판매가는 ${maxPriceUsd.toLocaleString()} 달러를 넘을 수 없습니다.`,
    };
  }

  return { ok: true, value: new Prisma.Decimal(numeric.toFixed(2)) };
}

export async function POST(request: Request) {
  try {
    await requireApiUser();
    const input = schema.parse(await request.json());
    const updates: Array<{ productId: string; ebayPrice: Prisma.Decimal | null }> = [];
    for (const item of input.items) {
      const parsed = parsePriceUsd(item.ebayPriceUsd);
      if (!parsed.ok) {
        return jsonError(parsed.message, 422);
      }
      updates.push({ productId: item.productId, ebayPrice: parsed.value });
    }

    const ids = [...new Set(updates.map((update) => update.productId))];
    if (ids.length !== updates.length) {
      return jsonError("같은 상품이 여러 번 포함되어 있습니다.", 422);
    }

    const found = await prisma.product.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      return jsonError("일부 상품을 찾을 수 없습니다.", 404);
    }

    await prisma.$transaction(
      updates.map((update) =>
        prisma.product.update({
          where: { id: update.productId },
          data: { ebayPrice: update.ebayPrice },
          select: { id: true },
        }),
      ),
    );

    return Response.json({ ok: true, updated: updates.length });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("저장할 상품과 판매가를 확인해 주세요.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}
