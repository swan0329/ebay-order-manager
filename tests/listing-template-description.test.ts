import { describe, expect, it } from "vitest";
import { renderListingDescriptionTemplate } from "../src/lib/services/listingTemplateService";

describe("renderListingDescriptionTemplate", () => {
  const draft = {
    descriptionHtml: "<p>fallback</p>",
    sku: "VAR-TEST",
    price: "12.34",
    quantity: 1,
    brand: "Stray Kids",
    condition: "NEW",
  };

  it("uses the same saved HTML template for variation listings", () => {
    expect(
      renderListingDescriptionTemplate(
        "<h1>{{title}}</h1><p>{brand} · {sku}</p>",
        draft,
        "Stray Kids ODDINARY Photocard",
      ),
    ).toBe(
      "<h1>Stray Kids ODDINARY Photocard</h1><p>Stray Kids · VAR-TEST</p>",
    );
  });

  it("keeps the product description when no template is saved", () => {
    expect(renderListingDescriptionTemplate(null, draft, "Title")).toBe(
      "<p>fallback</p>",
    );
  });
});
