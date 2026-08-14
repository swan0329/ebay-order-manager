import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { analyzePhotocardTitleMatch } = await import("@/lib/photocard-title-match");
const { buildCompQueries } = await import("@/lib/ebay-market-comps");

// 실제로 다루는 상품 한 건(포카마켓에서 받은 값 그대로)을 기준으로 본다.
const leeKnowOddinary = {
  brand: "Stray Kids",
  optionName: "LEE KNOW",
  category: "ODDINARY APPLEMUSIC",
  productName: "Stray Kids ODDINARY APPLEMUSIC LEE KNOW",
};

const tierOf = (product: Parameters<typeof analyzePhotocardTitleMatch>[0], title: string) =>
  analyzePhotocardTitleMatch(product, title).tier;

describe("eBay 시세 후보 판정", () => {
  it("그룹·멤버·앨범이 모두 맞으면 확신 후보로 본다", () => {
    expect(
      tierOf(leeKnowOddinary, "Stray Kids Oddinary Apple Music Official Photocard Lee Know"),
    ).toBe("exact");
  });

  it("띄어쓰기와 다른 활동명 표기를 같은 멤버로 본다", () => {
    // 판매자마다 "LeeKnow", "Minho"로 적는다. 표기가 다르다고 놓치면 안 된다.
    expect(
      tierOf(leeKnowOddinary, "Stray Kids Oddinary AppleMusic Photocard LeeKnow"),
    ).toBe("exact");
    expect(
      tierOf(leeKnowOddinary, "Stray Kids Oddinary Apple Music Photocard Minho"),
    ).toBe("exact");
  });

  it("다른 멤버의 카드는 제외한다", () => {
    expect(
      tierOf(leeKnowOddinary, "Stray Kids Oddinary Apple Music Official Photocard Felix"),
    ).toBe("rejected");
  });

  it("다른 이름 안에 우연히 들어간 글자로 멤버를 인정하지 않는다", () => {
    // "Changbin"은 HAN의 카드가 아니다.
    expect(
      tierOf(
        { ...leeKnowOddinary, optionName: "HAN" },
        "Stray Kids Oddinary Apple Music Photocard Changbin",
      ),
    ).toBe("rejected");
  });

  it("여러 멤버가 함께 적힌 리스팅은 제외한다", () => {
    // 한 장 값이 아니거나 "멤버 골라 담기"라서, 싼값으로 최저가 자리를 차지한다.
    expect(
      tierOf(
        leeKnowOddinary,
        "Stray Kids Oddinary Apple Music Photocard Lee Know Felix Hyunjin",
      ),
    ).toBe("rejected");
    expect(
      tierOf(leeKnowOddinary, "Stray Kids Oddinary Apple Music Photocard Choose Your Member"),
    ).toBe("rejected");
  });

  it("같은 멤버라도 앨범이 다르면 제외한다", () => {
    expect(tierOf(leeKnowOddinary, "Stray Kids 5-STAR Official Photocard Lee Know")).toBe(
      "rejected",
    );
  });

  it("제목에 앨범 정보가 없으면 확인이 필요한 후보로 남긴다", () => {
    expect(tierOf(leeKnowOddinary, "Stray Kids Lee Know Official Photocard")).toBe(
      "similar",
    );
  });

  it("카드가 아닌 물건과 비공식 인쇄물은 제외한다", () => {
    expect(
      tierOf(leeKnowOddinary, "Stray Kids Oddinary Apple Music Photocard Sleeves Lee Know"),
    ).toBe("rejected");
    expect(tierOf(leeKnowOddinary, "Stray Kids Oddinary Apple Music Poster Lee Know")).toBe(
      "rejected",
    );
  });

  it("다른 그룹의 카드는 제외한다", () => {
    expect(
      tierOf({ brand: "IVE", optionName: "REI" }, "LE SSERAFIM KAZUHA Photocard"),
    ).toBe("rejected");
  });

  it("우리 카드 이름에 들어 있는 말로는 거르지 않는다", () => {
    // "Random trading card"가 이 카드의 이름이다. random을 이유로 빼면 안 된다.
    const randomCard = {
      brand: "Stray Kids",
      optionName: "HAN",
      category: "Stray Kids XMAS POPUP STORE 2024 Random trading card",
      productName: "Stray Kids XMAS POPUP STORE 2024 Random trading card HAN",
    };

    expect(
      tierOf(
        randomCard,
        "Stray Kids Xmas Popup Store 2024 Random Trading Card Photocard Han",
      ),
    ).toBe("exact");
  });

  it("유닛 카드는 지정된 실제 멤버로 판정한다", () => {
    const unit = {
      brand: "Stray Kids",
      optionName: "Unit",
      featuredMembers: "Lee Know, I.N",
      category: "NOEASY",
      productName: "Stray Kids NOEASY Unit",
    };

    expect(tierOf(unit, "Stray Kids NOEASY Unit Photocard Lee Know I.N")).toBe("exact");
    expect(tierOf(unit, "Stray Kids NOEASY Unit Photocard Felix Hyunjin")).toBe("rejected");
  });
});

describe("eBay 시세 검색어", () => {
  it("좁은 검색어에서 넓은 검색어 순으로 만든다", () => {
    expect(buildCompQueries(leeKnowOddinary)).toEqual([
      "Stray Kids LEE KNOW oddinary applemusic",
      "Stray Kids LEE KNOW oddinary",
      "Stray Kids LEE KNOW photocard",
    ]);
  });

  it("등록용 제목의 장식 낱말을 검색어에 넣지 않는다", () => {
    // "Official", "Kpop"이 들어가면 그 낱말이 없는 리스팅이 전부 빠진다.
    for (const query of buildCompQueries(leeKnowOddinary)) {
      expect(query.toLowerCase()).not.toContain("official");
      expect(query.toLowerCase()).not.toContain("kpop");
    }
  });

  it("멤버를 알 수 없는 유닛 카드는 앨범으로 찾는다", () => {
    const queries = buildCompQueries({
      brand: "Stray Kids",
      optionName: "Unit",
      category: "NOEASY",
      productName: "Stray Kids NOEASY Unit",
    });

    expect(queries[0]).toBe("Stray Kids noeasy");
  });
});
