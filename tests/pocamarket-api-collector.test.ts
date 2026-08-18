import { describe, expect, it, vi } from "vitest";
import {
  backoffDelayMs,
  fetchPocamarketProductState,
  loadPocamarketApiConfig,
  parsePocamarketProductState,
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
      responseMode: "CARD_DETAIL_COLLECTION",
      minDelayMs: 1000,
      maxDelayMs: 3000,
      headers: { Authorization: "Bearer secret" },
    });
  });

  it("uses the verified card detail endpoint without secrets by default", () => {
    // 조달 창구가 빠른구매이므로 기본 주소도 빠른구매 가격이 들어 있는 카드 상세다.
    expect(loadPocamarketApiConfig({})).toMatchObject({
      productUrlTemplate: "https://phocamarket.com/card/v2/{pocamarket_id}",
      headers: {},
      responseMode: "CARD_DETAIL_COLLECTION",
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

describe("빠른구매(CARD_DETAIL_COLLECTION) 기준 수집", () => {
  const detailConfig = {
    pricePath: "data.price",
    soldOutPath: "data.is_sold_out",
    responseMode: "CARD_DETAIL_COLLECTION" as const,
  };

  // 실제 포카마켓 카드 상세 응답(카드 3150)에서 확인한 필드 구성이다.
  const detail = {
    name: "I am NOT",
    get_matching_price: 6000,
    get_lowest_sell_price: 10000,
    get_highest_buy_price: 7000,
    get_collection_transaction_price: 19000,
    get_collection_lowest_sell_offer_price: 20000,
    get_collection_count: 8,
    is_exists_collection: true,
  };

  it("1:1 최저가가 아니라 빠른구매 최저가와 재고를 읽는다", () => {
    // 1:1 최저가 10,000원으로는 살 수 없다. 우리가 결제하는 값은 20,000원이다.
    expect(parsePocamarketProductState(detail, detailConfig)).toEqual({
      price: 20000,
      isSoldOut: false,
      availableCount: 8,
    });
  });

  it("data로 감싸 온 응답도 읽는다", () => {
    expect(parsePocamarketProductState({ data: detail }, detailConfig)).toEqual({
      price: 20000,
      isSoldOut: false,
      availableCount: 8,
    });
  });

  it("빠른구매 물건이 없으면 1:1에 물건이 있어도 품절로 본다", () => {
    // 1:1로는 살 수 있어도 우리 조달 창구로는 살 수 없다. 팔 수 있다고 하면 안 된다.
    expect(
      parsePocamarketProductState(
        { ...detail, get_collection_count: 0, get_collection_lowest_sell_offer_price: null },
        detailConfig,
      ),
    ).toEqual({ price: 0, isSoldOut: true, availableCount: 0 });
  });

  it("빠른구매 재고가 있는데 가격이 비면 품절로 본다", () => {
    expect(
      parsePocamarketProductState(
        { ...detail, get_collection_lowest_sell_offer_price: null },
        detailConfig,
      ),
    ).toEqual({ price: 0, isSoldOut: true, availableCount: 0 });
  });

  it("재고 수량 형식이 바뀌면 조용히 넘어가지 않고 알린다", () => {
    expect(() =>
      parsePocamarketProductState({ ...detail, get_collection_count: "여덟" }, detailConfig),
    ).toThrow(PocamarketSchemaError);
  });

  it("빠른구매 정보가 아예 없는 응답은 거절한다", () => {
    expect(() =>
      parsePocamarketProductState({ name: "I am NOT", price: 10000 }, detailConfig),
    ).toThrow(PocamarketSchemaError);
  });

  it("설정 없이도 빠른구매 기준과 카드 상세 주소를 기본으로 쓴다", () => {
    const loaded = loadPocamarketApiConfig({});
    expect(loaded.responseMode).toBe("CARD_DETAIL_COLLECTION");
    expect(loaded.productUrlTemplate).toBe(
      "https://phocamarket.com/card/v2/{pocamarket_id}",
    );
  });

  it("예전 1:1 목록 방식을 켜면 그 주소를 그대로 쓴다", () => {
    const loaded = loadPocamarketApiConfig({ POCAMARKET_RESPONSE_MODE: "CARD_SELL_LIST" });
    expect(loaded.productUrlTemplate).toBe(
      "https://phocamarket.com/card/v2/{pocamarket_id}/sell",
    );
  });
});
