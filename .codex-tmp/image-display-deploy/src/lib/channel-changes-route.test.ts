import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ images: vi.fn(), prices: vi.fn(), createImages: vi.fn(), createPrices: vi.fn(), after: vi.fn(), membership: vi.fn() }));
const products = vi.hoisted(() => vi.fn());
vi.mock("@/lib/variation-listing-products", () => ({ getEbayVariationMembershipByProductId: m.membership }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findMany: products } } }));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/lib/session", () => ({ requireApiUser: async () => ({ id: "admin" }), UnauthorizedError: class extends Error {} }));
vi.mock("@/lib/channel-image-changes", () => ({ getChannelImageChanges: m.images }));
vi.mock("@/lib/channel-publish-jobs", () => ({ createChannelPublishJob: m.createImages, createShopifyAutomaticOperationJob: m.createPrices, getShopifyAutomaticOperationProductIds: m.prices, drainChannelPublishJob: vi.fn() }));
vi.mock("@/lib/ebay-feed-operations", () => ({ getEbayFeedOperationTargets: m.prices, submitEbayFeedOperation: m.createPrices }));
import { POST } from "@/app/api/channel-publishing/changes/route";
beforeEach(() => { vi.clearAllMocks(); m.membership.mockResolvedValue(new Map()); m.images.mockResolvedValue([{ productId: "p1" }]); m.prices.mockResolvedValue([]); m.createImages.mockResolvedValue({ id: "images" }); m.createPrices.mockResolvedValue({ id: "prices" }); });
async function run(channel = "SHOPIFY") { return (await POST(new Request("http://localhost/api/channel-publishing/changes", { method: "POST", body: JSON.stringify({ channel }) }))).json(); }
it("starts images alone when price and stock are unchanged", async () => {
  expect(await run()).toMatchObject({ job: null, imageJob: { id: "images" }, errors: [] });
  expect(m.createPrices).not.toHaveBeenCalled();
  expect(m.after).toHaveBeenCalledTimes(1);
});
it("reports partial failure and keeps the accepted price job visible", async () => {
  m.images.mockRejectedValue(new Error("image lookup failed")); m.prices.mockResolvedValue([{ id: "p1" }]);
  expect(await run("EBAY")).toMatchObject({ job: { id: "prices" }, imageJob: null, errors: ["이미지: image lookup failed"] });
});
it("does not create jobs when neither has changed", async () => {
  m.images.mockResolvedValue([]);
  expect(await run()).toMatchObject({ job: null, imageJob: null, errors: [] });
  expect(m.createImages).not.toHaveBeenCalled();
});
it("restricts both queues to selected cards, including the selected card's parent image", async () => {
  products.mockResolvedValue([{ id: "selected", sku: "15369_15372", shopifyProductId: "parent" }]);
  m.prices.mockResolvedValue([{ id: "other" }, { id: "selected" }]);
  m.images.mockResolvedValue([{ productId: "sibling", parent: "parent" }, { productId: "other", parent: "unrelated" }]);
  const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ channel: "SHOPIFY", skus: ["15369_15372"] }) }));
  expect(response.status).toBe(202);
  expect(m.createPrices).toHaveBeenCalledWith({ userId: "admin", operation: "revise", productIds: ["selected"] });
  expect(m.createImages).toHaveBeenCalledWith(expect.objectContaining({ targetIds: ["selected"] }));
});
it("rejects unknown and empty selections before either queue is created", async () => {
  products.mockResolvedValue([]);
  for (const skus of [["unknown"], []]) {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ channel: "EBAY", skus }) }));
    expect(response.status).toBe(422);
  }
  expect(m.createPrices).not.toHaveBeenCalled(); expect(m.createImages).not.toHaveBeenCalled();
});

it("finds selected eBay card images through the confirmed group instead of the ended single", async () => {
  products.mockResolvedValue([{ id: "selected", sku: "82804", ebayItemId: "ended-single", shopifyProductId: null }]);
  m.membership.mockResolvedValue(new Map([["selected", "active-group"]]));
  m.images.mockResolvedValue([{ productId: "sibling", parent: "active-group" }]);
  const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ channel: "EBAY", skus: ["82804"] }) }));
  expect(response.status).toBe(202);
  expect(m.createImages).toHaveBeenCalledWith(expect.objectContaining({ targetIds: ["selected"] }));
});
