"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { unitCardTitle } from "@/lib/unit-card-label";

type Item = { id: string; sku: string; productName: string; brand: string | null; category: string | null; imageUrl: string | null; searchImageUrl?: string | null; optionName?: string | null };

function CardPhoto({ item }: { item: Item }) {
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const [rotation, setRotation] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const sideways = rotation % 180 !== 0;
  const publicImage = item.searchImageUrl || item.imageUrl;
  const lensUrl = publicImage && /^https:\/\//i.test(publicImage) ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(publicImage)}` : null;
  const keywordUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${item.brand ?? ""} ${item.productName} photocard`)}`;
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-3">
      <span className="text-sm font-semibold">카드 사진 · {Math.round(zoom * 100)}%</span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="사진 왼쪽으로 회전" title="왼쪽 90도 회전" onClick={() => setRotation(r => (r + 270) % 360)} className="rounded-lg border p-2"><RotateCcw size={18}/></button>
        <button type="button" aria-label="사진 오른쪽으로 회전" title="오른쪽 90도 회전" onClick={() => setRotation(r => (r + 90) % 360)} className="rounded-lg border p-2"><RotateCw size={18}/></button>
        <button type="button" aria-label="사진 축소" disabled={zoom <= 1} onClick={() => setZoom(z => Math.max(1, z - .5))} className="rounded-lg border p-2 disabled:opacity-30"><ZoomOut size={18}/></button>
        <button type="button" aria-label="사진 확대" disabled={zoom >= 3} onClick={() => setZoom(z => Math.min(3, z + .5))} className="rounded-lg border p-2 disabled:opacity-30"><ZoomIn size={18}/></button>
        <button type="button" aria-label="사진 크기와 회전 초기화" onClick={() => { setZoom(1); setRotation(0); box.current?.scrollTo(0, 0); }} className="rounded-lg border p-2 text-xs">초기화</button>
        {item.imageUrl && <a href={item.imageUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-xs">원본 열기</a>}
      </div>
    </div>
    <div className="flex flex-wrap gap-2 border-b bg-white px-4 py-2 text-sm">
      {lensUrl && <a href={lensUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white">구글 사진으로 검색</a>}
      <a href={keywordUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2">상품명으로 이미지검색</a>
    </div>
    <div data-card-photo-frame className="relative h-[65vh] min-h-[320px] overflow-hidden">
    <div ref={box} className="absolute inset-0 overflow-scroll" style={{ containerType: "size", touchAction: zoom > 1 ? "none" : "auto", cursor: zoom > 1 ? "grab" : "auto" }} tabIndex={0} aria-label="카드 확대 사진, 확대 후 드래그 또는 스크롤로 이동"
      onPointerDown={e => { if (zoom <= 1 || e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (!drag.current) return; e.currentTarget.scrollLeft = drag.current.left + drag.current.x - e.clientX; e.currentTarget.scrollTop = drag.current.top + drag.current.y - e.clientY; }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      {item.imageUrl && !failed ?
        <div style={{ position: "relative", width: `${zoom * 100}cqw`, height: `${zoom * 100}cqh` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.imageUrl} draggable={false} alt={`${item.sku} 유닛 멤버 확인용 카드 사진`} onError={() => setFailed(true)} className="block max-w-none object-contain" style={{ position: "absolute", left: "50%", top: "50%", width: `${zoom * 100}${sideways ? "cqh" : "cqw"}`, height: `${zoom * 100}${sideways ? "cqw" : "cqh"}`, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}/></div>
        : <p className="p-10 text-center text-sm text-zinc-600">사진을 불러올 수 없습니다. 원본을 확인하거나 다음 카드로 이동해 주세요.</p>}
    </div>
    </div>
    <p className="border-t bg-white px-4 py-2 text-xs text-zinc-500">좌우 회전 · 확대 후 드래그로 이동할 수 있습니다. 검색 결과는 새 탭으로 열립니다. 회전은 화면에만 적용됩니다.</p>
  </section>;
}

export function UnitMembersClient({ items }: { items: Item[] }) {
  const [group, setGroup] = useState("");
  const [query, setQuery] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");
  const [membersByGroup, setMembersByGroup] = useState<Record<string, string[]>>({});
  const [groupErrors, setGroupErrors] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const savingLock = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const groups = useMemo(() => [...new Set(items.map(item => item.brand?.trim()).filter((v): v is string => Boolean(v)))].sort(), [items]);
  const loadGroup = useCallback(async (name: string) => {
    setGroupErrors(prev => ({ ...prev, [name]: false }));
    try {
      const response = await fetch(`/api/inventory/group-members?group=${encodeURIComponent(name)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body = await response.json() as { members: string[] };
      setMembersByGroup(prev => ({ ...prev, [name]: body.members }));
    } catch { setGroupErrors(prev => ({ ...prev, [name]: true })); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => { for (const name of groups) void loadGroup(name); }, 0); return () => clearTimeout(timer); }, [groups, loadGroup]);
  const visible = items.filter(item => Boolean(saved[item.id]) === showSaved && (!group || item.brand?.trim() === group) && `${item.sku} ${item.productName} ${item.category ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const index = Math.max(0, visible.findIndex(item => item.id === activeId));
  const item = visible[index];
  const options = membersByGroup[item?.brand?.trim() ?? ""] ?? [];
  const chosen = item ? selected[item.id] ?? saved[item.id] ?? [] : [];
  const completed = Object.keys(saved).length;
  function choose(members: string[]) { if (item && !savingLock.current) setSelected(prev => ({ ...prev, [item.id]: members })); }
  function toggle(member: string) { choose(chosen.includes(member) ? chosen.filter(name => name !== member) : [...chosen, member]); }
  function move(offset: number) { const next = visible[index + offset]; if (next && !savingLock.current) { setActiveId(next.id); setError(""); } }
  async function save() {
    if (!item || !chosen.length || savingLock.current) return;
    const current = item;
    const members = [...chosen];
    const next = visible[index + 1] ?? visible[index - 1];
    savingLock.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/inventory/featured-members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId: current.id, members }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "저장에 실패했습니다. 선택은 유지됩니다.");
      setSaved(prev => ({ ...prev, [current.id]: members }));
      setMessage(`${current.sku} · ${members.join(", ")} 저장 완료`);
      if (!showSaved) setActiveId(next?.id ?? "");
      // Local state only: keep filters, drafts and scroll position intact.
    } catch (e) { setError(e instanceof Error ? e.message : "저장에 실패했습니다. 선택은 유지됩니다."); }
    finally { savingLock.current = false; setSaving(false); }
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]") || savingLock.current) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void save(); }
      else if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[1-9]$/.test(event.key)) {
        const member = options[Number(event.key) - 1]; if (member) { event.preventDefault(); toggle(member); }
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  return <div className="space-y-4">
    <section className="flex flex-wrap items-center gap-3 rounded-2xl border bg-white p-4">
      <label className="text-sm">그룹 <select value={group} disabled={saving} onChange={e => setGroup(e.target.value)} className="ml-2 rounded-lg border px-3 py-2"><option value="">전체 그룹</option>{groups.map(name => <option key={name}>{name}</option>)}</select></label>
      <input aria-label="상품번호 또는 앨범 검색" placeholder="상품번호 · 앨범 검색" value={query} disabled={saving} onChange={e => setQuery(e.target.value)} className="min-w-48 flex-1 rounded-lg border px-3 py-2 text-sm"/>
      <div className="flex rounded-lg bg-zinc-100 p-1">{[false, true].map(value => <button key={String(value)} type="button" disabled={saving} aria-pressed={showSaved === value} onClick={() => setShowSaved(value)} className={`rounded-md px-3 py-2 text-sm ${showSaved === value ? "bg-white font-semibold shadow-sm" : "text-zinc-500"}`}>{value ? `이번에 저장 (${completed})` : `미지정 (${items.length - completed})`}</button>)}</div>
    </section>
    <div role="status" aria-live="polite" className="min-h-6 text-sm text-emerald-700">{message || "선택한 멤버는 저장 버튼을 눌러야 반영됩니다. 카드 이동 시 선택은 유지됩니다."}</div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {item ? <>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
        <CardPhoto key={item.id} item={item}/>
        <section className="rounded-2xl border bg-white p-5 xl:sticky xl:top-5">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-violet-700">{item.brand} · {item.sku}</span><span className="text-xs text-zinc-500">{index + 1} / {visible.length}</span></div>
          <h2 className="mt-2 break-words text-lg font-bold">{item.productName}</h2>
          <h3 className="mb-3 mt-6 font-semibold">사진에 있는 멤버를 모두 선택하세요</h3>
          {groupErrors[item.brand?.trim() ?? ""] ? <button type="button" onClick={() => void loadGroup(item.brand?.trim() ?? "")} className="text-sm text-rose-700 underline">멤버 목록 조회 실패 · 다시 불러오기</button> : !membersByGroup[item.brand?.trim() ?? ""] ? <p className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={16}/>멤버 목록 불러오는 중</p> : !options.length ? <p className="text-sm text-amber-700">그룹의 멤버 정보가 없습니다. 다른 카드로 이동해 주세요.</p> : <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">{options.map((name, n) => <button key={name} type="button" disabled={saving} aria-pressed={chosen.includes(name)} onClick={() => toggle(name)} className={`flex min-h-14 items-center justify-between gap-2 rounded-xl border-2 px-4 py-3 text-left font-semibold ${chosen.includes(name) ? "border-violet-600 bg-violet-50 text-violet-800" : "border-zinc-200 hover:border-violet-300"}`}><span><span className="mr-2 text-xs opacity-50">{n + 1}</span>{name}</span>{chosen.includes(name) && <Check size={18}/>}</button>)}</div>
            <div className="mt-3 flex gap-4 text-sm"><button type="button" disabled={saving} onClick={() => choose([...options])} className="text-violet-700">전체 선택</button><button type="button" disabled={saving} onClick={() => choose([])} className="text-zinc-500">선택 해제</button></div>
          </>}
          <p className="mt-5 min-h-12 rounded-xl bg-zinc-50 p-3 text-sm"><strong>선택 {chosen.length}명</strong><span className="mt-1 block text-zinc-600">{chosen.join(" · ") || "아직 선택하지 않았습니다."}</span></p>
          {chosen.length > 1 && <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm"><strong>판매 제목 미리보기</strong><p className="mt-1 break-words">{unitCardTitle({ ...item, optionName: item.optionName ?? "Unit", featuredMembers: chosen.join(", ") })}</p><p className="mt-2 text-xs text-zinc-600">사진에 나온 멤버는 모두 선택하세요. 전원 단체는 Group OT7/OT8로, 긴 유닛명은 Unit과 상품번호로 표시하며 전체 멤버는 상세설명에 보존합니다.</p></div>}
          <button type="button" disabled={saving || !chosen.length} onClick={() => void save()} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 font-semibold text-white disabled:bg-zinc-200 disabled:text-zinc-500">{saving && <Loader2 size={18} className="animate-spin"/>}{saving ? "저장 중…" : showSaved ? "수정 저장" : "저장 후 다음 카드"}</button>
          <div className="mt-3 flex gap-2"><button type="button" disabled={saving || index === 0} onClick={() => move(-1)} className="flex flex-1 items-center justify-center gap-1 rounded-xl border p-3 text-sm disabled:opacity-30"><ChevronLeft size={16}/>이전 카드</button><button type="button" disabled={saving || index >= visible.length - 1} onClick={() => move(1)} className="flex flex-1 items-center justify-center gap-1 rounded-xl border p-3 text-sm disabled:opacity-30">다음에 지정<ChevronRight size={16}/></button></div>
          <p className="mt-4 text-xs leading-5 text-zinc-500">숫자키 1–{options.length || 8}: 멤버 선택 · Ctrl/⌘+Enter: 저장<br/>저장해도 페이지를 새로고침하지 않습니다. 저장한 카드는 ‘이번에 저장’에서 수정할 수 있습니다. 선택 보존은 이 화면을 열어둔 동안 유지됩니다.</p>
        </section>
      </div>
      <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold">현재 목록에서 카드 바로 선택 ({visible.length})</summary><div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">{visible.map(row => <button key={row.id} type="button" disabled={saving} onClick={() => setActiveId(row.id)} className={`rounded-lg border p-3 text-left text-xs ${row.id === item.id ? "border-violet-500 bg-violet-50" : "border-zinc-200"}`}><strong>{row.sku}</strong>{selected[row.id]?.length ? <span className="ml-2 text-violet-600">선택 중</span> : null}<span className="mt-1 block truncate">{row.productName}</span></button>)}</div></details>
    </> : <div className="rounded-2xl border bg-white p-10 text-center"><h2 className="font-semibold">{showSaved ? "이번에 저장한 카드가 없습니다." : items.length === completed ? "현재 목록의 유닛 멤버 지정이 완료됐습니다." : "검색 조건에 맞는 카드가 없습니다."}</h2><p className="mt-2 text-sm text-zinc-500">그룹이나 검색 조건을 바꾸거나 다른 탭을 확인해 주세요.</p></div>}
  </div>;
}


