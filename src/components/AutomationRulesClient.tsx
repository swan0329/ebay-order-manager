"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = { id: string; sku: string; productName: string; itemId: string };

export function AutomationRulesClient({ initialEnabled, initialMode }: { initialEnabled: boolean; initialMode: string }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [mode, setMode] = useState(initialMode);
  const [preview, setPreview] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function request(dryRun: boolean, confirmed = false) {
    setBusy(true); setMessage("");
    const response = await fetch("/api/automation/rules", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, mode, dryRun, confirmed }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(body.error ?? "처리하지 못했습니다."); return; }
    if (dryRun) { setPreview(body.candidates ?? []); setMessage(`현재 대상 ${body.candidates?.length ?? 0}건을 미리 확인했습니다.`); }
    else { setPreview(null); setMessage("자동화 규칙을 저장했습니다."); router.refresh(); }
  }

  return <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
    <h2 className="text-lg font-bold">재고 0 → eBay 리스팅 종료</h2>
    <p className="mt-2 text-sm text-zinc-600">기본은 알림만 남깁니다. 자동 실행은 eBay 리스팅을 실제 종료하며 재입고돼도 자동 재등록되지 않습니다.</p>
    <label className="mt-5 flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={enabled} onChange={event=>{setEnabled(event.target.checked);setPreview(null)}}/>규칙 사용</label>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <button type="button" onClick={()=>{setMode("NOTIFY");setPreview(null)}} className={`rounded-xl border p-4 text-left ${mode==="NOTIFY"?"border-violet-500 bg-violet-50":"border-zinc-200"}`}><strong className="block">알림만 (권장)</strong><span className="mt-1 block text-xs text-zinc-600">대상을 기록하고 리스팅은 종료하지 않습니다.</span></button>
      <button type="button" onClick={()=>{setMode("AUTOMATIC");setPreview(null)}} className={`rounded-xl border p-4 text-left ${mode==="AUTOMATIC"?"border-rose-500 bg-rose-50":"border-zinc-200"}`}><strong className="block">자동 종료</strong><span className="mt-1 block text-xs text-zinc-600">재고가 0이 되면 eBay 리스팅을 종료합니다.</span></button>
    </div>
    <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy} onClick={()=>void request(true)} className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy?"확인 중…":"변경 대상 미리보기"}</button>{preview&&<button disabled={busy} onClick={()=>void request(false,mode==="AUTOMATIC")} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${mode==="AUTOMATIC"?"bg-rose-600":"bg-violet-600"}`}>확인 후 저장</button>}</div>
    {message&&<p role="status" className="mt-3 text-sm text-zinc-700">{message}</p>}
    {preview&&<div className="mt-5 overflow-hidden rounded-xl border"><div className="border-b bg-zinc-50 px-4 py-3 text-sm font-bold">현재 대상 {preview.length}건</div><div className="max-h-72 overflow-y-auto">{preview.length?preview.map(row=><div key={row.id} className="border-b px-4 py-3 text-sm last:border-0"><span className="font-semibold">{row.sku}</span> · {row.productName}<span className="ml-2 text-xs text-zinc-500">eBay {row.itemId}</span></div>):<p className="p-4 text-sm text-zinc-500">현재 종료 대상이 없습니다.</p>}</div></div>}
  </section>;
}
