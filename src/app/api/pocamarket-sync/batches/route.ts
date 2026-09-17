import { jsonError } from "@/lib/http";
import { after } from "next/server";
import { z } from "zod";
import {
  createPocamarketSyncBatch,
  processPocamarketSyncBatch,
  MAX_POCAMARKET_BATCH_SIZE,
} from "@/lib/pocamarket-sync";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";

export const maxDuration = 60;

const createBatchSchema = z
  .object({
    limit: z.number().int().min(1).max(MAX_POCAMARKET_BATCH_SIZE).optional(),
    scope: z.enum(["all", "unsynced"]).optional(),
    group: z.enum(["BTS", "Stray Kids"]).optional(),
  })
  // 개수 지정이 없으면 "확인 필요만"(unsynced) 요청일 때만 허용한다.
  .refine((value) => value.limit !== undefined || value.scope === "unsynced", {
    message: "최신화 개수를 입력해 주세요.",
  });

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const batchId = new URL(request.url).searchParams.get("batchId");
    if (batchId && batchId.length > 100) return jsonError("작업 ID를 확인해 주세요.", 422);
    const batches = await prisma.pocamarketSyncBatch.findMany({
      where: { userId: user.id, ...(batchId ? { id: batchId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: {
        items: {
          orderBy: { productNumber: "asc" },
          include: { product: { select: { productName: true } } },
        },
      },
    });
    return Response.json({
      batches,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    return jsonError(error instanceof Error ? error.message : "조회하지 못했습니다.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = createBatchSchema.parse(await request.json());
    const batch = await createPocamarketSyncBatch(user.id, input.limit, {
      onlyUnsynced: input.scope === "unsynced",
      group: input.group,
    });
    after(async () => {
      try { await processPocamarketSyncBatch(batch.id); }
      catch { console.error("Pocamarket initial worker will resume on schedule"); }
    });
    return Response.json({ batch }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return jsonError("Unauthorized", 401);
    if (error instanceof z.ZodError) {
      return jsonError(
        `최신화 개수는 1개 이상 ${MAX_POCAMARKET_BATCH_SIZE.toLocaleString()}개 이하로 입력해 주세요.`,
        422,
      );
    }
    return jsonError(error instanceof Error ? error.message : "작업을 만들지 못했습니다.", 422);
  }
}
