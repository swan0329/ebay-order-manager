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
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/products/${productId}/shopify-upload`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "업로드에 실패했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setError("네트워크 오류로 업로드에 실패했습니다.");
    } finally {
      setLoading(false);
    }
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
        {loading
          ? "업로드 중…"
          : alreadyUploaded
            ? "쇼피파이 재업로드"
            : "쇼피파이 업로드"}
      </button>
      {error ? (
        <p className="max-w-xs text-right text-xs text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}
