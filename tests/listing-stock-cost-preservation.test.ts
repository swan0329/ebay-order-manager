import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), create: vi.fn(), movement: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findUnique: m.find, update: m.update, create: m.create }, inventoryMovement: { create: m.movement } } }));
import { upsertProductFromListingInput, type ListingUploadInput } from "@/lib/services/inventoryService";
const input = { sku: "card", title: "Channel title", price: "32.90", quantity: 2, imageUrls: ["https://example.test/approved.jpg"] } as ListingUploadInput;
beforeEach(() => { vi.clearAllMocks(); m.update.mockResolvedValue({ id: "card" }); m.create.mockResolvedValue({ id: "new" }); });
it("cannot turn a USD listing price into KRW source cost or procurement into owned stock", async () => {
  m.find.mockResolvedValue({ id: "card", stockQuantity: 0 });
  await upsertProductFromListingInput(input, "admin");
  const data = m.update.mock.calls[0][0].data;
  expect(data).not.toHaveProperty("salePrice"); expect(data).not.toHaveProperty("stockQuantity");
  expect(data).not.toHaveProperty("productName"); expect(m.movement).not.toHaveBeenCalled();
  expect(data.ebayPrice).toBe("32.90");
});
it("records a new manual USD listing without inventing a physical receipt", async () => {
  m.find.mockResolvedValue(null);
  await upsertProductFromListingInput(input, "admin");
  const data = m.create.mock.calls[0][0].data;
  expect(data).toMatchObject({ stockQuantity: 0, salePrice: null, finalListingPriceUsd: "32.90" });
  expect(data.listingPriceApprovals.create).toMatchObject({ priceUsd: "32.90", approvedById: "admin" });
  expect(m.movement).not.toHaveBeenCalled();
});
