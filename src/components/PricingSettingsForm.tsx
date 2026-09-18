"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Settings = {
  domesticShippingKrw: string;
  buyingAgencyFeeKrw: string;
  exchangeRateKrwPerUsd: string;
  targetMarginRate: string;
  ebayFeeRate: string;
  advertisingRate: string;
  internationalFeeRate: string;
  perOrderFeeUsd: string;
  buyerShippingUsd: string;
  salesTaxUpliftRate: string;
  insertionFeeUsd: string;
  freeListingAllowance: string;
  minimumSalePriceUsd: string | null;
};

type Usage = {
  days: number;
  measured: {
    orders: number;
    itemSubtotal: number;
    shipping: number;
    buyerPaid: number;
    feeBasis: number;
    salesTaxUpliftRate: number | null;
    finalValueRate: number | null;
    internationalRate: number | null;
    perOrderFeeUsd: number | null;
    advertisingChargedRate: number | null;
    averageShippingUsd: number | null;
    fees: {
      finalValue: number;
      international: number;
      perOrder: number;
      advertising: number;
      insertion: number;
    };
    totalFee: number;
  };
  listing: {
    allowance: number;
    activeListings: number;
    activeListingsAt: string | null;
    recentCount: number;
    recentAmount: number;
    chargedItemIds: string[];
    publishedThisMonth: number;
    paidThisMonth: number;
    paidAmountThisMonth: number;
    freeUsedThisMonth: number;
    insertionFeePerListing: number | null;
    months: Array<{ month: string; count: number; amount: number }>;
  };
};

