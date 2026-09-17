import { describe, expect, it } from "vitest";
import { ebayReviseCsvRow } from "@/lib/ebay-operations-csv";

describe("eBay 가격·수량 변경 CSV", () => {
  it("기존 상품 수정 시 상품 소재 국가를 다시 선언하지 않는다", () => {
    const row = ebayReviseCsvRow({
      itemId: "123456789012",
      sku: "CARD-001",
      price: "12.99",
      quantity: 1,
    });

    expect(row).toEqual({
      Action: "Revise",
      "Item number": "123456789012",
      "Custom label (SKU)": "CARD-001",
      "Start price": "12.99",
      "Available quantity": 1,
    });
    expect(Object.keys(row).join(" ")).not.toContain("Country=US");
  });
});
