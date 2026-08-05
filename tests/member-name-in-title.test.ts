import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { titleContainsMemberName, memberMatches } = await import(
  "@/lib/ebay-listing-link-suggestions"
);

describe("제목에서 멤버 이름 찾기", () => {
  it("단어로 들어 있으면 찾는다", () => {
    expect(
      titleContainsMemberName("Stray Kids skz Han Official Rock Star Photocard", "HAN"),
    ).toBe(true);
  });

  it("다른 이름 속에 우연히 들어간 글자는 무시한다", () => {
    // "changbin"은 "han"을 품고 있지만 HAN의 카드가 아니다.
    expect(
      titleContainsMemberName("Stray Kids skz Changbin Official Photocard", "HAN"),
    ).toBe(false);
    // "Bang Chan"도 마찬가지로 CHAN이 들어가지만 CHANGBIN은 아니다.
    expect(
      titleContainsMemberName("Stray Kids Bang Chan Official Photocard", "CHANGBIN"),
    ).toBe(false);
  });

  it("여러 단어 이름은 순서대로 이어져야 인정한다", () => {
    expect(
      titleContainsMemberName("Stray Kids skz Lee Know Official Photocard", "LEE KNOW"),
    ).toBe(true);
    expect(
      titleContainsMemberName("Stray Kids Know Lee Official Photocard", "LEE KNOW"),
    ).toBe(false);
  });

  it("구분기호가 달라도 같은 이름으로 본다", () => {
    expect(titleContainsMemberName("Stray Kids SKZ I.N Official", "I.N")).toBe(true);
    expect(titleContainsMemberName("Stray Kids LEE-KNOW Official", "Lee Know")).toBe(true);
  });

  it("멤버 판정도 같은 규칙을 쓴다", () => {
    expect(memberMatches("Stray Kids Changbin Official Photocard", ["HAN"])).toBe(false);
    expect(memberMatches("Stray Kids Changbin Official Photocard", ["CHANGBIN"])).toBe(
      true,
    );
  });
});
