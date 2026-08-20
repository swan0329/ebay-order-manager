import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ebay", () => ({ getValidAccessToken: vi.fn(async () => "token-1") }));
vi.mock("@/lib/env", () => ({ getEbayConfig: () => ({ hosts: { api: "https://api.ebay.test" } }) }));

const { endEbayListing } = await import("@/lib/services/ebayEndListing");

afterEach(() => vi.unstubAllGlobals());

describe("eBay listing ending", () => {
  it("uses OAuth and the explicit NotAvailable reason", async () => {
    const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
      void args;
      return new Response("<EndFixedPriceItemResponse><Ack>Success</Ack></EndFixedPriceItemResponse>");
    });
    vi.stubGlobal("fetch", fetchMock);
    await endEbayListing({ id: "account-1" } as never, "123456789");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("X-EBAY-API-IAF-TOKEN")).toBe("token-1");
    expect(String(init.body)).toContain("<ItemID>123456789</ItemID>");
    expect(String(init.body)).toContain("<EndingReason>NotAvailable</EndingReason>");
  });

  it("treats an eBay failure acknowledgement as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<EndFixedPriceItemResponse><Ack>Failure</Ack><LongMessage>Already ended</LongMessage></EndFixedPriceItemResponse>")));
    await expect(endEbayListing({ id: "account-1" } as never, "123")).rejects.toThrow("Already ended");
  });
});
