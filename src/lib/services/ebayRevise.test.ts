import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildRevisePictureRequest } from "./ebayRevise";

describe("buildRevisePictureRequest", () => {
  it("changes only the shared representative picture and does not submit variations", () => {
    const xml = buildRevisePictureRequest("12345", "https://img.example/thumb.jpg?a=1&b=2");
    expect(xml).toContain("<ItemID>12345</ItemID>");
    expect(xml).toContain("https://img.example/thumb.jpg?a=1&amp;b=2");
    expect(xml).toContain("<PictureDetails>");
    expect(xml).not.toContain("<Variations>");
  });
});
