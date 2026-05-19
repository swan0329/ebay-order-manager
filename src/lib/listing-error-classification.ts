export type ListingErrorCategory =
  | "image"
  | "policy"
  | "category"
  | "price_stock"
  | "auth"
  | "duplicate"
  | "temporary"
  | "promoted"
  | "validation"
  | "unknown";

export type ListingErrorClassification = {
  category: ListingErrorCategory;
  label: string;
  description: string;
  action: string;
};

type ListingErrorInput = {
  message?: string | null;
  rawError?: unknown;
  validation?: unknown;
};

const classifications: Record<ListingErrorCategory, ListingErrorClassification> = {
  image: {
    category: "image",
    label: "이미지",
    description: "이미지 URL, 접근 권한, 형식 문제로 보입니다.",
    action: "image_urls가 비어 있지 않은지, URL이 https로 열리는지 확인하세요.",
  },
  policy: {
    category: "policy",
    label: "정책/위치",
    description: "결제, 배송, 반품 정책 또는 재고 위치 설정 문제로 보입니다.",
    action: "payment/fulfillment/return policy ID와 merchant location key를 다시 확인하세요.",
  },
  category: {
    category: "category",
    label: "카테고리/상세",
    description: "카테고리 ID, condition, item specifics 누락 문제로 보입니다.",
    action: "category_id와 필수 item_specifics_json 값을 검증 후 다시 업로드하세요.",
  },
  price_stock: {
    category: "price_stock",
    label: "가격/재고",
    description: "가격, 수량, 통화 또는 offer 재고 조건 문제로 보입니다.",
    action: "price, quantity, currency 값이 eBay 허용 범위인지 확인하세요.",
  },
  auth: {
    category: "auth",
    label: "인증/권한",
    description: "eBay 연결, 토큰, 권한 범위 문제로 보입니다.",
    action: "eBay 계정 연결 상태와 권한을 확인한 뒤 다시 시도하세요.",
  },
  duplicate: {
    category: "duplicate",
    label: "중복/리스팅",
    description: "이미 존재하는 SKU, offer, listing과 충돌한 것으로 보입니다.",
    action: "기존 eBay item/offer ID 연결 여부를 확인하고 수정 업로드로 전환하세요.",
  },
  temporary: {
    category: "temporary",
    label: "일시 오류",
    description: "eBay API, 네트워크, rate limit 같은 일시 오류로 보입니다.",
    action: "잠시 후 실패 재시도를 실행하세요.",
  },
  promoted: {
    category: "promoted",
    label: "광고",
    description: "Promoted Listings 캠페인 또는 광고율 문제로 보입니다.",
    action: "campaign ID, 광고 권한, ad rate를 확인하세요.",
  },
  validation: {
    category: "validation",
    label: "검증",
    description: "업로드 전 검증에서 필수값 누락이 감지된 것으로 보입니다.",
    action: "검증 실패 항목을 먼저 채운 뒤 다시 검증하세요.",
  },
  unknown: {
    category: "unknown",
    label: "기타",
    description: "정확한 원인을 자동 분류하지 못했습니다.",
    action: "원문 오류와 eBay 오류 상세를 확인하세요.",
  },
};

const categoryPatterns: Array<[ListingErrorCategory, RegExp]> = [
  [
    "auth",
    /unauthori[sz]ed|oauth|token|access denied|permission|scope|403|401|not allowed|privilege|권한|인증/i,
  ],
  [
    "image",
    /image|picture|photo|image_urls|eps|url|https|media|thumbnail|사진|이미지/i,
  ],
  [
    "policy",
    /policy|payment|fulfillment|return|merchant location|location key|shipping|business polic|배송|결제|반품|위치/i,
  ],
  [
    "category",
    /category|aspect|item specific|item_specific|condition|taxonomy|required field|specifics|카테고리|상세|필수/i,
  ],
  [
    "price_stock",
    /price|quantity|inventory|availability|currency|offer price|minimum offer|stock|가격|수량|재고|통화/i,
  ],
  [
    "duplicate",
    /duplicate|already exists|already active|conflict|sku|offer already|listing already|inventory item|중복|이미/i,
  ],
  [
    "promoted",
    /promoted|campaign|advertising|ad rate|marketing|광고|캠페인/i,
  ],
  [
    "temporary",
    /timeout|timed out|rate limit|throttl|temporar|service unavailable|internal server|bad gateway|gateway|429|500|502|503|504|network|일시/i,
  ],
  [
    "validation",
    /validation|validate|required|missing|invalid|검증|누락|유효하지/i,
  ],
];

export function classifyListingError(
  input: ListingErrorInput,
): ListingErrorClassification | null {
  const text = [
    input.message,
    stringifyErrorInput(input.validation),
    stringifyErrorInput(input.rawError),
  ]
    .filter(Boolean)
    .join("\n");

  if (!text.trim()) {
    return null;
  }

  const match = categoryPatterns.find(([, pattern]) => pattern.test(text));

  return classifications[match?.[0] ?? "unknown"];
}

function stringifyErrorInput(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(stringifyErrorInput).filter(Boolean).join("\n");
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${stringifyErrorInput(entry)}`)
      .filter((entry) => entry.trim() !== ":")
      .join("\n");
  }

  return "";
}
