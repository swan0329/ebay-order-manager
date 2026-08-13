export type EbayListingToEnd = {
  ebayItemId: string | null;
  sku: string;
};

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
    ...rows.map((row) => ["End", row.ebayItemId ?? "", row.sku, "NotAvailable"]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
