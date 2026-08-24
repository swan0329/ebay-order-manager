"use client";

import { useEffect, useState } from "react";

type Status = { themeId: string; themeName: string; installed: boolean; partial: boolean };

export function ShopifyVariantCardTheme() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    void fetch("/api/shopify/variant-card-theme", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!mounted) return;
        if (!response.ok) throw new Error(body.error ?? "Shopify 테마 상태를 확인하지 못했습니다.");
        setStatus(body);
      })
      .catch((error) => {
        if (mounted) setMessage(error instanceof Error ? error.message : "Shopify 테마 상태 확인 실패");
      });
    return () => { mounted = false; };
  }, []);

  async function install() {
    setBusy(true); setMessage("현재 공개 Shopify 테마에 옵션 카드 선택기를 설치하고 실제 저장 상태를 확인하고 있습니다.");
    try {
      const response = await fetch("/api/shopify/variant-card-theme", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Shopify 옵션 카드 설치에 실패했습니다.");
      setStatus(body);
      setMessage(`‘${body.themeName}’ 공개 테마에 설치하고 재조회까지 완료했습니다. Shopify 묶음상품 페이지를 새로고침해 확인해 주세요.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Shopify 옵션 카드 설치 실패");
    } finally { setBusy(false); }
  }

  return <div className={`rounded-xl border p-4 text-sm ${status?.installed ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-950"}`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><b>Shopify 상품페이지 옵션 카드</b><p className="mt-1">옵션별 사진·이름·실제 가격·품절 상태를 카드로 표시하고, 선택한 옵션의 사진과 장바구니 항목을 함께 바꿉니다.{status?.themeName ? ` 현재 공개 테마: ${status.themeName}` : ""}</p></div>{status?.installed ? <span className="rounded-full bg-emerald-100 px-3 py-1 font-bold text-emerald-800">설치 완료</span> : <button onClick={() => void install()} disabled={busy} className="rounded-lg bg-fuchsia-700 px-4 py-2 font-bold text-white disabled:opacity-40">{busy ? "설치·확인 중…" : status?.partial ? "설치 복구" : "공개 테마에 설치"}</button>}</div>
    {message && <p className="mt-3 font-medium">{message}</p>}
  </div>;
}
