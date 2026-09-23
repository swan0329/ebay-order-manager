import type { EbayAccount } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import { ebayApiRequest } from "@/lib/services/ebayApiService";
import { exactPublishedOffer } from "@/lib/ebay-sales-hold";
import type { EbayFeedTarget } from "@/lib/ebay-feed-xml";

// Trading updates alone can leave the Inventory stock pool unchanged. Mirror
// only the exact published offer; never create, withdraw, or republish a listing.
export async function reflectEbayInventoryTarget(account: EbayAccount, target: EbayFeedTarget) {
  let body: { offers?: Parameters<typeof exactPublishedOffer>[0]; total?: number };
  try {
    const response = await ebayApiRequest(account, { path: "/sell/inventory/v1/offer", query: { sku: target.sku, limit: 100 } });
    body = (response.body ?? {}) as typeof body;
  } catch (error) {
    if (error instanceof EbayApiError && error.status === 404) return { legacy: true };
    throw error;
  }
  if (!body.offers?.length) return { legacy: true };
  if ((body.total ?? 0) > 100) throw new Error("eBay offer 조회 범위를 초과했습니다.");
  const offer = exactPublishedOffer(body.offers, target.sku, target.itemId);
  const quantity = target.quantity ?? 0;
  const response = await ebayApiRequest(account, { method: "POST", path: "/sell/inventory/v1/bulk_update_price_quantity", body: {
    requests: [{ sku: target.sku, shipToLocationAvailability: { quantity }, offers: [{ offerId: offer.offerId, availableQuantity: quantity,
      ...(target.price ? { price: { value: target.price, currency: "USD" } } : {}) }] }],
  } });
  const rows = (response.body as { responses?: Array<{ sku?: string; statusCode?: number }> } | null)?.responses;
  if (!rows?.length || rows.some(row => row.sku !== target.sku || !row.statusCode || row.statusCode >= 300)) throw new Error("eBay Inventory 가격·수량 반영을 확인하지 못했습니다.");
  return { legacy: false, offerId: offer.offerId };
}
