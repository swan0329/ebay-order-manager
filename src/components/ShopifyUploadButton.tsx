"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShoppingBag } from "lucide-react";

type ShopifyUploadButtonProps = {
  productId: string;
  alreadyUploaded?: boolean;
};

export function ShopifyUploadButton({
  productId,
  alreadyUploaded = false,
}: ShopifyUploadButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    // 단품 버튼으로 바로 전송하면 같은 묶음에 들어갈 옵션을 단품으로 올릴 수
    // 있다. 운영 메뉴에서 마켓별 미리보기와 최종 확인을 거치게 한다.
    setLoading(true);
    setError("Shopify 채널 운영 메뉴에서 미리보기 후 전송해 주세요.");
    router.push(`/ebay-operations?channel=SHOPIFY&productId=${encodeURIComponent(productId)}`);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleUpload}
        disabled={loading}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <ShoppingBag className="h-4 w-4" />
        {loading ? "운영 메뉴로 이동 중…" : alreadyUploaded ? "Shopify 운영 메뉴 (재검토)" : "Shopify 운영 메뉴"}
      </button>
      {error ? (
        <p className="max-w-xs text-right text-xs text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}
