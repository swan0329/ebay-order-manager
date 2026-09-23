import { describe, expect, it } from "vitest";
import { memberFilter, memberOptions, productMember } from "./product-member";
describe("member identity separate from card options", () => {
  it("combines letter variants, benefits and casing without rewriting original options", () => {
    expect(memberOptions(["J-Hope", "J-Hope A", "J-Hope B", "WEVERSE Jin", "ID Card Holder Set Jin", "M2U LUCKY DRAW Jin A", "JAPAN FC Jin A", "Jin", "FELIX", "Felix"])).toEqual(["Felix", "J-Hope", "Jin"]);
  });
  it("keeps distinct or ambiguous members separate", () => {
    expect(productMember("Hyunjin")).toBe("Hyunjin");
    expect(productMember("Jimin B")).toBe("Jimin");
    expect(productMember("Jin V")).toBe("Jin V");
    expect(productMember("Unknown")).toBe("Unknown");
  });
  it("matches prefixed Jin variants with token boundaries instead of matching Hyunjin", () => {
    const filters = memberFilter("Jin").OR;
    const matches = (s: string) => filters.some(({ optionName: f }) => {
      s = s.toLowerCase();
      if ("equals" in f) return s === f.equals!.toLowerCase();
      if ("startsWith" in f) return s.startsWith(f.startsWith!.toLowerCase());
      if ("endsWith" in f) return s.endsWith(f.endsWith!.toLowerCase());
      return s.includes(f.contains!.toLowerCase());
    });
    expect(matches("WEVERSE Jin")).toBe(true);
    expect(matches("JAPAN FC Jin A")).toBe(true);
    expect(matches("Jin B")).toBe(true);
    expect(matches("Hyunjin")).toBe(false);
    expect(matches("Jimin")).toBe(false);
  });
});
