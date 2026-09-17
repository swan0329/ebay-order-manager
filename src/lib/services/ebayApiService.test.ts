import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getValidAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ebay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ebay")>()),
  getValidAccessToken: getValidAccessTokenMock,
}));
vi.mock("@/lib/env", () => ({
  getEbayConfig: () => ({
    hosts: { api: "https://api.ebay.com" },
  }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/safe-log", () => ({ safeLog: vi.fn() }));

import { ebayApiRequest } from "@/lib/services/ebayApiService";

describe("eBay Inventory API 요청", () => {
  it.each([25001,25604])("HTTP 400 일시적 오류 %s도 멱등 카드 PUT에 한해 재시도한다", async (errorId) => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ errorId, message: 'Availability not found. Please try again' }] }), { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = ebayApiRequest({} as never, { method: "PUT", path: "/sell/inventory/v1/inventory_item/15316", body: {} });
    await vi.runAllTimersAsync(); await result;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.restoreAllMocks();
    getValidAccessTokenMock.mockResolvedValue("access-token");
  });

  it("eBay가 허용하는 Accept-Language 값을 모든 요청에 명시한다", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ offers: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await ebayApiRequest({} as never, {
      path: "/sell/inventory/v1/offer",
      query: { sku: "276627" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({ "accept-language": "en-US" }),
      }),
    );
  });
  it("카드 PUT의 일시적 500 응답은 같은 SKU와 본문으로 재시도한다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = ebayApiRequest({} as never, { method: 'PUT', path: '/sell/inventory/v1/inventory_item/82539', body: { product: { title: 'Card' } } });
    await vi.runAllTimersAsync();
    expect((await result).status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe(String(fetchMock.mock.calls[1][0]));
    expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
    expect(fetchMock.mock.calls[0][1]?.method).toBe(fetchMock.mock.calls[1][1]?.method);
  });
  it("게시 POST의 불확실한 응답은 자동으로 중복 전송하지 않는다", async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(ebayApiRequest({} as never, { method: 'POST', path: '/sell/inventory/v1/offer/publish_by_inventory_item_group' })).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("계속 실패하면 세 번에서 멈추고 실제 카드 번호를 남긴다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 500 }));
    const result = expect(ebayApiRequest({} as never, { method: 'PUT', path: '/sell/inventory/v1/inventory_item/82539' })).rejects.toMatchObject({ status: 500, diagnostics: { inventorySku: '82539' } });
    await vi.runAllTimersAsync();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