const money = (value: number) => `$${value.toFixed(2)}`;
const percent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(2)}%`);
const won = (value: number) => `${Math.round(value).toLocaleString()}원`;

/** 화면에서 쓰는 계산. 서버의 계산식과 같은 순서로 맞춘다. */
function simulate(values: Record<string, string>, pocaPriceKrw: number) {
  const number = (key: string) => Number(values[key]) || 0;
  const rate = (key: string) => number(key) / 100;
  const exchange = Number(values.exchangeRateKrwPerUsd) || 1;
  const costKrw = pocaPriceKrw + number("domesticShippingKrw") + number("buyingAgencyFeeKrw");
  const costUsd = costKrw / exchange;
  const feeRate = rate("ebayFeePercent") + rate("internationalFeePercent") + rate("advertisingPercent");
  const uplift = 1 + rate("salesTaxUpliftPercent");
  const shipping = number("buyerShippingUsd");
  const perOrder = number("perOrderFeeUsd");
  const insertion = number("insertionFeeUsd");
  const priceFeeRate = feeRate * uplift;
  if (priceFeeRate >= 1) return null;
  const fixed = shipping * uplift * feeRate + perOrder + insertion;
  const raw = (costUsd * (1 + rate("targetMarginPercent")) + fixed) / (1 - priceFeeRate);
  let price = Math.ceil(raw / 0.1) * 0.1;
  const minimum = Number(values.minimumSalePriceUsd);
  if (values.minimumSalePriceUsd && Number.isFinite(minimum)) price = Math.max(price, minimum);
  const basis = (price + shipping) * uplift;
  const ebayFee = basis * (rate("ebayFeePercent") + rate("internationalFeePercent")) + perOrder;
  const adFee = basis * rate("advertisingPercent");
  const totalFee = ebayFee + adFee + insertion;
  const proceeds = price - totalFee;
  return {
    costKrw,
    costUsd,
    price,
    basis,
    ebayFee,
    adFee,
    insertion,
    totalFee,
    proceeds,
    margin: costUsd ? (proceeds - costUsd) / costUsd : 0,
  };
}

export function PricingSettingsForm({ initial }: { initial: Settings | null }) {
  const router = useRouter();
  const [values, setValues] = useState({
    domesticShippingKrw: initial?.domesticShippingKrw ?? "0",
    buyingAgencyFeeKrw: initial?.buyingAgencyFeeKrw ?? "0",
    exchangeRateKrwPerUsd: initial?.exchangeRateKrwPerUsd ?? "",
    targetMarginPercent: initial ? String(Number(initial.targetMarginRate) * 100) : "",
    ebayFeePercent: initial ? String(Number(initial.ebayFeeRate) * 100) : "13.6",
    internationalFeePercent: initial ? String(Number(initial.internationalFeeRate) * 100) : "1.44",
    advertisingPercent: initial ? String(Number(initial.advertisingRate) * 100) : "0",
    perOrderFeeUsd: initial?.perOrderFeeUsd ?? "0.40",
    buyerShippingUsd: initial?.buyerShippingUsd ?? "0",
    salesTaxUpliftPercent: initial ? String(Number(initial.salesTaxUpliftRate) * 100) : "0",
    insertionFeeUsd: initial?.insertionFeeUsd ?? "0",
    freeListingAllowance: initial?.freeListingAllowance ?? "50000",
    minimumSalePriceUsd: initial?.minimumSalePriceUsd ?? "",
  });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [rateMessage, setRateMessage] = useState("");
  const [rateLoading, setRateLoading] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState("");
  const [samplePoca, setSamplePoca] = useState("10000");

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/pricing/fee-usage?days=180", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "실제 수수료를 불러오지 못했습니다.");
        if (!cancelled) setUsage(body as Usage);
      } catch (error) {
        if (!cancelled)
          setUsageError(error instanceof Error ? error.message : "실제 수수료를 불러오지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const response = await fetch("/api/pricing/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        domesticShippingKrw: values.domesticShippingKrw,
        buyingAgencyFeeKrw: values.buyingAgencyFeeKrw,
        exchangeRateKrwPerUsd: values.exchangeRateKrwPerUsd,
        targetMarginRate: String(Number(values.targetMarginPercent) / 100),
        ebayFeeRate: String(Number(values.ebayFeePercent) / 100),
        advertisingRate: String(Number(values.advertisingPercent) / 100),
        internationalFeeRate: String(Number(values.internationalFeePercent) / 100),
        perOrderFeeUsd: values.perOrderFeeUsd,
        buyerShippingUsd: values.buyerShippingUsd,
        salesTaxUpliftRate: String(Number(values.salesTaxUpliftPercent) / 100),
        insertionFeeUsd: values.insertionFeeUsd,
        freeListingAllowance: values.freeListingAllowance,
        minimumSalePriceUsd: values.minimumSalePriceUsd,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error ?? "저장하지 못했습니다.");
      setSaving(false);
      return;
    }
    setMessage("설정을 저장했습니다. 포카마켓 가격이 있는 상품은 다음 채널 등록·가격 반영 때 이 계산으로 적용됩니다.");
    setSaving(false);
    router.refresh();
  }

  async function fetchLatestRate() {
    setRateLoading(true);
    setRateMessage("");
    try {
      const response = await fetch("/api/pricing/exchange-rate", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "최신 환율을 가져오지 못했습니다.");
      set("exchangeRateKrwPerUsd", String(body.rate));
      setRateMessage(`${body.effectiveDate} ECB 기준 · 1 USD = ${Number(body.rate).toLocaleString()} KRW`);
    } catch (error) {
      setRateMessage(error instanceof Error ? error.message : "최신 환율을 가져오지 못했습니다.");
    } finally {
      setRateLoading(false);
    }
  }

  function applyMeasured() {
    if (!usage) return;
    const m = usage.measured;
    setValues((current) => ({
      ...current,
      ebayFeePercent: m.finalValueRate ? (m.finalValueRate * 100).toFixed(2) : current.ebayFeePercent,
      internationalFeePercent: m.internationalRate
        ? (m.internationalRate * 100).toFixed(2)
        : current.internationalFeePercent,
      perOrderFeeUsd: m.perOrderFeeUsd ? m.perOrderFeeUsd.toFixed(2) : current.perOrderFeeUsd,
      buyerShippingUsd: m.averageShippingUsd
        ? m.averageShippingUsd.toFixed(2)
        : current.buyerShippingUsd,
      salesTaxUpliftPercent: m.salesTaxUpliftRate
        ? (m.salesTaxUpliftRate * 100).toFixed(2)
        : current.salesTaxUpliftPercent,
    }));
    setMessage("실제 정산에서 확인한 값으로 채웠습니다. 확인 후 저장을 눌러 주세요.");
  }

  const sample = simulate(values, Number(samplePoca) || 0);
  const saleFeeTotal = usage
    ? usage.measured.fees.finalValue +
      usage.measured.fees.international +
      usage.measured.fees.perOrder +
      usage.measured.fees.advertising
    : 0;
  const listing = usage?.listing;
  const overAllowance = listing ? listing.paidThisMonth > 0 : false;
  // 유료 청구가 한 건이라도 있으면 무료 한도는 이미 다 쓴 것이다. eBay 청구가
  // 우리 기록보다 정확하므로 한도 사용은 청구를 기준으로 본다.
  const allowanceUsed = listing
    ? overAllowance
      ? listing.allowance
      : Math.min(listing.allowance, listing.publishedThisMonth)
    : 0;
  const allowancePercent = listing?.allowance
    ? Math.min(100, (allowanceUsed / listing.allowance) * 100)
    : 0;
  // eBay가 청구한 건수로 되짚은 이번 달 등록 수. 우리 기록은 피드 업로드처럼
  // 다른 경로로 올린 것을 놓칠 수 있어 참고로만 쓴다.
  const listedByEbay = listing
    ? overAllowance
      ? listing.allowance + listing.paidThisMonth
      : listing.publishedThisMonth
    : 0;

  const field = (
    key: keyof typeof values,
    label: string,
    hint?: string,
    suffix?: string,
  ) => (
    <label key={key} className="text-sm font-medium text-zinc-700">
      <span className="block">{label}</span>
      <span className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="any"
          value={values[key]}
          onChange={(event) => set(key, event.target.value)}
          className="w-full rounded-xl border border-zinc-300 px-3 py-2.5 outline-none focus:border-violet-500"
        />
        {suffix ? <span className="shrink-0 text-xs text-zinc-500">{suffix}</span> : null}
      </span>
      {hint ? <span className="mt-1 block text-xs font-normal text-zinc-500">{hint}</span> : null}
    </label>
  );

  return (
    <div className="space-y-5">
      {/* 등록 사용량 ─ 무료 한도를 넘겼는지 한눈에 본다 */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">이번 달 eBay 등록 사용량</h2>
          <span className="text-xs text-zinc-500">eBay 정산 내역에서 직접 읽은 값입니다</span>
        </div>
        {usageError ? (
          <p className="mt-3 text-sm text-rose-700">{usageError}</p>
        ) : !listing ? (
          <p className="mt-3 text-sm text-zinc-500">불러오는 중입니다…</p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-zinc-50 p-4">
                <p className="text-xs text-zinc-500">이번 달 등록 (eBay 기준)</p>
                <p className="mt-1 text-2xl font-bold">{listedByEbay.toLocaleString()}건</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  우리 기록 {listing.publishedThisMonth.toLocaleString()}건
                </p>
              </div>
              <div className="rounded-xl bg-zinc-50 p-4">
                <p className="text-xs text-zinc-500">무료 한도</p>
                <p className="mt-1 text-2xl font-bold">{listing.allowance.toLocaleString()}건</p>
              </div>
              <div className={`rounded-xl p-4 ${overAllowance ? "bg-rose-50" : "bg-emerald-50"}`}>
                <p className="text-xs text-zinc-600">유료로 청구된 등록</p>
                <p className={`mt-1 text-2xl font-bold ${overAllowance ? "text-rose-700" : "text-emerald-700"}`}>
                  {listing.paidThisMonth.toLocaleString()}건
                </p>
              </div>
              <div className={`rounded-xl p-4 ${overAllowance ? "bg-rose-50" : "bg-emerald-50"}`}>
                <p className="text-xs text-zinc-600">이번 달 등록수수료</p>
                <p className={`mt-1 text-2xl font-bold ${overAllowance ? "text-rose-700" : "text-emerald-700"}`}>
                  {money(listing.paidAmountThisMonth)}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-zinc-600">
                <span>무료 한도 사용 {allowanceUsed.toLocaleString()} / {listing.allowance.toLocaleString()}건</span>
                <span>{allowancePercent.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-zinc-200">
                <div
                  className={`h-full ${overAllowance ? "bg-rose-500" : "bg-emerald-500"}`}
                  style={{ width: `${allowancePercent}%` }}
                />
              </div>
              <p className="mt-2 text-sm">
                {overAllowance ? (
                  <span className="font-semibold text-rose-700">
                    무료 한도를 넘겨 {listing.paidThisMonth.toLocaleString()}건에 {money(listing.paidAmountThisMonth)}가 청구됐습니다
                    {listing.insertionFeePerListing ? ` (건당 ${money(listing.insertionFeePerListing)})` : ""}.
                  </span>
                ) : (
                  <span className="font-semibold text-emerald-700">
                    아직 무료 한도 안입니다. 이번 달 등록수수료 청구가 없습니다.
                  </span>
                )}
              </p>
            </div>
            {/* 앞으로 얼마 나갈지는 eBay 정책에 달려 있어 추정하지 않는다. 실제로
                청구된 것만 보여 주고, 어떤 리스팅이었는지 번호를 남긴다. */}
            <div className="mt-4 rounded-xl bg-zinc-50 p-4 text-sm">
              <p className="font-bold">최근 30일 실제 청구 {money(listing.recentAmount)}</p>
              <p className="mt-1 text-zinc-700">
                {listing.recentCount.toLocaleString()}건에 등록수수료가 붙었습니다. 무료 한도가 남아 있는데도
                청구됐다면 카테고리나 리스팅이 새로 만들어진 경우일 수 있어 eBay에 확인이 필요합니다.
              </p>
              {listing.chargedItemIds.length > 0 && (
                <p className="mt-2 text-xs text-zinc-600">
                  청구된 리스팅 번호(일부): {listing.chargedItemIds.join(", ")}
                </p>
              )}
              {listing.activeListings > 0 && (
                <p className="mt-2 text-xs text-zinc-500">
                  참고 · 우리가 마지막으로 수집한 활성 리스팅 {listing.activeListings.toLocaleString()}건
                  {listing.activeListingsAt
                    ? ` (${listing.activeListingsAt.slice(0, 10)} 기준, eBay 현재 값과 다를 수 있습니다)`
                    : ""}
                </p>
              )}
            </div>
            {listing.months.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-zinc-500">
                      <th className="py-1.5">달</th>
                      <th className="py-1.5 text-right">유료 등록 건수</th>
                      <th className="py-1.5 text-right">등록수수료</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listing.months.map((row) => (
                      <tr key={row.month} className="border-b last:border-0">
                        <td className="py-1.5">{row.month}</td>
                        <td className="py-1.5 text-right">{row.count.toLocaleString()}건</td>
                        <td className="py-1.5 text-right font-semibold">{money(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* 실측 대조 ─ 설정값이 현실과 맞는지 */}
      {usage && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">eBay가 실제로 뗀 수수료</h2>
            <span className="text-xs text-zinc-500">
              최근 {usage.days}일 · 주문 {usage.measured.orders}건
            </span>
            <button
              type="button"
              onClick={applyMeasured}
              className="ml-auto cursor-pointer rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700"
            >
              실측값으로 설정 채우기
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-zinc-500">
                  <th className="py-2">항목</th>
                  <th className="py-2 text-right">실제 요율</th>
                  <th className="py-2 text-right">지금 설정</th>
                  <th className="py-2 text-right">기간 합계</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-2">최종가치수수료</td>
                  <td className="py-2 text-right font-semibold">{percent(usage.measured.finalValueRate)}</td>
                  <td className="py-2 text-right text-zinc-500">{values.ebayFeePercent}%</td>
                  <td className="py-2 text-right">{money(usage.measured.fees.finalValue)}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">국제 판매 수수료</td>
                  <td className="py-2 text-right font-semibold">{percent(usage.measured.internationalRate)}</td>
                  <td className="py-2 text-right text-zinc-500">{values.internationalFeePercent}%</td>
                  <td className="py-2 text-right">{money(usage.measured.fees.international)}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">주문당 고정비</td>
                  <td className="py-2 text-right font-semibold">
                    {usage.measured.perOrderFeeUsd === null ? "—" : money(usage.measured.perOrderFeeUsd)}
                  </td>
                  <td className="py-2 text-right text-zinc-500">${values.perOrderFeeUsd}</td>
                  <td className="py-2 text-right">{money(usage.measured.fees.perOrder)}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">
                    광고비
                    <span className="ml-1 text-xs text-zinc-500">광고로 연결된 판매에만</span>
                  </td>
                  <td className="py-2 text-right font-semibold">
                    {percent(usage.measured.advertisingChargedRate)}
                  </td>
                  <td className="py-2 text-right text-zinc-500">{values.advertisingPercent}%</td>
                  <td className="py-2 text-right">{money(usage.measured.fees.advertising)}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2">등록수수료</td>
                  <td className="py-2 text-right font-semibold">건당 $0.35</td>
                  <td className="py-2 text-right text-zinc-500">${values.insertionFeeUsd}</td>
                  <td className="py-2 text-right">{money(usage.measured.fees.insertion)}</td>
                </tr>
                <tr className="bg-zinc-50 font-semibold">
                  <td className="py-2">판매에 붙는 수수료 합계</td>
                  <td className="py-2 text-right" colSpan={2}>
                    상품값 {money(usage.measured.itemSubtotal)} 대비{" "}
                    {usage.measured.itemSubtotal
                      ? ((saleFeeTotal / usage.measured.itemSubtotal) * 100).toFixed(1)
                      : "—"}
                    % · 구매자 결제액 대비{" "}
                    {usage.measured.buyerPaid
                      ? ((saleFeeTotal / usage.measured.buyerPaid) * 100).toFixed(1)
                      : "—"}
                    %
                  </td>
                  <td className="py-2 text-right">{money(saleFeeTotal)}</td>
                </tr>
                <tr className="font-semibold text-zinc-600">
                  <td className="py-2">등록수수료 (팔리든 말든 나감)</td>
                  <td className="py-2 text-right" colSpan={2}>
                    판매와 무관하게 등록 건수만큼
                  </td>
                  <td className="py-2 text-right">{money(usage.measured.fees.insertion)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* 비율만 보면 믿기 어렵다. 평균 주문 한 건으로 풀어서 보여 준다. */}
          {usage.measured.orders > 0 && (
            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
              <p className="font-bold">평균 주문 한 건으로 보면</p>
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                <span className="text-zinc-600">상품값</span>
                <span className="sm:text-right">
                  {money(usage.measured.itemSubtotal / usage.measured.orders)}
                </span>
                <span className="text-zinc-600">+ 배송비</span>
                <span className="sm:text-right">
                  {money(usage.measured.shipping / usage.measured.orders)}
                </span>
                <span className="text-zinc-600">+ eBay가 걷는 판매세</span>
                <span className="sm:text-right">
                  {money((usage.measured.feeBasis - usage.measured.buyerPaid) / usage.measured.orders)}
                </span>
                <span className="font-semibold">= 수수료가 걸리는 금액</span>
                <span className="font-semibold sm:text-right">
                  {money(usage.measured.feeBasis / usage.measured.orders)}
                </span>
                <span className="mt-2 text-rose-700">− 수수료 합계</span>
                <span className="mt-2 text-rose-700 sm:text-right">
                  {money(saleFeeTotal / usage.measured.orders)}
                </span>
              </div>
              <p className="mt-3 text-zinc-700">
                수수료가 <strong>상품값이 아니라 배송비·판매세까지 더한 금액</strong>에 붙기 때문에, 요율은{" "}
                {percent(
                  (usage.measured.finalValueRate ?? 0) + (usage.measured.internationalRate ?? 0),
                )}
                인데 상품값 대비로는{" "}
                <strong>
                  {usage.measured.itemSubtotal
                    ? ((saleFeeTotal / usage.measured.itemSubtotal) * 100).toFixed(1)
                    : "—"}
                  %
                </strong>
                가 됩니다. 배송비가 상품값에 가까울수록 이 차이가 커집니다.
              </p>
            </div>
          )}
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            수수료는 상품값이 아니라 <strong>상품값 + 배송비 + eBay가 걷은 판매세</strong>에 붙습니다. 이 기간
            구매자 결제액 {money(usage.measured.buyerPaid)} 가운데 배송비가 {money(usage.measured.shipping)}이고,
            수수료가 걸린 금액은 {money(usage.measured.feeBasis)}입니다.
          </p>
        </section>
      )}

      <form onSubmit={submit} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold">가격 계산 설정</h2>

        <h3 className="mt-5 text-sm font-bold text-zinc-900">1. 카드 1장 원가</h3>
        <div className="mt-3 grid gap-5 sm:grid-cols-3">
          {field("domesticShippingKrw", "국내 배송비", "카드당 실제 부담액", "원")}
          {field("buyingAgencyFeeKrw", "포카마켓 출고비", "카드당 실제 부담액", "원")}
          <label className="text-sm font-medium text-zinc-700">
            <span className="block">적용 환율</span>
            <span className="mt-1.5 flex items-center gap-2">
              <input
                required
                type="number"
                min="0"
                step="any"
                value={values.exchangeRateKrwPerUsd}
                onChange={(event) => set("exchangeRateKrwPerUsd", event.target.value)}
                className="w-full rounded-xl border border-zinc-300 px-3 py-2.5 outline-none focus:border-violet-500"
              />
              <span className="shrink-0 text-xs text-zinc-500">원/$</span>
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={rateLoading}
                onClick={fetchLatestRate}
                className="cursor-pointer rounded-lg border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 disabled:opacity-50"
              >
                {rateLoading ? "조회 중…" : "최신 환율 가져오기"}
              </button>
              {rateMessage && <span className="text-xs font-normal text-zinc-500">{rateMessage}</span>}
            </span>
          </label>
        </div>

        <h3 className="mt-6 text-sm font-bold text-zinc-900">2. eBay가 떼는 수수료</h3>
        <p className="mt-1 text-xs text-zinc-500">
          모두 <strong>상품값 + 배송비 + 판매세</strong>에 붙습니다. 위 표의 실측값과 맞춰 주세요.
        </p>
        <div className="mt-3 grid gap-5 sm:grid-cols-3">
          {field("ebayFeePercent", "최종가치수수료", "실측 13.6%", "%")}
          {field("internationalFeePercent", "국제 판매 수수료", "실측 1.44%", "%")}
          {field("perOrderFeeUsd", "주문당 고정비", "주문 1건마다", "$")}
          {field("advertisingPercent", "광고율", "광고로 연결된 판매에만 붙습니다", "%")}
          {field("buyerShippingUsd", "구매자에게 받는 배송비", "이 금액에도 수수료가 붙습니다", "$")}
          {field("salesTaxUpliftPercent", "판매세 가산", "eBay가 걷는 세금만큼 수수료 기준이 커집니다", "%")}
        </div>

        <h3 className="mt-6 text-sm font-bold text-zinc-900">3. 등록수수료</h3>
        <div className="mt-3 grid gap-5 sm:grid-cols-3">
          {field("freeListingAllowance", "한 달 무료 등록 한도", "내 스토어 구독 등급의 한도를 넣으세요", "건")}
          {field("insertionFeeUsd", "판매 1건에 얹을 등록수수료", "한도 안이면 0으로 두세요", "$")}
        </div>

        <h3 className="mt-6 text-sm font-bold text-zinc-900">4. 목표</h3>
        <div className="mt-3 grid gap-5 sm:grid-cols-3">
          {field("targetMarginPercent", "목표 마진율", "원가 대비 남길 비율", "%")}
          <label className="text-sm font-medium text-zinc-700">
            <span className="block">공통 최소 판매가</span>
            <span className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                value={values.minimumSalePriceUsd}
                onChange={(event) => set("minimumSalePriceUsd", event.target.value)}
                className="w-full rounded-xl border border-zinc-300 px-3 py-2.5 outline-none focus:border-violet-500"
              />
              <span className="shrink-0 text-xs text-zinc-500">$</span>
            </span>
            <span className="mt-1 block text-xs font-normal text-zinc-500">비워두면 미사용</span>
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            disabled={saving}
            className="cursor-pointer rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "저장 중…" : "가격 계산 설정 저장"}
          </button>
          {message && <p role="status" className="text-sm">{message}</p>}
        </div>
      </form>

      {/* 예시 계산 ─ 금액을 넣어 바로 확인한다 */}
      <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-6 shadow-sm">
        <h2 className="text-lg font-bold">예시로 계산해 보기</h2>
        <p className="mt-1 text-sm text-zinc-600">
          포카마켓 가격을 넣으면 위 설정 그대로 계산한 최종 판매가와 실제로 남는 돈을 보여 줍니다. 저장하지 않아도 지금
          화면의 값으로 계산합니다.
        </p>
        <label className="mt-4 block text-sm font-medium text-zinc-700">
          포카마켓 가격
          <span className="mt-1.5 flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="any"
              value={samplePoca}
              onChange={(event) => setSamplePoca(event.target.value)}
              className="w-56 rounded-xl border border-zinc-300 px-3 py-2.5 outline-none focus:border-violet-500"
            />
            <span className="text-xs text-zinc-500">원</span>
          </span>
        </label>
        {!sample ? (
          <p className="mt-4 text-sm text-rose-700">수수료율의 합이 100%를 넘어 계산할 수 없습니다.</p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-zinc-500">최종 판매가 (eBay 등록가)</p>
              <p className="mt-1 text-4xl font-bold text-violet-700">{money(sample.price)}</p>
              <p className="mt-2 text-xs text-zinc-500">
                구매자는 배송비 {money(Number(values.buyerShippingUsd) || 0)}를 더해 총{" "}
                {money(sample.price + (Number(values.buyerShippingUsd) || 0))}를 냅니다
              </p>
            </div>
            <div className="rounded-xl bg-white p-4 text-sm">
              <div className="flex justify-between border-b py-1.5">
                <span className="text-zinc-600">원가 (포카 + 국내배송 + 출고비)</span>
                <span className="font-semibold">
                  {won(sample.costKrw)} = {money(sample.costUsd)}
                </span>
              </div>
              <div className="flex justify-between border-b py-1.5">
                <span className="text-zinc-600">수수료가 걸리는 금액</span>
                <span>{money(sample.basis)}</span>
              </div>
              <div className="flex justify-between border-b py-1.5">
                <span className="text-zinc-600">eBay 판매수수료 (국제·고정비 포함)</span>
                <span className="text-rose-700">−{money(sample.ebayFee)}</span>
              </div>
              <div className="flex justify-between border-b py-1.5">
                <span className="text-zinc-600">광고비</span>
                <span className="text-rose-700">−{money(sample.adFee)}</span>
              </div>
              {sample.insertion > 0 && (
                <div className="flex justify-between border-b py-1.5">
                  <span className="text-zinc-600">등록수수료</span>
                  <span className="text-rose-700">−{money(sample.insertion)}</span>
                </div>
              )}
              <div className="flex justify-between border-b py-1.5 font-semibold">
                <span>판매가에서 남는 돈</span>
                <span>{money(sample.proceeds)}</span>
              </div>
              <div className="flex justify-between py-1.5 font-bold">
                <span>원가를 뺀 이익</span>
                <span className={sample.proceeds - sample.costUsd >= 0 ? "text-emerald-700" : "text-rose-700"}>
                  {money(sample.proceeds - sample.costUsd)} · 마진 {(sample.margin * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
