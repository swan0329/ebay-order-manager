"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet, Link2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ReportSummary = {
  id: string;
  fileName: string;
  completeSnapshot: boolean;
  rowCount: number;
  matchedCount: number;
  unmatchedCount: number;
  duplicateCount: number;
  endedCount: number;
  createdAt: string;
  listings: Array<{
    id: string;
    itemId: string;
    sku: string | null;
    title: string | null;
    matchStatus: string;
    product: { productName: string; optionName: string | null } | null;
  }>;
};

const matchLabels: Record<string, string> = {
  TITLE_MATCHED: "제목 매칭 · 확인",
  UNMATCHED: "SKU 연결 필요",
  DUPLICATE: "중복 SKU",
  CONFLICT: "Item ID 충돌",
};

export function EbayActiveReportPanel() {
  const router = useRouter();
  const [latest, setLatest] = useState<ReportSummary | null>(null);
  const [completeSnapshot, setCompleteSnapshot] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [showListings, setShowListings] = useState(false);
  const [message, setMessage] = useState("");

  async function loadLatest() {
    const response = await fetch("/api/ebay/active-report", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { latest?: ReportSummary | null };
    setLatest(body.latest ?? null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLatest(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("completeSnapshot", String(completeSnapshot));
      const response = await fetch("/api/ebay/active-report", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => null)) as
        | {
            result?: {
              rowCount: number;
              matchedCount: number;
              unmatchedCount: number;
              duplicateCount: number;
              endedCount: number;
            };
            error?: string;
          }
        | null;
      if (!response.ok) throw new Error(body?.error ?? "보고서 가져오기 실패");
      const result = body?.result;
      setMessage(
        `가져오기 완료: ${result?.rowCount ?? 0}건 · 연결 ${
          result?.matchedCount ?? 0
        }건 · 확인 필요 ${
          (result?.unmatchedCount ?? 0) + (result?.duplicateCount ?? 0)
        }건 · 종료 확인 ${result?.endedCount ?? 0}건`,
      );
      await loadLatest();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "보고서 가져오기 실패");
    } finally {
      setUploading(false);
    }
  }

  async function rematch() {
    setRematching(true);
    setMessage("");
    try {
      const response = await fetch("/api/ebay/active-report", { method: "PATCH" });
      const body = (await response.json().catch(() => null)) as
        | {
            result?: {
              rowCount: number;
              matchedCount: number;
              unmatchedCount: number;
              duplicateCount: number;
              newlyLinked: number;
              titleLinked: number;
            };
            error?: string;
          }
        | null;
      if (!response.ok) throw new Error(body?.error ?? "다시 연결 실패");
      const result = body?.result;
      setMessage(
        `다시 연결 완료: 새로 연결 ${result?.newlyLinked ?? 0}건(제목 매칭 ${
          result?.titleLinked ?? 0
        }건 포함) · 연결 ${result?.matchedCount ?? 0}건 · 확인 필요 ${
          (result?.unmatchedCount ?? 0) + (result?.duplicateCount ?? 0)
        }건`,
      );
      await loadLatest();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "다시 연결 실패");
    } finally {
      setRematching(false);
    }
  }

  async function unlink(listingId: string) {
    setUnlinkingId(listingId);
    try {
      const response = await fetch(
        `/api/ebay/active-report?listingId=${encodeURIComponent(listingId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "연결 해제 실패");
      }
      await loadLatest();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "연결 해제 실패");
    } finally {
      setUnlinkingId(null);
    }
  }

  return (
    <section className="mb-5 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-blue-600" />
            <h2 className="font-semibold text-zinc-950">eBay 활성상품 보고서</h2>
          </div>
          <p className="mt-1 text-sm text-zinc-600">
            SKU와 Item ID를 연결하고 신규등록·변경·판매중단 대상을 판별합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={completeSnapshot}
              onChange={(event) => setCompleteSnapshot(event.currentTarget.checked)}
            />
            전체 활성상품 보고서
            <span className="text-xs text-zinc-500">(신규등록 CSV에 필요)</span>
          </label>
          {latest ? (
            <button
              type="button"
              onClick={() => void rematch()}
              disabled={rematching || uploading}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-blue-600 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            >
              {rematching ? "연결하는 중..." : "다시 연결"}
            </button>
          ) : null}
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
            <Upload className="h-4 w-4" />
            {uploading ? "가져오는 중..." : "보고서 가져오기"}
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              disabled={uploading}
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        </div>
      </div>
      {completeSnapshot ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          보고서에 없는 기존 활성 Item ID는 `판매 종료`로 판정됩니다. 일부 상품만
          내려받은 파일이라면 체크하지 마세요.
        </p>
      ) : null}
      {message ? <p className="mt-3 text-sm font-medium text-zinc-800">{message}</p> : null}
      {/* 신규등록 CSV는 전체 보고서가 있어야만 만들어진다. 부분 보고서만 가져온
          상태면 버튼을 눌러도 거부되므로, 그 이유를 여기서 미리 알린다. */}
      {latest && !latest.completeSnapshot ? (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          최근 보고서가 <strong>부분 보고서</strong>로 저장돼 있어 신규등록 CSV를 내려받을
          수 없습니다. eBay에서 <strong>활성 상품 전체</strong>를 내려받은 파일을 준비하고,
          위 <strong>&quot;전체 활성상품 보고서&quot;</strong>에 체크한 뒤 다시 가져와
          주세요. (중복 등록을 막기 위한 조건입니다)
        </p>
      ) : null}
      {latest ? (
        <div className="mt-3">
          <p className="text-xs text-zinc-500">
            최근 가져오기: {latest.fileName} ·{" "}
            {new Intl.DateTimeFormat("ko-KR", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(latest.createdAt))}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">
              연결 {latest.matchedCount.toLocaleString()}
            </span>
            <span className="rounded bg-sky-50 px-2 py-1 text-sky-800">
              제목 매칭 확인{" "}
              {latest.listings
                .filter((listing) => listing.matchStatus === "TITLE_MATCHED")
                .length.toLocaleString()}
            </span>
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">
              미연결 {latest.unmatchedCount.toLocaleString()}
            </span>
            <span className="rounded bg-rose-50 px-2 py-1 text-rose-800">
              중복·충돌 {latest.duplicateCount.toLocaleString()}
            </span>
            <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-700">
              종료 확인 {latest.endedCount.toLocaleString()}
            </span>
            <span
              className={`rounded px-2 py-1 font-medium ${
                latest.completeSnapshot
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-amber-100 text-amber-900"
              }`}
            >
              {latest.completeSnapshot ? "전체 보고서" : "부분 보고서"}
            </span>
            <Link
              href="/products/ebay-link"
              className="inline-flex items-center gap-1 rounded bg-zinc-900 px-2 py-1 font-semibold text-white hover:bg-zinc-800"
            >
              <Link2 className="h-3.5 w-3.5" />
              연결하기
            </Link>
          </div>
          {latest.listings.length ? (
            <button
              type="button"
              onClick={() => setShowListings((value) => !value)}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900"
            >
              {showListings ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              확인 필요 목록 {showListings ? "접기" : "펼치기"} (
              {latest.listings.length.toLocaleString()}건)
            </button>
          ) : null}
          {latest.listings.length && showListings ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="px-2 py-1">판정</th>
                    <th className="px-2 py-1">eBay 제목</th>
                    <th className="px-2 py-1">연결된 상품</th>
                    <th className="px-2 py-1">SKU</th>
                    <th className="px-2 py-1">Item ID</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {latest.listings.map((listing) => (
                    <tr key={listing.id} className="border-t align-top">
                      <td
                        className={`px-2 py-1.5 font-medium ${
                          listing.matchStatus === "TITLE_MATCHED"
                            ? "text-sky-700"
                            : "text-amber-800"
                        }`}
                      >
                        {matchLabels[listing.matchStatus] ?? listing.matchStatus}
                      </td>
                      <td className="max-w-xs truncate px-2 py-1.5">
                        {listing.title ?? "-"}
                      </td>
                      <td className="max-w-xs truncate px-2 py-1.5">
                        {listing.product
                          ? [listing.product.productName, listing.product.optionName]
                              .filter(Boolean)
                              .join(" ")
                          : "-"}
                      </td>
                      <td className="px-2 py-1.5">{listing.sku ?? "-"}</td>
                      <td className="px-2 py-1.5">{listing.itemId}</td>
                      <td className="px-2 py-1.5">
                        {listing.product ? (
                          <button
                            type="button"
                            onClick={() => void unlink(listing.id)}
                            disabled={unlinkingId === listing.id}
                            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                          >
                            {unlinkingId === listing.id ? "해제 중..." : "연결 해제"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
