import { describe, expect, it } from "vitest";
import {
  matchesProductStockFilter,
  productData,
  productOrderBy,
  productWhere,
} from "@/lib/products";

describe("product inventory filters", () => {
  it("sorts inventory by the latest Pocamarket sync by default", () => {
    expect(productOrderBy()).toEqual([
      { pocamarketSyncedAt: { sort: "desc", nulls: "last" } },
      { sku: "asc" },
    ]);
    expect(productOrderBy("pocamarket_oldest")).toEqual([
      { pocamarketSyncedAt: { sort: "asc", nulls: "last" } },
      { sku: "asc" },
    ]);
    expect(productOrderBy("sku")).toEqual([{ sku: "asc" }]);
  });

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

  it("moves sold-out products back to unlisted when positive stock is saved", () => {
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
    ).toMatchObject({ stockQuantity: 3, status: "unlisted" });
  });

  it("treats positive stock as in stock even if a stale sold_out status remains", () => {
    expect(
      productWhere({
        stock: "in_stock",
      }),
    ).toMatchObject({
      AND: [{ stockQuantity: { gt: 0 } }],
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

  it("filters products that have never been synced with Pocamarket", () => {
    expect(productWhere({ freshness: "never" })).toMatchObject({
      AND: [{ pocamarketSyncedAt: null }],
    });
  });

});
