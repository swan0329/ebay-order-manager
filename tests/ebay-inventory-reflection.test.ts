import { expect, it, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ebay-out-of-stock", () => ({ ensureEbayOutOfStockControl: vi.fn().mockResolvedValue(undefined) }));
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/ebayApiService", () => ({ ebayApiRequest: request }));
vi.mock("@/lib/ebay", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("test-token"), EbayApiError: class extends Error {} }));
vi.mock("@/lib/env", () => ({ getEbayConfig: () => ({ hosts: { api: "https://example.com" } }) }));
import { reflectEbayInventoryTarget, ebayTargetMatchesGetItem } from "@/lib/ebay-inventory-reflection";
import type { EbayAccount } from "@/generated/prisma";
const account = {} as EbayAccount;
const target = { productId: "p", sku: "s", itemId: "i", productName: "Card", quantity: 0 };
beforeEach(() => { request.mockReset(); vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response('<GetItemResponse><Ack>Success</Ack><Item><ItemID>i</ItemID><SKU>s</SKU><Quantity>0</Quantity></Item></GetItemResponse>'))); });
afterEach(() => vi.unstubAllGlobals());
it("sets both inventory stock and exact offer stock to zero without replacing price or images", async () => {
 request.mockResolvedValueOnce({body:{offers:[{sku:"s",offerId:"o",status:"PUBLISHED",listing:{listingId:"i"}}]}})
 .mockResolvedValueOnce({body:{responses:[{sku:"s",statusCode:200}]}});
 await reflectEbayInventoryTarget(account,target);
 expect(request.mock.calls[1][1].body).toEqual({requests:[{sku:"s",shipToLocationAvailability:{quantity:0},offers:[{offerId:"o",availableQuantity:0}]}]});
});
it("requires real GetItem price and remaining quantity, including exact variation identity", () => {
 const expected = { ...target, quantity: 1, price: "12", useSku: true };
 const item = { ItemID: "i", Variations: { Variation: [{ SKU: "s", Quantity: "3", SellingStatus: { QuantitySold: "2" }, StartPrice: { "#text": "12", "@_currencyID": "USD" } }] } };
 expect(ebayTargetMatchesGetItem(item, expected)).toBe(true);
 expect(ebayTargetMatchesGetItem(item, { ...expected, price: "20" })).toBe(false);
 expect(ebayTargetMatchesGetItem(item, { ...expected, sku: "other" })).toBe(false);
 expect(ebayTargetMatchesGetItem(item, { ...expected, quantity: 3 })).toBe(false);
 expect(ebayTargetMatchesGetItem(item, { ...expected, useSku: false })).toBe(false);
 expect(ebayTargetMatchesGetItem({ ...item, SellingStatus: { ListingStatus: "Completed" } }, expected)).toBe(false);
 expect(ebayTargetMatchesGetItem({ ItemID: "i", SKU: "s", Quantity: "" }, target)).toBe(false);
});
it("supports exact ItemID-managed singles with an empty SKU and validates their current USD price", () => {
 const item = { ItemID: "i", Quantity: "1", SellingStatus: { CurrentPrice: { "#text": "12.8", "@_currencyID": "USD" } } };
 expect(ebayTargetMatchesGetItem(item, { ...target, useSku: false, price: "12", quantity: 1 })).toBe(false);
 expect(ebayTargetMatchesGetItem(item, { ...target, useSku: false, price: "12.8", quantity: 1 })).toBe(true);
});
it("does not mark a successful Inventory acknowledgment complete when GetItem disagrees", async () => {
 request.mockResolvedValueOnce({body:{offers:[{sku:"s",offerId:"o",status:"PUBLISHED",listing:{listingId:"i"}}]}})
 .mockResolvedValueOnce({body:{responses:[{sku:"s",statusCode:200}]}});
 request.mockResolvedValueOnce({body:{offers:[{sku:"s",offerId:"o",status:"PUBLISHED",listing:{listingId:"i"}}]}})
 .mockResolvedValueOnce({body:{responses:[{sku:"s",statusCode:200}]}});
 await expect(reflectEbayInventoryTarget(account, { ...target, quantity: 1, price: "12" })).rejects.toThrow("실제 판매 가격·수량");
 expect(fetch).toHaveBeenCalledTimes(4);
 expect(request.mock.calls.at(-1)?.[1].body.requests[0].offers[0]).toEqual({offerId:"o",availableQuantity:0});
});
it("does not write to a different listing even when SKU matches", async () => {
 request.mockResolvedValueOnce({body:{offers:[{sku:"s",offerId:"o",status:"PUBLISHED",listing:{listingId:"other"}}]}});
 await expect(reflectEbayInventoryTarget(account,target)).rejects.toThrow();
 expect(request.mock.calls.every(call => !call[1].method)).toBe(true);
});
it("treats per-SKU rejection inside HTTP 200 as failure", async () => {
 request.mockResolvedValueOnce({body:{offers:[{sku:"s",offerId:"o",status:"PUBLISHED",listing:{listingId:"i"}}]}})
 .mockResolvedValueOnce({body:{responses:[{sku:"s",statusCode:400}]}});
 await expect(reflectEbayInventoryTarget(account,{...target,quantity:2,price:"40.40"})).rejects.toThrow();
 expect(request.mock.calls[1][1].body.requests[0].offers[0].price).toEqual({value:"40.40",currency:"USD"});
});
