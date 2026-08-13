export const productStatuses = ["active", "unlisted", "sold_out"] as const;

export type ProductStatus = (typeof productStatuses)[number];

export const productStatusOptions: Array<{ value: ProductStatus; label: string }> = [
  { value: "active", label: "판매중" },
  { value: "unlisted", label: "미등록" },
  { value: "sold_out", label: "품절" },
];

export function normalizeProductStatus(
  value: unknown,
  fallback: ProductStatus = "unlisted",
): ProductStatus {
  const text = String(value ?? "").trim().toLowerCase();

  if (["active", "selling", "listed", "판매중", "활성"].includes(text)) {
    return "active";
  }

  if (["unlisted", "inactive", "not_listed", "not-listed", "미등록", "비활성"].includes(text)) {
    return "unlisted";
  }

  if (["sold_out", "soldout", "sold-out", "out_of_stock", "품절"].includes(text)) {
    return "sold_out";
  }

  return fallback;
}

export function productStatusLabel(value: unknown): string {
  const status = normalizeProductStatus(value);
  return productStatusOptions.find((option) => option.value === status)?.label ?? String(value ?? "");
}
