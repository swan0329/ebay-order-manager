"use client";
import Image from "next/image";
import { useState } from "react";
import { Loader2, Shuffle } from "lucide-react";

export type RegistrationPreviewTarget = {
  productId: string; sku: string; title: string; grouped: boolean; memberIds: string[];
  members: Array<{ id: string; sku: string; label: string; imageUrl: string | null; ebayRegistered: boolean; shopifyRegistered: boolean }>;
};

export function RegistrationTargetPreview({ channel, target, loading, disabled, submitted, error, onChange }: {
  channel: "EBAY" | "SHOPIFY"; target?: RegistrationPreviewTarget | null; loading: boolean; disabled: boolean;
  submitted?: boolean; error?: string; onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return <section className="rounded-lg border border-zinc-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="mr-auto text-sm font-bold">{channel === "EBAY" ? "eBay" : "Shopify"} 시험등록 대상</h3>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="rounded border px-3 py-2 text-sm font-semibold">{expanded ? "사진 숨기기" : "사진·옵션 펼치기"}</button>
      <button type="button" disabled={disabled || loading} onClick={onChange} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm font-semibold disabled:opacity-40">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shuffle className="h-4 w-4" />}
        {target ? "다른 상품 랜덤 선택" : "미등록 대상 불러오기"}
      </button>
    </div>
    {loading ? <p role="status" className="mt-2 text-sm">시험등록 대상을 불러오는 중입니다…</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
    {target ? <div className={loading ? "pointer-events-none opacity-40" : ""}>
      <p className="mt-3 break-words text-sm font-semibold leading-relaxed">{target.title}</p>
      <p className="mt-1 text-sm text-zinc-600">{submitted ? "이 대상으로 등록을 요청했습니다. 다음 시험은 다른 상품을 선택해 주세요." : "시험등록 버튼을 누르면 아래 상품이 실제 등록됩니다."}</p>
      <p className="mt-1 text-sm">{target.grouped ? `옵션상품 1개 · 카드 ${target.members.length}장` : "단품 1개"} · 선택 SKU {target.sku}</p>
      <div hidden={!expanded}><div className="mt-3 flex gap-3 overflow-x-auto pb-2">{target.members.map((member) => <div key={member.id} className="w-44 shrink-0 rounded border p-2 sm:w-52">
        {member.imageUrl ? <a href={member.imageUrl} target="_blank" rel="noreferrer" aria-label={`${member.sku} 사진 크게 보기`}><Image src={member.imageUrl} alt={`${member.label} ${member.sku}`} width={260} height={360} unoptimized className="h-60 w-full object-contain" /></a> : <div className="flex h-60 items-center justify-center bg-zinc-100 text-sm">이미지 없음</div>}
        <p className="mt-2 text-sm font-semibold">{member.label} · {member.sku}</p>
        <p className="mt-1 text-xs">eBay: {member.ebayRegistered ? "이미 등록 완료" : "미등록"}</p>
        <p className="text-xs">Shopify: {member.shopifyRegistered ? "이미 등록 완료" : "미등록"}</p>
      </div>)}</div></div>
    </div> : !loading && !error ? <p className="mt-3 text-sm text-zinc-600">등록 가능한 미등록 상품이 없습니다.</p> : null}
  </section>;
}
