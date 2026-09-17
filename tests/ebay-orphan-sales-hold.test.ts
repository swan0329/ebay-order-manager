import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ product: vi.fn(), group: vi.fn(), account: vi.fn(), create: vi.fn(), update: vi.fn(), outOfStock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { product: { findFirst: mocks.product }, variationListingState: { findFirst: mocks.group }, syncLog: { create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/services/ebayApiService", () => ({ getActiveEbayInventoryAccount: mocks.account }));
vi.mock("@/lib/ebay", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("test-token"), EbayApiError: class extends Error {} }));
vi.mock("@/lib/env", () => ({ getEbayConfig: () => ({ hosts: { api: "https://example.com" } }) }));
vi.mock("@/lib/ebay-out-of-stock", () => ({ ensureEbayOutOfStockControl: mocks.outOfStock }));
import { ensureEbayUnlinkedSalesHold } from "@/lib/ebay-sales-hold";
beforeEach(() => { vi.clearAllMocks(); mocks.product.mockResolvedValue(null); mocks.group.mockResolvedValue(null); mocks.account.mockResolvedValue({}); mocks.create.mockResolvedValue({ id: "log" }); });
afterEach(() => vi.unstubAllGlobals());
it("does not touch a currently connected product or shared parent", async () => {
  mocks.product.mockResolvedValue({ id: "p" });
  await expect(ensureEbayUnlinkedSalesHold("admin", "123")).rejects.toThrow("연결된 상품");
  mocks.product.mockResolvedValue(null); mocks.group.mockResolvedValue({ id: "g" });
  await expect(ensureEbayUnlinkedSalesHold("admin", "123")).rejects.toThrow("연결된 상품");
  expect(mocks.account).not.toHaveBeenCalled();
});
it("sets only orphan stock to zero and verifies GetItem before recording success", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>123</ItemID><Quantity>1</Quantity></Item></GetItemResponse>'))
    .mockResolvedValueOnce(new Response('<ReviseInventoryStatusResponse><Ack>Success</Ack></ReviseInventoryStatusResponse>'))
    .mockResolvedValueOnce(new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>123</ItemID><Quantity>0</Quantity></Item></GetItemResponse>'));
  vi.stubGlobal("fetch", fetchMock);
  expect(await ensureEbayUnlinkedSalesHold("admin", "123")).toMatchObject({ verified: true, changed: true, available: 0 });
  expect(fetchMock.mock.calls[1][1].body).toContain('<InventoryStatus><ItemID>123</ItemID><Quantity>0</Quantity></InventoryStatus>');
  expect(fetchMock.mock.calls[1][1].body).not.toContain('<StartPrice>');
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCESS" }) }));
});
it("is idempotent after the exact listing is already at zero", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>123</ItemID><Quantity>0</Quantity></Item></GetItemResponse>'));
  vi.stubGlobal("fetch", fetchMock);
  expect(await ensureEbayUnlinkedSalesHold("admin", "123")).toMatchObject({ changed: false, available: 0 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("holds a stale single only after verifying its saved replacement variation", async () => {
  mocks.product.mockResolvedValue({ id: "p", sku: "card" });
  mocks.group.mockResolvedValueOnce(null).mockResolvedValueOnce({ ebayItemId: "456" });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>123</ItemID><Quantity>1</Quantity></Item></GetItemResponse>'))
    .mockResolvedValueOnce(new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>456</ItemID><SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus><Variations><Variation><SKU>card</SKU><Quantity>1</Quantity></Variation></Variations></Item></GetItemResponse>'))
    .mockResolvedValueOnce(new Response('<ReviseInventoryStatusResponse><Ack>Success</Ack></ReviseInventoryStatusResponse>'))
    .mockResolvedValueOnce(new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>123</ItemID><Quantity>0</Quantity></Item></GetItemResponse>'));
  vi.stubGlobal("fetch", fetchMock);
  expect(await ensureEbayUnlinkedSalesHold("admin", "123")).toMatchObject({ verified: true, available: 0 });
  expect(fetchMock.mock.calls[2][1].body).toContain('<ItemID>123</ItemID><Quantity>0</Quantity>');
});
it("rejects a saved replacement whose actual SKU does not match", async () => {
  mocks.product.mockResolvedValue({ id: "p", sku: "card" });
  mocks.group.mockResolvedValueOnce(null).mockResolvedValueOnce({ ebayItemId: "456" });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>123</ItemID><Quantity>1</Quantity></Item></GetItemResponse>'))
    .mockResolvedValueOnce(new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>456</ItemID><SellingStatus><ListingStatus>Active</ListingStatus></SellingStatus><Variations><Variation><SKU>other</SKU><Quantity>1</Quantity></Variation></Variations></Item></GetItemResponse>'));
  vi.stubGlobal("fetch", fetchMock);
  await expect(ensureEbayUnlinkedSalesHold("admin", "123")).rejects.toThrow("상품번호 연결");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
