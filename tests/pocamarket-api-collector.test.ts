import { describe, expect, it, vi } from "vitest";
import {
  backoffDelayMs,
  fetchPocamarketProductState,
  loadPocamarketApiConfig,
  PocamarketBlockingError,
  PocamarketSchemaError,
  randomDelayMs,
} from "@/lib/pocamarket-api-collector";

const config = {
  productUrlTemplate: "https://example.test/products/{pocamarket_id}",
  headers: { Authorization: "Bearer test" },
  pricePath: "data.price",
  soldOutPath: "data.is_sold_out",
  responseMode: "PATHS" as const,
  minDelayMs: 1000,
  maxDelayMs: 3000,
  maxRetries: 2,
  baseBackoffMs: 100,
};

describe("포카마켓 API 수집기", () => {
  it("환경변수의 URL, 헤더 및 응답 경로를 검증한다", () => {
    expect(loadPocamarketApiConfig({
      POCAMARKET_PRODUCT_URL_TEMPLATE: "https://example.test/{pocamarket_id}",
      POCAMARKET_API_HEADERS_JSON: '{"Authorization":"Bearer secret"}',
      POCAMARKET_PRICE_PATH: "data.price",
      POCAMARKET_SOLD_OUT_PATH: "data.is_sold_out",
    })).toMatchObject({
      productUrlTemplate: "https://example.test/{pocamarket_id}",
      responseMode: "CARD_SELL_LIST",
      minDelayMs: 1000,
      maxDelayMs: 3000,
      headers: { Authorization: "Bearer secret" },
    });
  });

  it("uses the verified domestic card sell endpoint without secrets by default", () => {
    expect(loadPocamarketApiConfig({})).toMatchObject({
      productUrlTemplate: "https://phocamarket.com/card/v2/{pocamarket_id}/sell",
      headers: {},
      responseMode: "CARD_SELL_LIST",
    });
  });

  it("uses the lowest current sell price from a card sell list", async () => {
    const cardSellConfig = { ...config, responseMode: "CARD_SELL_LIST" as const };
    const request = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        count: 3,
        results: [
          { price: 32000, same_count: 2 },
          { price: 29000, same_count: 1 },
          { price: 30000, same_count: 2 },
        ],
      }),
      { status: 200 },
    ));

    await expect(fetchPocamarketProductState("491203", cardSellConfig, { fetch: request }))
      .resolves.toEqual({ price: 29000, isSoldOut: false, availableCount: 5 });
  });

  it("treats an empty card sell list as sold out", async () => {
    const cardSellConfig = { ...config, responseMode: "CARD_SELL_LIST" as const };
    const request = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ count: 0, results: [] }),
      { status: 200 },
    ));

    await expect(fetchPocamarketProductState("491203", cardSellConfig, { fetch: request }))
      .resolves.toEqual({ price: 0, isSoldOut: true, availableCount: 0 });
  });

  it("accepts a nested fallback response shape and alternate field names", async () => {
    const cardSellConfig = { ...config, responseMode: "CARD_SELL_LIST" as const };
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { results: [{ sale_price: 17000, count: 3 }] },
        }),
        { status: 200 },
      ),
    );

    await expect(
      fetchPocamarketProductState("491203", cardSellConfig, { fetch: request }),
    ).resolves.toEqual({
      price: 17000,
      isSoldOut: false,
      availableCount: 3,
    });
  });

  it("tries the next configured endpoint after a 404", async () => {
    const cardSellConfig = {
      ...config,
      responseMode: "CARD_SELL_LIST" as const,
      productUrlTemplates: [
        "https://old.test/{pocamarket_id}",
        "https://new.test/{pocamarket_id}",
      ],
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ price: 19000, same_count: 1 }] }), {
          status: 200,
        }),
      );

    const state = await fetchPocamarketProductState("491203", cardSellConfig, {
      fetch: request,
    });
    expect(state.price).toBe(19000);
    expect(state.adapter).toBe("SELL_LIST_V2");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("classifies an unknown successful response as a schema change", async () => {
    const cardSellConfig = { ...config, responseMode: "CARD_SELL_LIST" as const };
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 }));

    await expect(
      fetchPocamarketProductState("491203", cardSellConfig, { fetch: request }),
    ).rejects.toBeInstanceOf(PocamarketSchemaError);
  });

  it("rejects a non-numeric card id before making a request", async () => {
    const request = vi.fn();
    const cardSellConfig = { ...config, responseMode: "CARD_SELL_LIST" as const };
    await expect(fetchPocamarketProductState("SKU-1", cardSellConfig, { fetch: request }))
      .rejects.toThrow("카드 ID는 숫자");
    expect(request).not.toHaveBeenCalled();
  });

  it("요청 간 지연을 지정 범위에서 선택한다", () => {
    expect(randomDelayMs(1000, 3000, () => 0)).toBe(1000);
    expect(randomDelayMs(1000, 3000, () => 0.9999)).toBe(3000);
  });

  it("상품 가격과 품절 여부를 파싱한다", async () => {
    const request = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { price: 12500, is_sold_out: false } }),
      { status: 200 },
    ));
    await expect(fetchPocamarketProductState("A/1", config, { fetch: request }))
      .resolves.toEqual({ price: 12500, isSoldOut: false, availableCount: null });
    expect(request).toHaveBeenCalledWith(
      "https://example.test/products/A%2F1",
      expect.objectContaining({ headers: config.headers }),
    );
  });

  it("429에서 지수 백오프 후 재시도한다", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ data: { price: 9000, is_sold_out: true } }),
        { status: 200 },
      ));
    const wait = vi.fn().mockResolvedValue(undefined);
    await fetchPocamarketProductState("1", config, { fetch: request, sleep: wait });
    expect(wait).toHaveBeenCalledWith(100);
    expect(backoffDelayMs(100, 2)).toBe(400);
  });

  it("403에서는 백오프 후 graceful stop용 오류를 발생시킨다", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(fetchPocamarketProductState("1", config, { fetch: request, sleep: wait }))
      .rejects.toBeInstanceOf(PocamarketBlockingError);
    expect(wait).toHaveBeenCalledWith(100);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("잘못된 응답은 해당 상품 오류로 처리할 수 있게 거부한다", async () => {
    const request = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { price: "unknown", is_sold_out: false } }),
      { status: 200 },
    ));
    await expect(fetchPocamarketProductState("1", config, { fetch: request }))
      .rejects.toThrow("가격 응답 필드");
  });
});
