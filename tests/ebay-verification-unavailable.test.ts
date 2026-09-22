import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/ebay", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("t"),
  EbayApiError: class extends Error { status = 0 },
}));
vi.mock("@/lib/env", () => ({ getEbayConfig: () => ({ hosts: { api: "https://api.ebay.com" } }) }));
vi.mock("@/lib/ebay-out-of-stock", () => ({ ensureEbayOutOfStockControl: vi.fn() }));
const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/ebayApiService", () => ({ ebayApiRequest: apiMock }));

import { reflectEbayInventoryTarget } from "@/lib/ebay-inventory-reflection";

afterEach(() => vi.unstubAllGlobals());

const target = { productId: "p", sku: "S1", itemId: "1", quantity: 3, price: "11.50" } as never;

// 쓰기와 확인은 서로 다른 한도를 쓴다. 확인만 막혔다고 판매를 멈추면 가게가 닫힌다.
it("확인이 호출 한도로 막히면 쓰기 결과를 믿고 판매를 되살린다", async () => {
  apiMock.mockImplementation(async (_account: unknown, input: { path: string; method?: string }) => {
    if (input.path.includes("bulk_update_price_quantity")) {
      return { body: { responses: [{ sku: "S1", statusCode: 200 }] }, headers: new Headers() };
    }
    return { body: { offers: [{ offerId: "o1", sku: "S1", listing: { listingId: "1" }, status: "PUBLISHED" }], total: 1 }, headers: new Headers() };
  });
  // GetItem은 한도 초과로 답하지 않는다.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(
    "<GetItemResponse><Ack>Failure</Ack><Errors><ErrorCode>518</ErrorCode><LongMessage>exceeded usage limit</LongMessage></Errors></GetItemResponse>",
  )));

  const result = await reflectEbayInventoryTarget({} as never, target) as { unverified?: boolean };
  expect(result.unverified).toBe(true);
});

// 답을 받았는데 값이 다른 것은 전혀 다른 상황이다. 그때는 되살리면 안 된다.
it("확인에 답이 왔는데 값이 다르면 되살리지 않는다", async () => {
  apiMock.mockImplementation(async (_account: unknown, input: { path: string }) => {
    if (input.path.includes("bulk_update_price_quantity")) {
      return { body: { responses: [{ sku: "S1", statusCode: 200 }] }, headers: new Headers() };
    }
    return { body: { offers: [{ offerId: "o1", sku: "S1", listing: { listingId: "1" }, status: "PUBLISHED" }], total: 1 }, headers: new Headers() };
  });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(
    "<GetItemResponse><Ack>Success</Ack><Item><ItemID>1</ItemID><SellingStatus><CurrentPrice currencyID=\"USD\">9.00</CurrentPrice></SellingStatus><Quantity>0</Quantity></Item></GetItemResponse>",
  )));

  await expect(reflectEbayInventoryTarget({} as never, target)).rejects.toThrow();
});
