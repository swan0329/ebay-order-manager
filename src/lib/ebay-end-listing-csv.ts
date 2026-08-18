export type EbayListingToEnd = {
  ebayItemId: string | null;
  sku: string;
};

// eBay는 종료 사유가 없으면 End 행을 거부한다. 단품 종료 CSV와 옵션 추가 CSV에
// 함께 담는 End 행이 같은 값을 쓰도록 한 곳에서만 정한다.
export const EBAY_END_LISTING_REASON = "NotAvailable";

const headers = [
  "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)",
  "Item number",
  "Custom label (SKU)",
  "EndingReason",
] as const;

function cell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function buildEbayEndListingsCsv(rows: EbayListingToEnd[]) {
  return [
    headers,
    ...rows.map((row) => ["End", row.ebayItemId ?? "", row.sku, EBAY_END_LISTING_REASON]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
