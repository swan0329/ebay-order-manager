import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requiredEnv } from "@/lib/env";
import { validateDrafts } from "@/lib/services/listingDraftService";

const MAX_FIRST_BATCH = 2;
const TOKEN_TTL_MS = 15 * 60 * 1000;

function normalizedIds(ids: string[]) { return [...new Set(ids)].sort(); }
function payload(ids: string[], remainingLimit: number, issuedAt: number) { return JSON.stringify({ ids: normalizedIds(ids), remainingLimit, issuedAt }); }
function signature(value: string) { return createHmac("sha256", requiredEnv("SESSION_SECRET")).update(value).digest("base64url"); }

export function issueListingPreviewToken(ids: string[], remainingLimit: number, issuedAt = Date.now()) {
  const body = Buffer.from(payload(ids, remainingLimit, issuedAt)).toString("base64url");
  return `${body}.${signature(body)}`;
}

export function verifyListingPreviewToken(token: string, ids: string[], remainingLimit: number, now = Date.now()) {
  const [body, supplied] = token.split("."); if (!body || !supplied) return false;
  const expected = signature(body); const a = Buffer.from(supplied); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try { const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as { ids:string[];remainingLimit:number;issuedAt:number };
    return JSON.stringify(parsed.ids) === JSON.stringify(normalizedIds(ids)) && parsed.remainingLimit === remainingLimit && now - parsed.issuedAt >= 0 && now - parsed.issuedAt <= TOKEN_TTL_MS;
  } catch { return false; }
}

export async function previewListingUpload(userId: string, ids: string[], remainingLimit: number) {
  const uniqueIds = normalizedIds(ids);
  if (!Number.isInteger(remainingLimit) || remainingLimit < 0) throw new Error("Seller Hub 잔여 판매 한도를 입력해 주세요.");
  if (!uniqueIds.length || uniqueIds.length > MAX_FIRST_BATCH) throw new Error("첫 API 등록은 한 번에 1~2개만 가능합니다.");
  if (uniqueIds.length > remainingLimit) throw new Error("선택 수량이 eBay 잔여 월 판매 한도를 초과합니다.");

  const drafts = await prisma.listingDraft.findMany({ where: { userId, id: { in: uniqueIds } }, include: { sourceInventory: true } });
  if (drafts.length !== uniqueIds.length) throw new Error("선택한 초안 일부를 찾을 수 없습니다.");
  const validation = await validateDrafts(userId, uniqueIds);
  const issues: Array<{ draftId:string; sku:string; reason:string }> = [];
  for (const draft of drafts) {
    const product = draft.sourceInventory;
    if (product && (product.ebayItemId || ["ACTIVE","PUBLISHED","LISTED"].includes(String(product.listingStatus ?? "").toUpperCase()))) {
      issues.push({ draftId: draft.id, sku: draft.sku, reason: "이미 활성 eBay 리스팅이 연결된 상품입니다." });
    }
    const validated = validation.find((row) => row.draftId === draft.id);
    if (validated && !validated.validation.valid) issues.push({ draftId: draft.id, sku: draft.sku, reason: "필수 검증을 통과하지 못했습니다." });
  }

  const productIds = drafts.flatMap((draft) => draft.sourceInventoryId ? [draft.sourceInventoryId] : []);
  if (productIds.length) {
    const duplicates = await prisma.$queryRaw<Array<{ sourceId:string; duplicateId:string }>>`
      SELECT source."id" AS "sourceId", duplicate."id" AS "duplicateId"
      FROM "products" source JOIN "products" duplicate
        ON source."image_phash" IS NOT NULL AND source."image_phash" = duplicate."image_phash" AND source."id" <> duplicate."id"
      WHERE source."id" IN (${Prisma.join(productIds)})
        AND duplicate."ebay_item_id" IS NOT NULL
        AND COALESCE(duplicate."listing_status", 'ACTIVE') IN ('ACTIVE','PUBLISHED','LISTED')
    `;
    for (const duplicate of duplicates) {
      const draft = drafts.find((row) => row.sourceInventoryId === duplicate.sourceId);
      if (draft) issues.push({ draftId: draft.id, sku: draft.sku, reason: "같은 이미지 지문의 활성 리스팅이 이미 있습니다." });
    }
  }
  return { ids: uniqueIds, remainingLimit, valid: issues.length === 0, issues, drafts: drafts.map((draft) => ({ id:draft.id,sku:draft.sku,title:draft.title,price:String(draft.price),quantity:draft.quantity })) };
}
