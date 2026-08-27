"use client";

import { useState } from "react";
import type { ShopifyDuplicateBatchMapping } from "@/lib/services/shopifyRelinkPreview";

export function ShopifyDuplicateBatchRepairClient({ mappings, previewToken, optionCounts }: {
  mappings: ShopifyDuplicateBatchMapping[];
  previewToken: string;
  optionCounts: number[];
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState("");
  async function execute() {
    setRunning(true);
    setMessage("");
    try {
      const response = await fetch("/api/shopify/duplicate-batch-repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mappings, dryRun: false, confirmed: true, previewToken }),
      });
      const result = await response.json() as { repaired?: boolean; error?: string };
      if (!response.ok || !result.repaired) throw new Error(result.error || "일괄 복구에 실패했습니다.");
      setCompleted(true);
      setMessage("3개 공개상품 복구와 예전 상품 보관이 완료됐습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "일괄 복구에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }
  return <div className="mt-6 space-y-5">
    <div className="overflow-hidden rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-zinc-100"><tr><th className="px-4 py-3">예전 상품</th><th className="px-4 py-3">공개 상품</th><th className="px-4 py-3">옵션</th></tr></thead><tbody>{mappings.map((mapping, index) => <tr key={mapping.currentShopifyProductId} className="border-t"><td className="px-4 py-3">{mapping.currentShopifyProductId}</td><td className="px-4 py-3">{mapping.targetShopifyProductId}</td><td className="px-4 py-3">{optionCounts[index]}개</td></tr>)}</tbody></table></div>
    <label className="flex gap-3 rounded-xl border bg-amber-50 p-4 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>공개상품 3개의 총 {optionCounts.reduce((sum, count) => sum + count, 0)}개 옵션을 다시 전송하고, 모두 성공한 뒤 예전 비공개 상품 3개를 보관 처리합니다.</span></label>
    <button type="button" disabled={!confirmed || running || completed} onClick={execute} className="rounded-lg bg-red-700 px-5 py-3 font-semibold text-white disabled:opacity-40">{running ? "복구 중…" : "3개 Shopify 상품 실제 복구"}</button>
    {message && <p role="status" className="rounded-lg border bg-white p-4 text-sm">{message}</p>}
  </div>;
}
