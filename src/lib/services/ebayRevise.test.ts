import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildReviseInventoryRequest, buildRevisePictureRequest } from "./ebayRevise";

describe("buildRevisePictureRequest", () => {
  it("changes only the shared representative picture and does not submit variations", () => {
    const xml = buildRevisePictureRequest("12345", "https://img.example/thumb.jpg?a=1&b=2");
    expect(xml).toContain("<ItemID>12345</ItemID>");
    expect(xml).toContain("https://img.example/thumb.jpg?a=1&amp;b=2");
    expect(xml).toContain("<PictureDetails>");
    expect(xml).not.toContain("<Variations>");
  });
});

describe("buildReviseInventoryRequest", () => {
  it("sends the calculated price for each variation SKU", () => {
    const xml = buildReviseInventoryRequest([
      { itemId: "12345", sku: "CARD-A", quantity: 1, price: 4.9 },
      { itemId: "12345", sku: "CARD-B", quantity: 2, price: 12.3 },
    ]);

    expect(xml).toContain("<SKU>CARD-A</SKU><Quantity>1</Quantity><StartPrice>4.90</StartPrice>");
    expect(xml).toContain("<SKU>CARD-B</SKU><Quantity>2</Quantity><StartPrice>12.30</StartPrice>");
  });
});
