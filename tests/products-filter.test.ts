import { describe, expect, it } from "vitest";
import { productWhere } from "@/lib/products";

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
        { category: { startsWith: "after", mode: "insensitive" } },
        {
          OR: [
            { productName: { contains: "soundwave", mode: "insensitive" } },
            { memo: { contains: "soundwave", mode: "insensitive" } },
          ],
        },
      ]),
    });
  });
});
