"use client";

import { useState } from "react";

type PreviewProduct = {
  id: string;
  sku: string;
  productName: string;
  variantId: string;
  currentQuantity: number | null;
};

export function ShopifyVariationRelinkClient({
  seedProductId,
  targetShopifyProductId,
  currentShopifyProductId,
  previewToken,
  products,
}: {
  seedProductId: string;
  targetShopifyProductId: string;
  currentShopifyProductId: string;
  previewToken: string;
  products: PreviewProduct[];
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState("");

  async function execute() {
    setRunning(true);
    setMessage("");
    try {
      const response = await fetch("/api/shopify/variation-relink", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seedProductId,
          targetShopifyProductId,
          dryRun: false,
          confirmed: true,
          previewToken,
        }),
      });
      const result = (await response.json()) as {
        relinked?: boolean;
        error?: string;
      };
      if (!response.ok || !result.relinked) {
        throw new Error(result.error || "복구 실행에 실패했습니다.");
      }
      setCompleted(true);
      setMessage("복구가 완료됐습니다. 재고·가격·옵션 이미지까지 다시 전송했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "복구 실행에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-xl border bg-white p-5 text-sm">
        <p><strong>현재 잘못 연결된 상품:</strong> {currentShopifyProductId}</p>
        <p><strong>고객이 보는 복구 대상:</strong> {targetShopifyProductId}</p>
        <p><strong>확인된 옵션:</strong> {products.length}개</p>
      </div>
      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-100">
            <tr><th className="px-4 py-3">SKU</th><th className="px-4 py-3">상품명</th><th className="px-4 py-3">현재 Shopify 수량</th></tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t">
                <td className="px-4 py-3">{product.sku}</td>
                <td className="px-4 py-3">{product.productName}</td>
                <td className="px-4 py-3">{product.currentQuantity ?? "확인 불가"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="flex items-start gap-3 rounded-xl border bg-amber-50 p-4 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1"
        />
        <span>내부 연결을 고객용 상품으로 옮기고 18개 옵션의 가격·재고·이미지를 다시 전송합니다. 이전 중복 상품은 삭제하지 않습니다.</span>
      </label>
      <button
        type="button"
        disabled={!confirmed || running || completed}
        onClick={execute}
        className="rounded-lg bg-red-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {running ? "복구 실행 중…" : "Christmas EveL 실제 복구 실행"}
      </button>
      {message && <p role="status" className="rounded-lg border bg-white p-4 text-sm">{message}</p>}
    </div>
  );
}
