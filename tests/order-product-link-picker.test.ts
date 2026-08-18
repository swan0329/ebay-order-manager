import { describe, expect, it } from "vitest";
import { guessFacetFromTitle } from "@/components/OrderProductLinkPicker";

describe("주문 제목에서 그룹·멤버·앨범 추측", () => {
  const groups = ["Stray Kids", "IVE", "NewJeans", "aespa"];
  const members = ["Bang Chan", "Hyunjin", "I.N", "Felix", "Wonyoung", "Karina"];
  const albums = ["I am NOT", "I am WHO", "MAXIDENT", "ELEVEN", "Get Up"];

  it("코드에 없는 그룹도 후보 목록에 있으면 찾는다", () => {
    // 예전에는 스트레이키즈 멤버·앨범만 코드에 적혀 있어 다른 그룹은 검색어가 비었다.
    const title = "NewJeans Get Up Official Photocard";
    expect(guessFacetFromTitle(title, groups)).toBe("NewJeans");
    expect(guessFacetFromTitle(title, albums)).toBe("Get Up");
  });

  it("대소문자와 마침표, 공백 차이를 무시한다", () => {
    // eBay 제목 표기가 제각각이다.
    expect(guessFacetFromTitle("STRAY KIDS I.N PHOTOCARD", members)).toBe("I.N");
    expect(guessFacetFromTitle("straykids in photocard", members)).toBe("I.N");
    expect(guessFacetFromTitle("Stray Kids IAMNOT Hyunjin", albums)).toBe("I am NOT");
  });

  it("여러 개가 걸리면 더 긴 쪽을 고른다", () => {
    // "I am WHO"가 "I am"보다 정확하다. 짧은 쪽을 고르면 엉뚱한 앨범이 잡힌다.
    expect(guessFacetFromTitle("Stray Kids I am WHO Felix", albums)).toBe("I am WHO");
  });

  it("맞는 값이 없으면 빈 문자열을 준다", () => {
    expect(guessFacetFromTitle("Random Trading Card", groups)).toBe("");
    expect(guessFacetFromTitle("", groups)).toBe("");
  });

  it("한 글자짜리 후보로 아무 제목이나 걸리지 않게 한다", () => {
    expect(guessFacetFromTitle("Stray Kids Photocard", ["S", "X"])).toBe("");
  });

  it("한글 그룹명도 찾는다", () => {
    expect(guessFacetFromTitle("스트레이키즈 현진 포토카드", ["스트레이키즈", "아이브"])).toBe(
      "스트레이키즈",
    );
  });
});
