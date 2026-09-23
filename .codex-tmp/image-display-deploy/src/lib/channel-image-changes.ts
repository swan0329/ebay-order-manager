import { getEbayVariationMembershipByProductId } from "@/lib/variation-listing-products";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getListingImageSettings } from "@/lib/variation-thumbnail-settings";
import { listingWatermarkRenderVersion } from "@/lib/ebay-watermarked-images";
import { variationThumbnailRenderVersion } from "@/lib/variation-thumbnail";

type Channel = "EBAY" | "SHOPIFY";
type Row = { id: string; sku: string; parent: string; image: string | null; source: string | null; front: string | null; history: string | null; brand: string | null; category: string | null; option: string | null; eligible?: boolean; supplier?: string | null; variant?: string | null };
export function channelImageFingerprint(rows: Row[], settings: unknown) {
  return createHash("sha256").update(JSON.stringify({
    renderer: listingWatermarkRenderVersion, groupRenderer: variationThumbnailRenderVersion,
    settings, rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)),
  })).digest("hex");
}

// Keep successful channel delivery separate from source edits and price syncs.
// Historical listings without a receipt are checked/replaced once on next revise.
export async function getChannelImageChanges(userId: string, channel: Channel, parent?: string) {
  const membership = channel === "EBAY" ? await getEbayVariationMembershipByProductId(userId) : new Map<string, string>();
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p.id, p.sku,
      CASE WHEN ${channel} = 'EBAY' THEN p.ebay_item_id ELSE p.shopify_product_id END AS parent,
      p.image_url AS image, p.image_source AS source, p.user_front_image_url AS front,
      p.brand, p.category, p.option_name AS option, p.source_image_url AS supplier,
      p.shopify_variant_id AS variant,
      CASE WHEN ${channel} = 'EBAY' THEN UPPER(COALESCE(p.listing_status,'')) NOT IN ('ENDED','ARCHIVED','INACTIVE')
        ELSE UPPER(COALESCE(p.shopify_status,'')) NOT IN ('ARCHIVED','DRAFT') END AS eligible,
      (SELECT h.image_url FROM product_image_history h WHERE h.product_id = p.id
       AND h.action IN ('lens_saved','worker_approved','ai_approved') ORDER BY h.created_at DESC LIMIT 1) AS history
    FROM products p
    WHERE CASE WHEN ${channel} = 'EBAY' THEN (COALESCE(p.ebay_item_id,'') <> '' OR p.id::text = ANY(${[...membership.keys()]}::text[]))
      ELSE COALESCE(p.shopify_product_id,'') <> '' END
  `;
  const settings = await getListingImageSettings(userId);
  const groups = new Map<string, Row[]>();
  for (const original of rows) {
    const canonical = membership.get(original.id);
    const row = canonical ? { ...original, parent: canonical, eligible: true } : original;
    if (parent && row.parent !== parent) continue;
    const group = groups.get(row.parent) ?? [];
    group.push(row); groups.set(row.parent, group);
  }
  const receipts = await prisma.syncLog.findMany({
    where: { userId, type: { in: [`CHANNEL_IMAGE_SYNC_${channel}`, `CHANNEL_IMAGE_REVIEW_${channel}`] }, status: "SUCCESS" },
    orderBy: { createdAt: "desc" }, select: { rawJson: true, type: true },
  });
  const latest = new Map<string, string>();
  for (const receipt of receipts) {
    const data = receipt.rawJson as { parent?: string; fingerprint?: string } | null;
    if (data?.parent && !latest.has(data.parent)) {
      if (receipt.type === `CHANNEL_IMAGE_REVIEW_${channel}`) latest.set(data.parent, "review-required");
      else if (data.fingerprint) latest.set(data.parent, data.fingerprint);
    }
  }
  return [...groups].filter(([, members]) => members.some(m => m.eligible !== false)).map(([parent, members]) => ({
    parent, productId: members[0].id, sku: members[0].sku,
    fingerprint: channelImageFingerprint(members, settings),
  })).filter((target) => latest.get(target.parent) !== target.fingerprint);
}

export async function recordChannelImageSync(userId: string, channel: Channel, target: { parent: string; fingerprint: string }) {
  await prisma.syncLog.create({ data: {
    userId, type: `CHANNEL_IMAGE_SYNC_${channel}`, status: "SUCCESS",
    message: `${target.parent}: 승인 이미지·설정 반영 완료`, rawJson: target,
  } });
}
