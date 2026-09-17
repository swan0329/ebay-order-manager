import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/ebayApiService", () => ({ ebayApiRequest: request }));
vi.mock("@/lib/ebay-out-of-stock", () => ({ ensureEbayOutOfStockControl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/ebay", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("test"), EbayApiError: class extends Error {} }));
vi.mock("@/lib/env", () => ({ getEbayConfig: () => ({ hosts: { api: "https://example.test" } }) }));
import { reflectEbayInventoryTarget } from "@/lib/ebay-inventory-reflection";
const target = { productId: "p", itemId: "i", sku: "296333", productName: "Card", price: "47.90", quantity: 1, useSku: true };
let price: string, quantity: number, ignoredPrice: boolean, failRelease: boolean, failHold: boolean, legacy: boolean;
let events: string[];
beforeEach(() => {
  price = "10.60"; quantity = 1; ignoredPrice = failRelease = failHold = legacy = false; events = [];
  request.mockReset().mockImplementation(async (_account, input) => {
    if (!input.method) return { body: { offers: legacy ? [] : [{ sku: "296333", offerId: "o", status: "PUBLISHED", listing: { listingId: "i" } }] } };
    const row = input.body.requests[0];
    expect(row.sku).toBe("296333"); expect(row.offers[0].offerId).toBe("o");
    const value = row.offers[0].price?.value;
    events.push(`write:${row.offers[0].availableQuantity}:${value ?? "keep"}`);
    if (failHold && row.offers[0].availableQuantity === 0 || failRelease && row.offers[0].availableQuantity > 0) throw new Error("injected outage");
    quantity = row.offers[0].availableQuantity;
    expect(row.shipToLocationAvailability.quantity).toBe(quantity);
    if (value && !ignoredPrice) price = value;
    return { body: { responses: [{ sku: "296333", statusCode: 200 }] } };
  });
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
    const name = (init.headers as Record<string,string>)["X-EBAY-API-CALL-NAME"];
    if (name === "ReviseInventoryStatus") {
      const body = String(init.body);
      expect(body).toContain("<ItemID>i</ItemID><SKU>296333</SKU>");
      quantity = Number(body.match(/<Quantity>(\d+)<\/Quantity>/)?.[1]);
      const changed = body.match(/<StartPrice currencyID="USD">([^<]+)<\/StartPrice>/)?.[1];
      events.push(`write:${quantity}:${changed ?? "keep"}`);
      if (changed && !ignoredPrice) price = changed;
      return new Response("<ReviseInventoryStatusResponse><Ack>Success</Ack></ReviseInventoryStatusResponse>");
    }
    events.push(`read:${quantity}:${price}`);
    return new Response(`<GetItemResponse><Ack>Success</Ack><Item><ItemID>i</ItemID><Variations><Variation><SKU>296333</SKU><Quantity>${quantity}</Quantity><StartPrice currencyID="USD">${price}</StartPrice></Variation><Variation><SKU>other</SKU><Quantity>5</Quantity><StartPrice currencyID="USD">100</StartPrice></Variation></Variations></Item></GetItemResponse>`);
  }));
});
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])("verifies the price with zero stock before restoring only the exact option (legacy=%s)", async isLegacy => {
  legacy = isLegacy;
  await expect(reflectEbayInventoryTarget({} as never, target)).resolves.toMatchObject({ legacy: isLegacy });
  expect(events.indexOf("read:0:47.90")).toBeLessThan(events.indexOf("write:1:47.90"));
  expect(events.at(-1)).toBe("read:1:47.90");
});
it("successful acknowledgment with unchanged low price cannot restore stock", async () => {
  ignoredPrice = true;
  await expect(reflectEbayInventoryTarget({} as never, target)).rejects.toThrow("수량 0 확인 완료");
  expect(quantity).toBe(0);
  expect(events.some(event => event.startsWith("write:1:"))).toBe(false);
});
it("a failed stock release re-holds and verifies zero without claiming success", async () => {
  failRelease = true;
  await expect(reflectEbayInventoryTarget({} as never, target)).rejects.toThrow("수량 0 확인 완료");
  expect(events.at(-1)).toBe("read:0:47.90");
});
it("a failed emergency hold is explicitly unverified, never reported as held", async () => {
  failHold = true;
  await expect(reflectEbayInventoryTarget({} as never, target)).rejects.toThrow("판매 보류 미확인");
  expect(quantity).toBe(1);
});
