import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { productCardKey } = await import("@/lib/products");

describe("같은 카드인지 판단하는 열쇠", () => {
  const card = {
    brand: "Stray Kids",
    category: "DICON D'FESTA MINI EDITION",
    optionName: "HAN",
    productName: "Stray Kids DICON D'FESTA MINI EDITION : Stray Kids HAN",
  };

  it("네 값이 같으면 SKU가 달라도 같은 카드로 본다", () => {
    // 실제로 이 카드가 SKU만 다른 상품 14개로 쪼개져 재고가 흩어졌다.
    expect(productCardKey(card)).toBe(productCardKey({ ...card }));
  });

  it("대소문자와 공백 차이는 무시한다", () => {
    expect(productCardKey(card)).toBe(
      productCardKey({
        brand: "  stray kids ",
        category: "dicon d'festa   mini edition",
        optionName: "han",
        productName: "stray kids dicon d'festa mini edition : stray kids han",
      }),
    );
  });

  it("멤버가 다르면 다른 카드다", () => {
    expect(productCardKey(card)).not.toBe(
      productCardKey({ ...card, optionName: "FELIX" }),
    );
  });

  it("상품명이 다르면 다른 버전이므로 다른 카드다", () => {
    // 같은 멤버·앨범이라도 초회판, 럭키드로우처럼 버전이 다르면 다른 카드다.
    expect(productCardKey(card)).not.toBe(
      productCardKey({ ...card, productName: `${card.productName} (Lucky Draw)` }),
    );
  });

  it("판단할 값이 하나도 없으면 막지 않는다", () => {
    // 근거 없이 막으면 정상 등록까지 사라진다.
    expect(productCardKey({})).toBeNull();
    expect(
      productCardKey({ brand: "  ", category: null, optionName: "", productName: null }),
    ).toBeNull();
  });

  it("일부만 있어도 판단한다", () => {
    expect(productCardKey({ productName: "IVE ELEVEN Wonyoung" })).not.toBeNull();
  });
});
