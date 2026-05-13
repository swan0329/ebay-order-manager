"use client";

import { useState } from "react";
import { RefreshCcw } from "lucide-react";

export function ListingPolicySync({ marketplaceId = "EBAY_US" }: { marketplaceId?: string }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function sync() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/listing-upload/policies/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketplaceId }),
    });
    const data = (await response.json().catch(() => null)) as
      | {
          paymentPolicies?: unknown[];
          fulfillmentPolicies?: unknown[];
          returnPolicies?: unknown[];
          inventoryLocations?: unknown[];
          inventoryLocationsSkipped?: boolean;
          error?: string;
          kind?: string;
        }
      | null;

    setLoading(false);

    if (!response.ok) {
      const prefix =
        data?.kind === "oauth_scope"
          ? "OAuth 권한 부족"
          : data?.kind === "ebay_api"
            ? "eBay API 오류"
            : "정책 동기화 실패";
      setMessage(`${prefix}: ${data?.error ?? "오류 내용을 확인할 수 없습니다."}`);
      return;
    }

    const skippedLocation = data?.inventoryLocationsSkipped
      ? " / 재고 위치는 sell.inventory 권한이 없어 건너뜀"
      : "";

    setMessage(
      `결제정책 ${data?.paymentPolicies?.length ?? 0}건 / 배송정책 ${
        data?.fulfillmentPolicies?.length ?? 0
      }건 / 반품정책 ${data?.returnPolicies?.length ?? 0}건 / 위치 ${
        data?.inventoryLocations?.length ?? 0
      }건 동기화${skippedLocation}`,
    );
  }

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={sync}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400"
        >
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          eBay 정책 동기화
        </button>
        {message ? <span className="text-sm text-zinc-600">{message}</span> : null}
      </div>
      <p className="text-xs text-zinc-500">
        결제/배송/반품 정책은 sell.account.readonly 권한으로, 재고 위치는 sell.inventory
        권한으로 가져옵니다.
      </p>
    </div>
  );
}
