import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { inventoryImageBody, sameImageGroup, inventoryImageLocale } from "@/lib/ebay-inventory-images";
it("preserves quantity, condition, dimensions and product aspects while replacing images only", () => {
 const item = { sku: "card", locale: "en-US", availability: { shipToLocationAvailability: { quantity: 0 } }, condition: "NEW", packageWeightAndSize: { weight: { value: 1, unit: "OUNCE" } }, product: { title: "Card", aspects: { Card: ["Jin A"] }, imageUrls: ["https://old"] } };
 expect(inventoryImageBody(item, ["https://approved"])).toEqual({ availability: item.availability, condition: "NEW", packageWeightAndSize: item.packageWeightAndSize, product: { ...item.product, imageUrls: ["https://approved"] } });
 expect(item.product.imageUrls).toEqual(["https://old"]);
});
it("preserves exact group membership and option labels", () => {
 const group = { inventoryItemGroupKey: "g", title: "Group", description: "text", variantSKUs: ["a", "b"], variesBy: { specifications: [{ name: "Card", values: ["Jin", "V"] }] }, aspects: { Set: ["Set"] }, imageUrls: ["https://old"] };
 expect(inventoryImageBody(group, ["https://approved"], true)).toEqual({ title: group.title, description: group.description, variantSKUs: group.variantSKUs, variesBy: group.variesBy, aspects: group.aspects, imageUrls: ["https://approved"] });
 expect(sameImageGroup(["b", "a"], ["a", "b"])).toBe(true);
 expect(sameImageGroup(["a", "b", "c"], ["a", "b"])).toBe(false);
 expect(sameImageGroup(["a", "a"], ["a", "b"])).toBe(false);
});
it("refuses missing image/product information rather than sending an empty replacement", () => {
 expect(() => inventoryImageBody({}, ["https://approved"])).toThrow();
 expect(() => inventoryImageBody({ product: {} }, [])).toThrow();
});

it("normalizes Inventory locale enum into a valid HTTP language tag", () => {
 expect(inventoryImageLocale("en_US")).toBe("en-US");
 expect(inventoryImageLocale("en-US")).toBe("en-US");
 expect(inventoryImageLocale(undefined)).toBe("en-US");
});
