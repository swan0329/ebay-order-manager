"use client";

import { Loader2 } from "lucide-react";

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe}초`;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
}

export function OperationProgressOverlay({ open, title, detail, elapsedSeconds, estimateSeconds, completed, total }: { open: boolean; title: string; detail: string; elapsedSeconds: number; estimateSeconds?: number; completed?: number; total?: number }) {
  if (!open) return null;
  const measured = total && completed !== undefined ? Math.round((completed / total) * 100) : null;
  const estimated = estimateSeconds ? Math.min(92, Math.max(6, Math.round((elapsedSeconds / estimateSeconds) * 100))) : 18;
  const percent = measured ?? estimated;
  const remaining = estimateSeconds ? Math.max(0, estimateSeconds - elapsedSeconds) : null;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-live="polite">
    <div className="w-full max-w-lg rounded-2xl border bg-white p-6 shadow-2xl">
      <div className="flex items-start gap-3"><span className="rounded-full bg-violet-100 p-2 text-violet-700"><Loader2 className="h-5 w-5 animate-spin"/></span><div><h2 className="text-lg font-bold text-zinc-950">{title}</h2><p className="mt-1 text-sm text-zinc-600">{detail}</p></div></div>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-zinc-200"><div className="h-full rounded-full bg-violet-600 transition-[width] duration-700" style={{width:`${percent}%`}}/></div>
      <div className="mt-3 flex justify-between text-sm"><span className="font-semibold text-zinc-800">{completed !== undefined && total ? `${completed}/${total}건 · ` : ""}{formatDuration(elapsedSeconds)} 경과</span><span className="text-zinc-500">{remaining === null ? "외부 마켓 응답 대기" : remaining > 0 ? `약 ${formatDuration(remaining)} 남음` : "마지막 결과 확인 중"}</span></div>
      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">외부 마켓이 성공 응답을 반환하기 전에는 완료로 표시하지 않습니다. 이 창을 닫거나 같은 버튼을 다시 누르지 마세요.</p>
    </div>
  </div>;
}
