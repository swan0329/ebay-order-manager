import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { requiredEnv } from "@/lib/env";
import { validateDrafts } from "@/lib/services/listingDraftService";

export const MAX_LISTING_UPLOAD_BATCH = 50;
const TOKEN_TTL_MS = 15 * 60 * 1000;

function normalizedIds(ids: string[]) { return [...new Set(ids)].sort(); }
function payload(ids: string[], issuedAt: number) { return JSON.stringify({ ids: normalizedIds(ids), issuedAt }); }
function signature(value: string) { return createHmac("sha256", requiredEnv("SESSION_SECRET")).update(value).digest("base64url"); }

export function issueListingPreviewToken(ids: string[], issuedAt = Date.now()) {
  const body = Buffer.from(payload(ids, issuedAt)).toString("base64url");
  return `${body}.${signature(body)}`;
}

export function verifyListingPreviewToken(token: string, ids: string[], now = Date.now()) {
  const [body, supplied] = token.split("."); if (!body || !supplied) return false;
  const expected = signature(body); const a = Buffer.from(supplied); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try { const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as { ids:string[];issuedAt:number };
    return JSON.stringify(parsed.ids) === JSON.stringify(normalizedIds(ids)) && now - parsed.issuedAt >= 0 && now - parsed.issuedAt <= TOKEN_TTL_MS;
  } catch { return false; }
}

export async function previewListingUpload(userId: string, ids: string[]) {
  const uniqueIds = normalizedIds(ids);
  if (!uniqueIds.length || uniqueIds.length > MAX_LISTING_UPLOAD_BATCH) throw new Error(`한 번에 1~${MAX_LISTING_UPLOAD_BATCH}개까지 등록할 수 있습니다.`);

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
  const rows = drafts.map((draft) => {
    const checked = validation.find((row) => row.draftId === draft.id);
    const rowIssues = checked?.validation.issues.map((issue) => ({
      field: issue.field,
      message: issue.message,
    })) ?? [];
    const duplicateIssues = issues
      .filter((issue) => issue.draftId === draft.id)
      .map((issue) => ({ field: "duplicate", message: issue.reason }));
    const imageUrls = Array.isArray(draft.imageUrlsJson) ? draft.imageUrlsJson : [];

    return {
      id: draft.id,
      productId: draft.sourceInventoryId,
      sku: draft.sku,
      title: draft.title,
      price: draft.price == null ? null : Number(draft.price),
      quantity: draft.quantity,
      imageCount: imageUrls.length,
      valid: Boolean(checked?.validation.valid) && duplicateIssues.length === 0,
      issues: [...rowIssues, ...duplicateIssues],
      payload: checked && "preview" in checked ? checked.preview : null,
    };
  });

  return {
    ids: uniqueIds,
    valid: issues.length === 0,
    issues,
    rows,
    // eBay 응답 시간에 따라 달라지는 안내용 범위이며 실행 제한 시간이 아니다.
    estimateSeconds: { minimum: uniqueIds.length * 3, maximum: uniqueIds.length * 8 },
    drafts: drafts.map((draft) => ({ id:draft.id,sku:draft.sku,title:draft.title,price:String(draft.price),quantity:draft.quantity })),
  };
}
