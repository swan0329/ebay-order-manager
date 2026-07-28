"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";

const rejectionReasons = [
  ["watermark_residual", "워터마크 잔상"],
  ["pattern_damage", "카드 고유 무늬 훼손"],
  ["border_damage", "카드 테두리 손상"],
  ["wrong_card", "잘못된 카드"],
  ["crop_error", "크롭 오류"],
  ["other", "기타"],
] as const;
type Item = { assignmentId: string; sku: string; productName: string; referenceUrl: string; resultUrl: string; workerName: string };
export function ImageReviewQueue({ items }: { items: Item[] }) {
  const [message, setMessage] = useState("");
  async function act(item: Item, action: "approve" | "reject") {
    const rejectionCode = action === "reject"
      ? window.prompt(`반려 유형을 입력하세요:\n${rejectionReasons.map(([code, label]) => `${code}: ${label}`).join("\n")}`)
      : undefined;
    if (action === "reject" && !rejectionReasons.some(([code]) => code === rejectionCode)) {
      setMessage("목록에 있는 반려 유형 코드를 입력해 주세요.");
      return;
    }
    const reason = action === "reject" ? window.prompt("세부 반려 사유를 입력하세요.") : undefined;
    if (action === "reject" && !reason) return;
    if (action === "approve" && !window.confirm("검수 결과를 최종 상품 이미지로 반영할까요?")) return;
    const response = await fetch("/api/image-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assignmentId: item.assignmentId, action, reason, rejectionCode }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) return setMessage(data.error ?? "처리 실패");
    window.location.reload();
  }
  return <div className="space-y-4">{items.map((item) => <article key={item.assignmentId} className="rounded-lg border bg-white p-4"><div className="mb-3 flex justify-between"><div><strong>{item.sku}</strong><span className="ml-2 text-zinc-500">{item.productName}</span></div><span className="text-sm">작업자 {item.workerName}</span></div><div className="grid gap-4 md:grid-cols-2"><div><p className="mb-1 text-sm font-semibold">현재 최종 이미지</p><img src={item.referenceUrl} alt="현재 최종 이미지" className="h-96 w-full rounded bg-zinc-100 object-contain" /></div><div><p className="mb-1 text-sm font-semibold">승인 전 검수 결과</p><img src={item.resultUrl} alt="승인 전 검수 결과" className="h-96 w-full rounded bg-zinc-100 object-contain" /></div></div><div className="mt-4 flex gap-2"><button onClick={() => act(item,"approve")} className="rounded bg-emerald-700 px-4 py-2 font-semibold text-white">승인 후 최종 반영</button><button onClick={() => act(item,"reject")} className="rounded bg-rose-700 px-4 py-2 font-semibold text-white">반려</button></div></article>)}{!items.length ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-10 text-center text-emerald-800">검수 대기 이미지가 없습니다.</div> : null}{message ? <p className="text-rose-700">{message}</p> : null}</div>;
}
