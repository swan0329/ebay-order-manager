import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { memberMatches, productMemberNames } = await import(
  "@/lib/ebay-listing-link-suggestions"
);

const title = "Stray Kids Lee Know Official ODDINARY Photocard Kpop";

describe("연결 후보의 멤버 판정", () => {
  it("제목에 있는 멤버는 일치로 본다", () => {
    expect(memberMatches(title, ["Lee Know"])).toBe(true);
  });

  it("제목에 없는 멤버는 불일치로 본다", () => {
    // 같은 그룹·앨범이라 글자 겹침 점수는 높지만 다른 카드다.
    expect(memberMatches(title, ["Felix"])).toBe(false);
  });

  it("대소문자와 구분기호가 달라도 일치로 본다", () => {
    expect(memberMatches("STRAY KIDS LEE-KNOW PHOTOCARD", ["Lee Know"])).toBe(true);
  });

  it("멤버 정보가 없으면 판단하지 않는다", () => {
    expect(memberMatches(title, [])).toBeNull();
  });

  it("유닛 카드는 지정된 멤버를 쓴다", () => {
    expect(
      productMemberNames({ optionName: "unit", featuredMembers: "Lee Know, I.N" }),
    ).toEqual(["Lee Know", "I.N"]);
  });

  it("멤버가 지정되지 않은 유닛 카드는 멤버 판정에서 뺀다", () => {
    expect(productMemberNames({ optionName: "unit", featuredMembers: null })).toEqual([]);
  });

  it("일반 카드는 옵션명을 멤버로 쓴다", () => {
    expect(productMemberNames({ optionName: "Felix", featuredMembers: null })).toEqual([
      "Felix",
    ]);
  });
});
