import { describe, expect, it } from "vitest";
import { unitCardTitle, unitCardOption, cardGroupLabel, unitMembersDescription } from "./unit-card-label";
const card = { brand: "BTS", category: "Proof", productName: "BTS Proof Unit", optionName: "Unit", sku: "10272", featuredMembers: "RM, Jin, SUGA, J-Hope, Jimin, V, Jungkook" };
describe("unit card labels", () => {
  it("uses exact roster membership, not member count, for a group card", () => {
    expect(unitCardTitle(card)).toContain("Group OT7");
    expect(unitCardTitle(card)).not.toContain("Full Set");
    const withType = unitCardTitle({ ...card, category: "Proof Mini PhotoCard" })!;
    expect(withType.match(/photocard/gi)).toHaveLength(1);
    expect(cardGroupLabel({ ...card, featuredMembers: "RM,Jin,SUGA,J-Hope,Jimin,V,Felix" })).toBeNull();
    expect(cardGroupLabel({ ...card, featuredMembers: card.featuredMembers + ", Jin" })).toBe("Group OT7");
  });
  it("recognizes all eight SKZ members but does not relabel historical nine-person cards", () => {
    const skz = { ...card, brand: "Stray Kids", featuredMembers: "Bang Chan, Lee Know, Changbin, Hyunjin, HAN, Felix, Seungmin, I.N" };
    expect(cardGroupLabel(skz)).toBe("Group OT8");
    expect(cardGroupLabel({ ...skz, featuredMembers: skz.featuredMembers + ", Woojin" })).toBeNull();
  });
  it("keeps all four names when the album and version fit", () => {
    const title = unitCardTitle({ ...card, featuredMembers: "RM,Jin,SUGA,V" })!;
    expect(title).toContain("RM Jin SUGA V");
    expect(title).toContain("Proof");
    expect(title.length).toBeLessThanOrEqual(80);
  });
  it("replaces long names before cutting the album or version and retains stable card identity", () => {
    const product = { ...card, category: "LOVE YOURSELF JAPAN EDITION", productName: "BTS LOVE YOURSELF JAPAN EDITION MINI PHOTO CARD Unit", featuredMembers: "J-Hope,Jimin,Jungkook,SUGA" };
    const title = unitCardTitle(product)!;
    expect(title).toContain("LOVE YOURSELF JAPAN EDITION");
    expect(title).toContain("MINI");
    expect(title).toContain("Unit Photocard #10272");
    expect(title.length).toBeLessThanOrEqual(80);
    expect(unitMembersDescription(product)).toContain("J-Hope, Jimin, Jungkook, SUGA");
    expect(unitCardOption(product)).toContain("#10272");
  });
  it("keeps single-member title behavior unchanged and escapes details", () => {
    expect(unitCardTitle({ ...card, featuredMembers: "Jin" })).toBeNull();
    expect(unitMembersDescription({ ...card, featuredMembers: "Jin,<script>" })).toContain("&lt;script&gt;");
    expect(unitCardTitle({ ...card, category: "Very Long Album ".repeat(30) })!.length).toBeLessThanOrEqual(80);
  });
});
