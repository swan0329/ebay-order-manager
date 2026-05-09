/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Search } from "lucide-react";

type MatchProduct = {
  id: string;
  sku: string;
  productName: string;
  optionName?: string | null;
  category?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  stockQuantity: number;
};

type SuggestedMatchProduct = MatchProduct & {
  matchScore: number;
};

function productLabel(product: MatchProduct) {
  return [
    product.sku,
    product.productName,
    product.optionName,
  ].filter(Boolean).join(" · ");
}

function initialProductSearchQuery(itemSku: string | null | undefined, itemTitle: string) {
  if (itemSku?.trim()) {
    return itemSku.trim();
  }

  const title = itemTitle.toUpperCase();
  const members = [
    "BANG CHAN",
    "LEE KNOW",
    "CHANGBIN",
    "HYUNJIN",
    "HAN",
    "FELIX",
    "SEUNGMIN",
    "I.N",
  ];
  const albums = [
    "I AM NOT",
    "I AM WHO",
    "I AM YOU",
    "MIROH",
    "YELLOW WOOD",
    "LEVANTER",
    "GO LIVE",
    "IN LIFE",
    "NOEASY",
    "ODDINARY",
    "MAXIDENT",
    "5-STAR",
    "ROCK",
    "ATE",
    "KARMA",
    "DO IT",
  ];
  const member = members.find((candidate) => title.includes(candidate));
  const album = albums.find((candidate) => title.includes(candidate));

  return [album, member].filter(Boolean).join(" ");
}

function ProductImage({
  product,
  size = "h-12 w-12",
}: {
  product?: MatchProduct | null;
  size?: string;
}) {
  return (
    <div className={`${size} flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100`}>
      {product?.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={productLabel(product)}
          className="h-full w-full object-cover"
        />
      ) : (
        <ImageOff className="h-5 w-5 text-zinc-400" />
      )}
    </div>
  );
}

