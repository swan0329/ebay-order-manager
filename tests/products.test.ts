import { describe, expect, it } from "vitest";
import { normalizeProductImportRow } from "../src/lib/products";

describe("normalizeProductImportRow", () => {
  it("maps photocard market Excel columns to product fields", () => {
    expect(
      normalizeProductImportRow({
        상품번호: 301862,
        재고: 5,
        그룹명: "Stray Kids",
        앨범명: "ROCK(樂)-STAR YIZHIYU",
        멤버: "BANG CHAN",
        "포카마켓 이미지": "https://example.com/card.jpg",
        "포카마켓 가격": 6000,
      }),
    ).toMatchObject({
      sku: "301862",
      internalCode: 301862,
      productName: "Stray Kids ROCK(樂)-STAR YIZHIYU BANG CHAN",
      optionName: "BANG CHAN",
      category: "ROCK(樂)-STAR YIZHIYU",
      brand: "Stray Kids",
      salePrice: 6000,
      stockQuantity: 5,
      imageUrl: "https://example.com/card.jpg",
      memo: "",
      status: "active",
    });
  });

  it("marks zero stock imports as sold out when no status is supplied", () => {
    expect(
      normalizeProductImportRow({
        상품번호: 213258,
        재고: 0,
        그룹명: "Stray Kids",
        앨범명: "ROCK(樂)-STAR YIZHIYU",
      }),
    ).toMatchObject({ status: "sold_out" });
  });

  it("keeps the original album name in memo", () => {
    expect(
      normalizeProductImportRow({
        상품번호: 301862,
        앨범명: "ROCK(樂)-STAR YIZHIYU",
        "원본 앨범명": "樂-STAR YIZHIYU",
      }),
    ).toMatchObject({
      category: "ROCK(樂)-STAR YIZHIYU",
      memo: "樂-STAR YIZHIYU",
    });
  });
});
