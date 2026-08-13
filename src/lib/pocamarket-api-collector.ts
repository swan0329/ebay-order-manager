export type PocamarketApiConfig = {
  productUrlTemplate: string;
  productUrlTemplates?: string[];
  headers: Record<string, string>;
  pricePath: string;
  soldOutPath: string;
  responseMode: "CARD_SELL_LIST" | "PATHS";
  minDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
  baseBackoffMs: number;
  requestTimeoutMs?: number;
};

export type PocamarketProductState = {
  price: number;
  isSoldOut: boolean;
  availableCount: number | null;
  adapter?: string;
};

export class PocamarketBlockingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PocamarketBlockingError";
  }
}

export class PocamarketSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PocamarketSchemaError";
  }
}

function positiveInteger(name: string, value: string | undefined, fallback: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name}은 0 이상의 정수여야 합니다.`);
  }
  return parsed;
}

export function loadPocamarketApiConfig(
  env: Record<string, string | undefined> = process.env,
): PocamarketApiConfig {
  const minDelayMs = positiveInteger(
    "POCAMARKET_MIN_DELAY_MS",
    env.POCAMARKET_MIN_DELAY_MS,
    1000,
  );
  const maxDelayMs = positiveInteger(
    "POCAMARKET_MAX_DELAY_MS",
    env.POCAMARKET_MAX_DELAY_MS,
    3000,
  );
  if (maxDelayMs < minDelayMs) {
    throw new Error(
      "POCAMARKET_MAX_DELAY_MS는 POCAMARKET_MIN_DELAY_MS 이상이어야 합니다.",
    );
  }

  let headers: Record<string, string>;
  try {
    const parsed = JSON.parse(env.POCAMARKET_API_HEADERS_JSON?.trim() || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error();
    }
    headers = Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)]),
    );
  } catch {
    throw new Error(
      "POCAMARKET_API_HEADERS_JSON은 헤더 객체 형태의 올바른 JSON이어야 합니다.",
    );
  }

  const productUrlTemplate =
    env.POCAMARKET_PRODUCT_URL_TEMPLATE?.trim() ||
    "https://phocamarket.com/card/v2/{pocamarket_id}/sell";
  if (!productUrlTemplate.includes("{pocamarket_id}")) {
    throw new Error(
      "POCAMARKET_PRODUCT_URL_TEMPLATE에 {pocamarket_id}가 필요합니다.",
    );
  }

  let productUrlTemplates = [productUrlTemplate];
  if (env.POCAMARKET_PRODUCT_URL_TEMPLATES_JSON?.trim()) {
    try {
      const parsed = JSON.parse(env.POCAMARKET_PRODUCT_URL_TEMPLATES_JSON);
      if (
        !Array.isArray(parsed) ||
        !parsed.length ||
        parsed.some(
          (value) =>
            typeof value !== "string" || !value.includes("{pocamarket_id}"),
        )
      ) {
        throw new Error();
      }
      productUrlTemplates = [...new Set(parsed.map((value) => value.trim()))];
    } catch {
      throw new Error(
        "POCAMARKET_PRODUCT_URL_TEMPLATES_JSON은 상품번호 자리표시자가 있는 URL 배열이어야 합니다.",
      );
    }
  }

  const responseMode = env.POCAMARKET_RESPONSE_MODE?.trim() || "CARD_SELL_LIST";
  if (responseMode !== "CARD_SELL_LIST" && responseMode !== "PATHS") {
    throw new Error(
      "POCAMARKET_RESPONSE_MODE는 CARD_SELL_LIST 또는 PATHS여야 합니다.",
    );
  }

  return {
    productUrlTemplate,
    productUrlTemplates,
    headers,
    pricePath: env.POCAMARKET_PRICE_PATH?.trim() || "data.price",
    soldOutPath:
      env.POCAMARKET_SOLD_OUT_PATH?.trim() || "data.is_sold_out",
    responseMode,
    minDelayMs,
    maxDelayMs,
    maxRetries: positiveInteger(
      "POCAMARKET_MAX_RETRIES",
      env.POCAMARKET_MAX_RETRIES,
      0,
    ),
    baseBackoffMs: positiveInteger(
      "POCAMARKET_BASE_BACKOFF_MS",
      env.POCAMARKET_BASE_BACKOFF_MS,
      2000,
    ),
    requestTimeoutMs: positiveInteger(
      "POCAMARKET_REQUEST_TIMEOUT_MS",
      env.POCAMARKET_REQUEST_TIMEOUT_MS,
      3_000,
    ),
  };
}

export function valueAtPath(input: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[segment];
  }, input);
}

function sellRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") {
    throw new PocamarketSchemaError(
      "포카마켓 판매 목록 응답이 객체 또는 배열이 아닙니다.",
    );
  }
  const objectPayload = payload as { results?: unknown; data?: unknown };
  if (Array.isArray(objectPayload.results)) return objectPayload.results;
  if (Array.isArray(objectPayload.data)) return objectPayload.data;
  if (
    objectPayload.data &&
    typeof objectPayload.data === "object" &&
    Array.isArray((objectPayload.data as { results?: unknown }).results)
  ) {
    return (objectPayload.data as { results: unknown[] }).results;
  }
  throw new PocamarketSchemaError(
    "포카마켓 응답에서 판매 목록을 찾지 못했습니다. API 구조 변경 가능성이 있습니다.",
  );
}

export function parsePocamarketProductState(
  payload: unknown,
  config: Pick<
    PocamarketApiConfig,
    "pricePath" | "soldOutPath" | "responseMode"
  >,
): PocamarketProductState {
  if (config.responseMode === "CARD_SELL_LIST") {
    const results = sellRows(payload);
    if (!results.length) {
      return { price: 0, isSoldOut: true, availableCount: 0 };
    }
    const parsed = results.map((item) => {
      const row =
        item && typeof item === "object"
          ? (item as {
              price?: unknown;
              sale_price?: unknown;
              same_count?: unknown;
              count?: unknown;
              quantity?: unknown;
            })
          : {};
      return {
        price: Number(row.price ?? row.sale_price),
        count: Number(row.same_count ?? row.count ?? row.quantity ?? 1),
      };
    });
    if (
      parsed.some(
        (row) =>
          !Number.isFinite(row.price) ||
          row.price <= 0 ||
          !Number.isInteger(row.count) ||
          row.count <= 0,
      )
    ) {
      throw new PocamarketSchemaError(
        "포카마켓 판매 목록의 가격 또는 수량 형식이 변경되었습니다.",
      );
    }
    return {
      price: Math.min(...parsed.map((row) => row.price)),
      isSoldOut: false,
      availableCount: parsed.reduce((sum, row) => sum + row.count, 0),
    };
  }

  const price = Number(valueAtPath(payload, config.pricePath));
  const soldOutValue = valueAtPath(payload, config.soldOutPath);
  if (!Number.isFinite(price) || price < 0) {
    throw new PocamarketSchemaError(
      `가격 응답 필드(${config.pricePath}) 형식이 변경되었습니다.`,
    );
  }
  if (typeof soldOutValue !== "boolean") {
    throw new PocamarketSchemaError(
      `품절 응답 필드(${config.soldOutPath}) 형식이 변경되었습니다.`,
    );
  }
  return {
    price,
    isSoldOut: soldOutValue,
    availableCount: soldOutValue ? 0 : null,
  };
}

export function randomDelayMs(
  minDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
) {
  return Math.floor(
    minDelayMs + random() * (maxDelayMs - minDelayMs + 1),
  );
}

export function backoffDelayMs(baseBackoffMs: number, attempt: number) {
  return baseBackoffMs * 2 ** attempt;
}

function withAdapter(
  state: PocamarketProductState,
  adapter: string,
): PocamarketProductState {
  Object.defineProperty(state, "adapter", {
    value: adapter,
    enumerable: false,
  });
  return state;
}

export async function fetchPocamarketProductState(
  pocamarketId: string,
  config: PocamarketApiConfig,
  dependencies: {
    fetch?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<PocamarketProductState> {
  if (
    config.responseMode === "CARD_SELL_LIST" &&
    !/^\d+$/.test(pocamarketId)
  ) {
    throw new Error("포카마켓 카드 ID는 숫자여야 합니다.");
  }
  const request = dependencies.fetch ?? fetch;
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const templates = config.productUrlTemplates?.length
    ? config.productUrlTemplates
    : [config.productUrlTemplate];
  let lastError: unknown = null;

  for (const [templateIndex, template] of templates.entries()) {
    const url = template.replace(
      "{pocamarket_id}",
      encodeURIComponent(pocamarketId),
    );
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await request(url, {
          headers: config.headers,
          signal: AbortSignal.timeout(config.requestTimeoutMs ?? 10_000),
        });
      } catch (error) {
        lastError = error;
        if (attempt < config.maxRetries) {
          await sleep(backoffDelayMs(config.baseBackoffMs, attempt));
          continue;
        }
        break;
      }

      if (response.ok) {
        try {
          return withAdapter(
            parsePocamarketProductState(await response.json(), config),
            config.responseMode === "CARD_SELL_LIST"
              ? `SELL_LIST_V${templateIndex + 1}`
              : `PATHS_V${templateIndex + 1}`,
          );
        } catch (error) {
          lastError = error;
          if (
            error instanceof PocamarketSchemaError &&
            templateIndex < templates.length - 1
          ) {
            break;
          }
          throw error;
        }
      }

      if (response.status === 401 || response.status === 403) {
        await sleep(backoffDelayMs(config.baseBackoffMs, attempt));
        throw new PocamarketBlockingError(
          "포카마켓 인증 또는 접근이 거부되어 안전하게 중단합니다.",
          response.status,
        );
      }
      if (response.status === 429) {
        if (attempt >= config.maxRetries) {
          throw new PocamarketBlockingError(
            "포카마켓 요청 제한이 계속되어 수집을 중단합니다.",
            429,
          );
        }
        await sleep(backoffDelayMs(config.baseBackoffMs, attempt));
        continue;
      }
      if (response.status === 404 && templateIndex < templates.length - 1) {
        lastError = new Error(`포카마켓 조회 경로 없음(HTTP 404): ${url}`);
        break;
      }
      if (response.status >= 500 && attempt < config.maxRetries) {
        await sleep(backoffDelayMs(config.baseBackoffMs, attempt));
        continue;
      }
      throw new Error(`포카마켓 상품 조회 실패(HTTP ${response.status})`);
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("포카마켓 상품 조회 재시도 횟수를 초과했습니다.");
}