export function OrderItemProductMatcher({
  orderId,
  orderItemId,
  productId,
  itemSku,
  itemTitle,
  products,
  suggestedProducts = [],
  matchedBy,
  matchScore,
  disabled,
}: {
  orderId: string;
  orderItemId: string;
  productId?: string | null;
  itemSku?: string | null;
  itemTitle: string;
  products: MatchProduct[];
  suggestedProducts?: SuggestedMatchProduct[];
  matchedBy?: string | null;
  matchScore?: number | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(productId ?? "");
  const [query, setQuery] = useState(() =>
    initialProductSearchQuery(itemSku, itemTitle),
  );
  const initialResults = useMemo(() => {
    const merged = new Map<string, MatchProduct>();

    for (const product of suggestedProducts) {
      merged.set(product.id, product);
    }

    for (const product of products) {
      if (!merged.has(product.id)) {
        merged.set(product.id, product);
      }
    }

    return [...merged.values()];
  }, [products, suggestedProducts]);
  const [results, setResults] = useState<MatchProduct[]>(initialResults);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const selectedProduct = useMemo(
    () => results.find((product) => product.id === value) ??
      products.find((product) => product.id === value) ??
      null,
    [products, results, value],
  );
  const isUnmatched = !productId;
  const matchMeta = productId
    ? matchedBy === "manual"
      ? "수동 매칭"
      : matchedBy
        ? `자동 매칭: ${matchedBy}${typeof matchScore === "number" ? ` · 유사도 ${Math.round(matchScore * 100)}%` : ""}`
        : "매칭 완료"
    : typeof matchScore === "number"
      ? `수동 확인 필요 · 최고 유사도 ${Math.round(matchScore * 100)}%`
      : "수동 확인 필요";

  const searchProducts = useCallback(
    async (nextQuery = query) => {
      const trimmed = nextQuery.trim();

      if (!trimmed) {
        setResults(initialResults);
        return;
      }

      setSearching(true);
      setMessage("");
      const response = await fetch(`/api/products?q=${encodeURIComponent(trimmed)}`);
      const data = (await response.json().catch(() => null)) as
        | { products?: MatchProduct[]; error?: string }
        | null;
      setSearching(false);

      if (!response.ok) {
        setMessage(data?.error ?? "상품 검색에 실패했습니다.");
        return;
      }

      setResults(data?.products ?? []);
    },
    [initialResults, query],
  );

  useEffect(() => {
    if (!isUnmatched || !query.trim()) {
      return;
    }

    const timer = window.setTimeout(() => {
      void searchProducts(query);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isUnmatched, query, searchProducts]);

  async function save() {
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/match-product`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderItemId, productId: value || null }),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    setLoading(false);

    if (!response.ok) {
      setMessage(data?.error ?? "상품 매칭 저장에 실패했습니다.");
      return;
    }

    setMessage("상품 매칭을 저장했습니다.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {isUnmatched ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          <p className="font-semibold">수동 확인 필요</p>
          <p className="mt-0.5">
            자동 매칭 기준에 충분히 맞는 재고 상품을 확정하지 못했습니다.
          </p>
          {!itemSku ? (
            <p className="mt-0.5 font-medium">
              SKU가 비어 있어 eBay item id 매핑 또는 후보 선택이 필요합니다.
            </p>
          ) : null}
          <p className="mt-0.5 line-clamp-2" title={itemTitle}>
            {itemTitle}
          </p>
        </div>
      ) : null}

      <p className="text-xs font-medium text-zinc-600">{matchMeta}</p>

      {isUnmatched && suggestedProducts.length ? (
        <div className="rounded-md border border-amber-200 bg-white p-2">
          <p className="mb-1 text-xs font-semibold text-amber-800">
            유사 후보
          </p>
          <div className="space-y-1">
            {suggestedProducts.slice(0, 5).map((product) => (
              <button
                type="button"
                key={product.id}
                onClick={() => setValue(product.id)}
                disabled={disabled}
                className={`flex w-full items-center gap-2 rounded-md p-1.5 text-left text-xs hover:bg-zinc-50 disabled:cursor-not-allowed ${
                  value === product.id ? "bg-zinc-100 ring-1 ring-zinc-300" : ""
                }`}
              >
                <ProductImage product={product} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-zinc-900">
                    {product.sku} · {product.productName}
                  </span>
                  <span className="mt-0.5 block truncate text-zinc-500">
                    유사도 {Math.round(product.matchScore * 100)}% · 재고 {product.stockQuantity}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void searchProducts();
            }
          }}
          placeholder="SKU, 멤버, 앨범명 검색"
          disabled={disabled}
          className="h-9 min-w-0 flex-1 rounded-md border border-zinc-300 px-2 text-xs outline-none focus:border-zinc-900 disabled:bg-zinc-100"
        />
        <button
          type="button"
          onClick={() => void searchProducts()}
          disabled={searching || disabled}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
          title="상품 검색"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {selectedProduct ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
          <ProductImage product={selectedProduct} />
          <div className="min-w-0">
            <p className="truncate font-semibold" title={productLabel(selectedProduct)}>
              {productLabel(selectedProduct)}
            </p>
            <p className="mt-0.5">현재 재고 {selectedProduct.stockQuantity}</p>
          </div>
        </div>
      ) : null}

      <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1">
        {results.length ? (
          results.slice(0, 20).map((product) => (
            <button
              type="button"
              key={product.id}
              onClick={() => setValue(product.id)}
              disabled={disabled}
              className={`flex w-full items-center gap-2 rounded-md p-1.5 text-left text-xs hover:bg-zinc-50 disabled:cursor-not-allowed ${
                value === product.id ? "bg-zinc-100 ring-1 ring-zinc-300" : ""
              }`}
            >
              <ProductImage product={product} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-zinc-900">
                  {product.sku} · {product.productName}
                </span>
                <span className="mt-0.5 block truncate text-zinc-500">
                  {product.optionName || product.category || product.brand || "-"} · 재고 {product.stockQuantity}
                </span>
              </span>
            </button>
          ))
        ) : (
          <p className="px-2 py-3 text-xs text-zinc-500">검색 결과가 없습니다.</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setValue("")}
          disabled={loading || disabled || !value}
          className="h-9 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          연결 해제
        </button>
        <button
          type="button"
          onClick={save}
          disabled={loading || disabled}
          className="h-9 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          저장
        </button>
      </div>
      {message ? (
        <p className={`text-xs ${message.includes("실패") ? "text-rose-600" : "text-zinc-600"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function DeductStockButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function deduct() {
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/deduct-stock`, {
      method: "POST",
    });
    const data = (await response.json().catch(() => null)) as
      | {
          deducted?: number;
          shortages?: number;
          unmatched?: number;
          error?: string;
        }
      | null;

    setLoading(false);
    setMessage(
      response.ok
        ? `차감 ${data?.deducted ?? 0}건, 재고부족 ${data?.shortages ?? 0}건, 미매칭 ${data?.unmatched ?? 0}건`
        : data?.error ?? "재고 차감에 실패했습니다.",
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={deduct}
        disabled={loading}
        className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
      >
        {loading ? "차감 중" : "재고 차감"}
      </button>
      {message ? <p className="text-sm text-zinc-600">{message}</p> : null}
    </div>
  );
}
