import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  getEbayConfig: () => ({ hosts: { api: "https://api.ebay.test" }, environment: "production" }),
}));
vi.mock("@/lib/ebay", () => ({ getValidAccessToken: async () => "token-1" }));
vi.mock("@/lib/safe-log", () => ({ safeLog: () => {} }));

const { reviseEbayPriceQuantity } = await import("@/lib/services/ebayRevise");

const account = { id: "a" } as never;
const ok = `<?xml version="1.0"?><ReviseInventoryStatusResponse><Ack>Success</Ack></ReviseInventoryStatusResponse>`;
const warned = `<ReviseInventoryStatusResponse><Ack>Warning</Ack><Errors><SeverityCode>Warning</SeverityCode><LongMessage>가격이 반올림되었습니다.</LongMessage></Errors></ReviseInventoryStatusResponse>`;
const failed = `<ReviseInventoryStatusResponse><Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><LongMessage>Item not found.</LongMessage></Errors></ReviseInventoryStatusResponse>`;

function mockXml(body: string, status = 200) {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("eBay 가격·수량 변경", () => {
  it("OAuth 토큰을 전용 헤더로 보내고 자격 정보를 본문에 넣지 않는다", async () => {
    const fetchMock = mockXml(ok);
    await reviseEbayPriceQuantity(account, [{ itemId: "1", sku: "A", quantity: 2, price: 3.5 }]);

    const [url, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(url).toBe("https://api.ebay.test/ws/api.dll");
    expect(headers["X-EBAY-API-IAF-TOKEN"]).toBe("token-1");
    expect(headers["X-EBAY-API-CALL-NAME"]).toBe("ReviseInventoryStatus");
    expect(String((init as RequestInit).body)).not.toContain("RequesterCredentials");
  });

  it("수량과 가격을 형식에 맞게 담는다", async () => {
    const fetchMock = mockXml(ok);
    await reviseEbayPriceQuantity(account, [{ itemId: "1", sku: "A", quantity: 2.7, price: 3.5 }]);
    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain("<ItemID>1</ItemID>");
    expect(body).toContain("<SKU>A</SKU>");
    // 수량은 정수여야 한다.
    expect(body).toContain("<Quantity>2</Quantity>");
    expect(body).toContain("<StartPrice>3.50</StartPrice>");
  });

  it("바꾸지 않을 값은 아예 보내지 않는다", async () => {
    // 가격을 비운 채 보내면 eBay가 값을 지우거나 거부할 수 있다.
    const fetchMock = mockXml(ok);
    await reviseEbayPriceQuantity(account, [{ itemId: "1", quantity: 0, price: null }]);
    const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain("<Quantity>0</Quantity>");
    expect(body).not.toContain("StartPrice");
    expect(body).not.toContain("<SKU>");
  });

  it("한 번에 네 건까지만 보낸다", async () => {
    const fetchMock = mockXml(ok);
    const targets = Array.from({ length: 9 }, (_, index) => ({
      itemId: String(index),
      quantity: 1,
    }));
    const result = await reviseEbayPriceQuantity(account, targets);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.succeeded).toHaveLength(9);
  });

  it("경고만 있으면 성공으로 본다", async () => {
    // 경고를 실패로 처리하면 실제로 반영된 것을 실패라고 보고하게 된다.
    mockXml(warned);
    const result = await reviseEbayPriceQuantity(account, [{ itemId: "1", quantity: 1 }]);
    expect(result.succeeded).toEqual(["1"]);
    expect(result.failed).toEqual([]);
  });

  it("옵션은 전송 후 eBay 실제 가격과 수량이 일치해야 성공으로 본다", async () => {
    const getItem = `<GetItemResponse><Ack>Success</Ack><Item><Variations><Variation><SKU>A</SKU><StartPrice>8.40</StartPrice><Quantity>2</Quantity></Variation></Variations></Item></GetItemResponse>`;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(ok, { status: 200 }))
      .mockResolvedValueOnce(new Response(getItem, { status: 200 })));
    const result = await reviseEbayPriceQuantity(account, [{ itemId: "1", sku: "A", quantity: 2, price: 8.4 }]);
    expect(result.succeeded).toEqual(["1:A"]);
    expect(result.failed).toEqual([]);
  });

  it("eBay가 옵션 가격을 다르게 보관하면 성공으로 가장하지 않는다", async () => {
    const getItem = `<GetItemResponse><Ack>Success</Ack><Item><Variations><Variation><SKU>A</SKU><StartPrice>5.00</StartPrice><Quantity>2</Quantity></Variation></Variations></Item></GetItemResponse>`;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(ok, { status: 200 }))
      .mockResolvedValueOnce(new Response(getItem, { status: 200 })));
    const result = await reviseEbayPriceQuantity(account, [{ itemId: "1", sku: "A", quantity: 2, price: 8.4 }]);
    expect(result.succeeded).toEqual([]);
    expect(result.failed[0].reason).toContain("실제 가격 5");
  });

  it("오류는 사유를 그대로 남긴다", async () => {
    mockXml(failed);
    const result = await reviseEbayPriceQuantity(account, [{ itemId: "1", quantity: 1 }]);
    expect(result.succeeded).toEqual([]);
    expect(result.failed[0]).toMatchObject({ itemId: "1" });
    expect(result.failed[0].reason).toContain("Item not found");
  });

  it("HTTP 실패도 사유를 남기고 나머지를 계속 처리한다", async () => {
    mockXml("service unavailable", 503);
    const result = await reviseEbayPriceQuantity(account, [{ itemId: "1", quantity: 1 }]);
    expect(result.failed[0].reason).toContain("503");
  });
});
