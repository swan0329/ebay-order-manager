"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, DollarSign, ExternalLink, Save, Search } from "lucide-react";

type Item = {
  id: string;
  sku: string;
  productName: string;
  optionName: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  costPriceKrw: string | null;
  stockQuantity: number;
  pocamarketAvailableCount: number | null;
};

type MarketComp = {
  itemId: string;
  title: string;
  priceUsd: number;
  shippingUsd: number | null;
  totalUsd: number;
  condition: string | null;
  imageUrl: string | null;
  itemWebUrl: string | null;
};

type CompsState = {
  loading: boolean;
  error: string | null;
  source: "image" | "keyword" | null;
  fallbackReason: string | null;
  comps: MarketComp[];
  collapsed?: boolean;
};

function isValidPrice(value: string | undefined) {
  const numeric = Number(value);
  return Boolean(value?.trim()) && Number.isFinite(numeric) && numeric > 0;
}

function supplyText(item: Item) {
  if (item.stockQuantity > 0) return `내 재고 ${item.stockQuantity}개`;
  if ((item.pocamarketAvailableCount ?? 0) > 0) {
    return `포카 매물 ${item.pocamarketAvailableCount}개`;
  }
  return "공급 확인 필요";
}

export function PriceMissingClient({
  items: initial,
  pricingReady,
}: {
  items: Item[];
  pricingReady: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial
        .filter((item) => item.costPriceKrw)
        .map((item) => [item.id, String(Number(item.costPriceKrw))]),
    ),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [message, setMessage] = useState("");
  const [compsById, setCompsById] = useState<Record<string, CompsState>>({});

  const readyIds = useMemo(
    () => items.filter((item) => isValidPrice(prices[item.id])).map((item) => item.id),
    [items, prices],
  );

  // eBay에 올라와 있는 같은 카드를 찾아 후보로 보여준다. 상품 이미지를 eBay
  // 이미지 검색에 보내므로 구글 렌즈로 찾던 것과 같은 결과를 eBay 안에서 얻는다.
  // 고른 값을 판매가 칸에 넣을 뿐 저장은 따로 눌러야 한다.
  // eBay 호출 한도를 아끼려고, 이미 찾아둔 결과가 있으면 다시 부르지 않고
  // 접었다 폈다만 한다. 값이 바뀌었을 때는 "다시 찾기"로 명시적으로 부른다.
  function toggleComps(item: Item) {
    const existing = compsById[item.id];
    if (existing && !existing.loading && !existing.error) {
      setCompsById((prev) => ({
        ...prev,
        [item.id]: { ...existing, collapsed: !existing.collapsed },
      }));
      return;
    }
    void lookupComps(item);
  }

  async function lookupComps(item: Item) {
    setCompsById((prev) => ({
      ...prev,
      [item.id]: {
        loading: true,
        error: null,
        source: null,
        fallbackReason: null,
        comps: prev[item.id]?.comps ?? [],
      },
    }));

    try {
      const response = await fetch("/api/pricing/ebay-comps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: item.id }),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            source?: "image" | "keyword";
            fallbackReason?: string | null;
            comps?: MarketComp[];
            error?: string;
          }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "eBay 시세를 불러오지 못했습니다.");
      }

      setCompsById((prev) => ({
        ...prev,
        [item.id]: {
          loading: false,
          error: null,
          source: body?.source ?? null,
          fallbackReason: body?.fallbackReason ?? null,
          comps: body?.comps ?? [],
        },
      }));
    } catch (error) {
      setCompsById((prev) => ({
        ...prev,
        [item.id]: {
          loading: false,
          error: error instanceof Error ? error.message : "조회에 실패했습니다.",
          source: null,
          fallbackReason: null,
          comps: [],
        },
      }));
    }
  }

  // 원화 원가를 넣으면 저장된 가격 설정으로 권장가를 계산해 판매가 칸을 채운다.
  // 계산 결과는 제안일 뿐이고, 저장은 사람이 따로 눌러야 반영된다.
  async function calculate(item: Item) {
    const priceKrw = costs[item.id];
    if (!priceKrw?.trim()) {
      setMessage(`${item.sku}: 계산할 원화 금액을 입력해 주세요.`);
      return;
    }

    setBusyId(item.id);
    setMessage("");
    try {
      const response = await fetch("/api/pricing/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceKrw }),
      });
      const body = (await response.json().catch(() => null)) as
        | { recommendedPriceUsd?: string; error?: string }
        | null;
      if (!response.ok || !body?.recommendedPriceUsd) {
        throw new Error(body?.error ?? "권장가를 계산하지 못했습니다.");
      }
      setPrices((prev) => ({ ...prev, [item.id]: body.recommendedPriceUsd! }));
      setMessage(`${item.sku} · 권장가 $${body.recommendedPriceUsd} (확인 후 저장해 주세요)`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "권장가를 계산하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  async function save(targetIds: string[]) {
    const payload = targetIds
      .filter((id) => isValidPrice(prices[id]))
      .map((id) => ({ productId: id, ebayPriceUsd: prices[id] }));
    if (!payload.length) {
      setMessage("저장할 판매가를 먼저 입력해 주세요.");
      return;
    }

    setMessage("");
    try {
      const response = await fetch("/api/products/ebay-price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const body = (await response.json().catch(() => null)) as
        | { updated?: number; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "저장에 실패했습니다.");
      }

      const savedIds = new Set(payload.map((row) => row.productId));
      setItems((prev) => prev.filter((row) => !savedIds.has(row.id)));
      setMessage(`${body?.updated ?? payload.length}개 상품의 eBay 판매가를 저장했습니다.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    }
  }

  async function saveOne(item: Item) {
    setBusyId(item.id);
    try {
      await save([item.id]);
    } finally {
      setBusyId(null);
    }
  }

  async function saveAll() {
    setSavingAll(true);
    try {
      await save(readyIds);
    } finally {
      setSavingAll(false);
    }
  }

  if (!items.length) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">
        가격을 넣어야 할 판매가능 상품이 없습니다. 모두 완료됐습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!pricingReady ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          가격 설정이 저장되어 있지 않아 권장가 계산을 쓸 수 없습니다. 판매가(USD)는 직접
          입력해 저장할 수 있습니다.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2">
        <p className="text-sm text-zinc-600">
          입력 완료 {readyIds.length.toLocaleString()} / {items.length.toLocaleString()}개
        </p>
        <button
          type="button"
          onClick={() => void saveAll()}
          disabled={savingAll || readyIds.length === 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
        >
          <Save className="h-4 w-4" />
          {savingAll ? "저장 중..." : `입력한 값 모두 저장 (${readyIds.length})`}
        </button>
      </div>

      {message ? (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-800">
          {message}
        </p>
      ) : null}

      <div className="space-y-3">
        {items.map((item) => {
          const busy = busyId === item.id;
          const comps = compsById[item.id];
          return (
            <article
              key={item.id}
              className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl ?? ""}
                  alt={item.sku}
                  loading="lazy"
                  className="h-16 w-16 shrink-0 rounded-md border border-zinc-200 object-cover"
                />
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500">{item.sku}</p>
                  <p className="truncate text-sm font-semibold text-zinc-900">
                    {item.productName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {[item.brand, item.optionName, item.category].filter(Boolean).join(" · ") ||
                      "-"}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">{supplyText(item)}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  원가(원)
                  <div className="flex gap-1">
                    <input
                      value={costs[item.id] ?? ""}
                      // 값을 먼저 꺼낸다. 함수형 업데이트가 나중에 실행되면 그때는
                      // React가 event.currentTarget을 비운 뒤라 .value를 읽을 수 없다.
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setCosts((prev) => ({ ...prev, [item.id]: value }));
                      }}
                      type="number"
                      min="0"
                      step="10"
                      placeholder="원"
                      className="h-9 w-28 rounded-md border border-zinc-300 px-2 text-sm text-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() => void calculate(item)}
                      disabled={busy || !pricingReady}
                      title="가격 설정의 마진 공식으로 권장 판매가를 계산합니다"
                      className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
                    >
                      <Calculator className="h-3.5 w-3.5" />
                      계산
                    </button>
                  </div>
                </label>

                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  eBay 판매가(USD)
                  <div className="relative">
                    <DollarSign className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    <input
                      value={prices[item.id] ?? ""}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setPrices((prev) => ({ ...prev, [item.id]: value }));
                      }}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className="h-9 w-32 rounded-md border border-zinc-300 pl-7 pr-2 text-sm font-semibold text-zinc-900"
                    />
                  </div>
                </label>

                <button
                  type="button"
                  onClick={() => toggleComps(item)}
                  disabled={comps?.loading}
                  title="eBay에 올라와 있는 같은 카드를 이미지로 찾아 판매가를 보여줍니다"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
                >
                  <Search className="h-4 w-4" />
                  {comps?.loading
                    ? "찾는 중..."
                    : comps && !comps.error
                      ? comps.collapsed
                        ? "시세 보기"
                        : "시세 접기"
                      : "eBay 시세"}
                </button>

                <button
                  type="button"
                  onClick={() => void saveOne(item)}
                  disabled={busy || !isValidPrice(prices[item.id])}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
                >
                  <Save className="h-4 w-4" />
                  {busy ? "처리 중..." : "저장"}
                </button>
              </div>
              </div>

              {comps && !comps.loading && !comps.collapsed ? (
                <div className="border-t border-zinc-100 pt-3">
                  {comps.error ? (
                    <p className="text-xs text-rose-700">{comps.error}</p>
                  ) : comps.comps.length === 0 ? (
                    <p className="text-xs text-amber-700">
                      eBay에서 같은 카드를 찾지 못했습니다. 직접 입력해 주세요.
                    </p>
                  ) : (
                    <>
                      <p className="mb-2 text-xs text-zinc-500">
                        {comps.source === "image" ? "이미지로 찾은" : "제목으로 찾은"} eBay 판매중
                        상품 {comps.comps.length}건 · 배송비 포함 낮은 순 · 클릭하면 판매가 칸에
                        들어갑니다
                        {comps.fallbackReason ? ` · ${comps.fallbackReason}` : ""}
                        {" · "}
                        <button
                          type="button"
                          onClick={() => void lookupComps(item)}
                          className="underline hover:text-zinc-700"
                        >
                          다시 찾기
                        </button>
                      </p>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {comps.comps.map((comp) => (
                          <li key={comp.itemId}>
                            <div className="flex items-center gap-2 rounded-md border border-zinc-200 p-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setPrices((prev) => ({
                                    ...prev,
                                    [item.id]: comp.totalUsd.toFixed(2),
                                  }))
                                }
                                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={comp.imageUrl ?? ""}
                                  alt=""
                                  loading="lazy"
                                  className="h-10 w-10 shrink-0 rounded border border-zinc-200 object-cover"
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold text-zinc-900">
                                    ${comp.totalUsd.toFixed(2)}
                                    {comp.shippingUsd ? (
                                      <span className="ml-1 text-xs font-normal text-zinc-500">
                                        (${comp.priceUsd.toFixed(2)} + 배송 $
                                        {comp.shippingUsd.toFixed(2)})
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="block truncate text-xs text-zinc-500">
                                    {comp.title}
                                  </span>
                                </span>
                              </button>
                              {comp.itemWebUrl ? (
                                <a
                                  href={comp.itemWebUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="eBay에서 열기"
                                  className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
