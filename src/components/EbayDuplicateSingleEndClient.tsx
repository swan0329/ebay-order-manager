"use client";

import { useState } from "react";

export function EbayDuplicateSingleEndClient(props: { itemId: string; sku: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function endListing() {
    setBusy(true); setMessage("실제 중복 상태를 다시 확인하는 중입니다.");
    try {
      const body = { itemId: props.itemId, sku: props.sku };
      const previewResponse = await fetch("/api/ebay/end-duplicate-single", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const preview = await previewResponse.json();
      if (!previewResponse.ok) throw new Error(preview.error ?? "미리보기 실패");
      const response = await fetch("/api/ebay/end-duplicate-single", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, confirmed: true, previewToken: preview.previewToken }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "리스팅 종료 실패");
      setMessage(`eBay 단품 ${result.itemId} 종료 완료 (${result.ack})`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "리스팅 종료 실패"); }
    finally { setBusy(false); }
  }
  return <div className="mt-6 rounded-xl border bg-white p-5"><p><b>SKU {props.sku}</b> · 단품 Item {props.itemId}</p><button className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={endListing}>중복 단품 종료</button>{message ? <p className="mt-4 rounded-lg bg-zinc-100 p-4 text-sm">{message}</p> : null}</div>;
}
