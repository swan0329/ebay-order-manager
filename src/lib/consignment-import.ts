import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const consignmentImportSchema = z.object({
  source: z.string().trim().min(1).max(240),
  dryRun: z.boolean().default(true),
  rows: z.array(z.record(z.string().max(100), z.string().max(20000))).min(1).max(100),
});

export async function verifyConsignmentImport(brand: string, source: string) {
  const products = await prisma.product.findMany({ where: { brand },
    select: { id: true, sku: true, pocamarketId: true, stockQuantity: true, memo: true } });
  const movements = await prisma.inventoryMovement.findMany({
    where: { reason: `위탁 상품대장 가져오기: ${source}`, product: { brand } },
    select: { productId: true, quantity: true, beforeQuantity: true, afterQuantity: true },
  });
  return { products: products.map(p => ({ sku: p.sku, pocamarketId: p.pocamarketId,
    stockQuantity: p.stockQuantity, sourceHash: createHash("sha256").update(p.memo ?? "").digest("hex") })),
    movementCount: movements.length,
    movementQuantity: movements.reduce((sum, m) => sum + m.quantity, 0),
    uniqueMovementProducts: new Set(movements.map(m => m.productId)).size,
    invalidMovements: movements.filter(m => m.beforeQuantity !== 0 || m.afterQuantity !== m.quantity).length };
}

function quantity(value: string | undefined) {
  const number = Number(value?.trim() || 0);
  if (!Number.isSafeInteger(number) || number < 0 || number > 2147483647) {
    throw new Error("재고는 0 이상의 정수여야 합니다.");
  }
  return number;
}

export function normalizeConsignmentRow(row: Record<string, string>, source: string) {
  const sku = row["상품번호"]?.trim();
  const brand = row["그룹명"]?.trim();
  const category = row["앨범명"]?.trim();
  const optionName = row["멤버"]?.trim();
  if (!sku || !/^\d{1,120}$/.test(sku) || !brand || !category || !optionName) {
    throw new Error("상품번호·그룹명·앨범명·멤버를 확인해 주세요.");
  }
  const productName = [brand, category, optionName].join(" ");
  if (productName.length > 240) throw new Error("상품명이 너무 깁니다.");
  const stockQuantity = quantity(row["보유 재고"]);
  const availableCount = quantity(row["재고"]);
  const ebayIds = [...new Set([row["ebay item id"], row["ebay 스캔 item id"], row["ebay 보유재고 item id"]].map(v => v?.trim()).filter((v): v is string => !!v))];
  const exactEbayIds = ebayIds.filter(id => /^\d{12}$/.test(id));
  const imageUrl = row["포카마켓 이미지"]?.trim() || null;
  if (imageUrl && !/^https:\/\//.test(imageUrl)) throw new Error("이미지 주소를 확인해 주세요.");
  return {
    id: randomUUID(), sku, pocamarketId: sku, internalCode: sku,
    productName, brand, category, optionName, stockQuantity,
    pocamarketAvailableCount: availableCount, isSoldOut: availableCount === 0,
    // A CSV is a historical snapshot, not a successful live observation.
    pocamarketSyncedAt: null, salePrice: null, imageUrl,
    status: stockQuantity > 0 ? "unlisted" : "sold_out",
    ebayItemId: exactEbayIds[0] ?? null,
    uploadErrorSummary: ebayIds.length > exactEbayIds.length
      ? "원본 eBay 상품번호 정밀도 손실: 활성상품 보고서로 연결 확인 필요" : null,
    // Preserve all legacy IDs and image approval metadata without treating them
    // as verified live listings or adopting an ambiguous thumbnail as approved.
    memo: JSON.stringify({ source, importedRow: row, legacyEbayIds: ebayIds }),
  };
}

export async function importConsignmentRows(input: z.infer<typeof consignmentImportSchema>, userId: string) {
  const products = input.rows.map(row => normalizeConsignmentRow(row, input.source));
  const ids = products.map(p => p.sku);
  if (new Set(ids).size !== ids.length) throw new Error("파일에 중복 상품번호가 있습니다.");
  return prisma.$transaction(async tx => {
    const existing = await tx.product.findMany({
      where: { OR: [{ sku: { in: ids } }, { pocamarketId: { in: ids } }] },
      select: { sku: true, pocamarketId: true },
    });
    const used = new Set(existing.flatMap(p => [p.sku, p.pocamarketId]));
    const fresh = products.filter(p => !used.has(p.sku));
    const result = { created: input.dryRun ? 0 : fresh.length, candidates: fresh.length,
      skipped: products.length - fresh.length, stockTotal: fresh.reduce((sum,p) => sum+p.stockQuantity,0),
      dryRun: input.dryRun };
    if (input.dryRun || !fresh.length) return result;
    // Fail the entire batch on a concurrent collision; retry then skips the
    // already committed products. Stock and its history commit together.
    await tx.product.createMany({ data: fresh });
    const movements = fresh.filter(p => p.stockQuantity > 0).map(p => ({
      productId: p.id, type: "IN", quantity: p.stockQuantity,
      beforeQuantity: 0, afterQuantity: p.stockQuantity,
      reason: `위탁 상품대장 가져오기: ${input.source}`, createdBy: userId,
    }));
    if (movements.length) await tx.inventoryMovement.createMany({ data: movements });
    return result;
  }, { timeout: 20000 });
}
