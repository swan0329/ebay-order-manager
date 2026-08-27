"use client";

import { useState } from "react";

type Channel = "SHOPIFY" | "EBAY";

export function InventoryOnlySyncClient(props: { shopifyIds: string[]; ebayIds: string[] }) {
  const [busy, setBusy] = useState<Channel | null>(null);
  const [message, setMessage] = useState("");

  async function sync(channel: Channel, productIds: string[]) {
    setBusy(channel);
    setMessage(`${channel} 재고 불일치 ${productIds.length}건을 다시 확인하는 중입니다.`);
    try {
      const previewResponse = await fetch("/api/inventory-only-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, productIds }) });
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(preview.error ?? "재고 미리보기 실패");
      const response = await fetch("/api/inventory-only-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, productIds, confirmed: true, previewToken: preview.previewToken }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "재고 동기화 실패");
      const succeeded = channel === "SHOPIFY" ? result.pushed : result.succeeded;
      setMessage(`${channel} 재고 전용 동기화 완료: 성공 ${succeeded}건, 실패 ${result.failed?.length ?? 0}건`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "재고 동기화 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border bg-white p-5">Shopify 불일치: {props.shopifyIds.length}건</div>
      <button className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-50" disabled={Boolean(busy) || !props.shopifyIds.length} onClick={() => sync("SHOPIFY", props.shopifyIds)}>Shopify 수량만 동기화</button>
      <div className="rounded-xl border bg-white p-5">eBay 불일치: {props.ebayIds.length}건</div>
      <button className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50" disabled={Boolean(busy) || !props.ebayIds.length} onClick={() => sync("EBAY", props.ebayIds)}>eBay 수량만 동기화</button>
      {message ? <p className="rounded-lg bg-zinc-100 p-4 text-sm">{message}</p> : null}
    </div>
  );
}
