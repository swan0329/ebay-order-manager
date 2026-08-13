import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { isCompatibleMarketCompTitle } = await import("@/lib/ebay-market-comps");

describe("eBay 시세 후보 그룹·멤버 필터", () => {
  it("같은 그룹과 멤버가 제목에 있는 후보만 허용한다", () => {
    const product = { brand: "IVE", optionName: "REI" };

    expect(isCompatibleMarketCompTitle(product, "IVE REI Official Photocard Kpop")).toBe(true);
    expect(isCompatibleMarketCompTitle(product, "LE SSERAFIM KAZUHA Photocard")).toBe(false);
    expect(isCompatibleMarketCompTitle(product, "IVE WONYOUNG Official Photocard")).toBe(false);
  });

  it("띄어쓰기와 구분 기호 차이는 허용한다", () => {
    expect(
      isCompatibleMarketCompTitle(
        { brand: "LE SSERAFIM", optionName: "KIM CHAEWON" },
        "LE-Sserafim Kim-Chaewon Official Photocard",
      ),
    ).toBe(true);
  });

  it("유닛 카드는 지정된 실제 멤버 중 하나가 있어야 한다", () => {
    const product = {
      brand: "Stray Kids",
      optionName: "unit",
      featuredMembers: "Lee Know, I.N",
    };

    expect(isCompatibleMarketCompTitle(product, "SKZ Lee Know I.N Unit Photocard")).toBe(true);
    expect(isCompatibleMarketCompTitle(product, "Stray Kids Felix Hyunjin Unit Photocard")).toBe(false);
  });
});
