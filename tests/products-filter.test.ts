import { describe, expect, it } from "vitest";
import { matchesProductStockFilter, productData, productWhere } from "@/lib/products";

describe("product inventory filters", () => {
  it("adds photo-card field filters independently from keyword search", () => {
    expect(
      productWhere({
        q: "sku-1",
        group: "ive",
        member: "rei",
        album: "after",
        version: "soundwave",
      }),
    ).toMatchObject({
      AND: expect.arrayContaining([
        { brand: { startsWith: "ive", mode: "insensitive" } },
        { optionName: { startsWith: "rei", mode: "insensitive" } },
        { category: { contains: "after", mode: "insensitive" } },
        {
          OR: [
            { productName: { contains: "soundwave", mode: "insensitive" } },
            { memo: { contains: "soundwave", mode: "insensitive" } },
          ],
        },
      ]),
    });
  });

  it("reactivates sold out products when positive stock is saved", () => {
    expect(
      productData({
        sku: "sku-1",
        internalCode: null,
        productName: "Product 1",
        optionName: null,
        category: null,
        brand: null,
        costPrice: null,
        salePrice: null,
        stockQuantity: 3,
        safetyStock: 0,
        location: null,
        memo: null,
        imageUrl: null,
        status: "sold_out",
      }),
    ).toMatchObject({ stockQuantity: 3, status: "active" });
  });

  it("treats positive stock as in stock even if a stale sold_out status remains", () => {
    expect(
      productWhere({
        stock: "in_stock",
      }),
    ).toMatchObject({
      AND: [{ stockQuantity: { gt: 0 }, status: { not: "inactive" } }],
    });

    expect(
      matchesProductStockFilter(
        { stockQuantity: 3, safetyStock: 0, status: "sold_out" },
        "in_stock",
      ),
    ).toBe(true);
    expect(
      matchesProductStockFilter(
        { stockQuantity: 3, safetyStock: 0, status: "sold_out" },
        "sold_out",
      ),
    ).toBe(false);
  });
});
