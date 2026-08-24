"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users } from "lucide-react";
import { OperationProgressOverlay } from "@/components/OperationProgressOverlay";

type Item = {
  id: string;
  sku: string;
  productName: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
};
type EbayRepair = { itemId: string; sku: string; currentName: string; desiredName: string; productId: string };

export function UnitMembersClient({ items: initial }: { items: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [repairs, setRepairs] = useState<EbayRepair[]>([]);
  const [repairToken, setRepairToken] = useState("");
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairStage, setRepairStage] = useState<"scan" | "apply">("scan");
  const [repairElapsed, setRepairElapsed] = useState(0);
  const [repairResult, setRepairResult] = useState<{ succeeded: number; failed: number } | null>(null);

  useEffect(() => { if (!repairBusy) return; const timer = window.setInterval(() => setRepairElapsed((value) => value + 1), 1000); return () => window.clearInterval(timer); }, [repairBusy]);

  async function scanRepairs() {
    setRepairResult(null); setRepairElapsed(0); setRepairStage("scan"); setRepairBusy(true); setMessage("eBay의 현재 유닛 옵션을 확인하고 있습니다.");
    try {
      const response = await fetch("/api/ebay/unit-options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: true }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "eBay 옵션 점검 실패");
      setRepairs(body.rows ?? []); setRepairToken(body.previewToken ?? "");
      setMessage(body.rows?.length ? `잘못 등록된 유닛 옵션 ${body.rows.length}건을 찾았습니다. 변경 전·후를 확인하고 적용해 주세요.` : "eBay에서 unit/유닛으로 남은 옵션이 없습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "eBay 옵션 점검 실패"); }
    finally { setRepairBusy(false); }
  }

  async function applyRepairs() {
    if (!repairs.length || !repairToken) return;
    setRepairElapsed(0); setRepairStage("apply"); setRepairBusy(true); setMessage("eBay 유닛 옵션명을 수정하고 있습니다.");
    try {
      const keys = repairs.map((row) => `${row.itemId}:${row.sku}:${row.desiredName}`);
      const response = await fetch("/api/ebay/unit-options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: false, confirmed: true, previewToken: repairToken, keys }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "eBay 옵션명 수정 실패");
      setMessage(`eBay 옵션명 수정 완료: 성공 ${body.succeeded}건 · 실패 ${body.failed}건`);
      setRepairResult({ succeeded: body.succeeded, failed: body.failed });
      setRepairs((body.results ?? []).filter((row: EbayRepair & { error?: string }) => row.error)); setRepairToken("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "eBay 옵션명 수정 실패"); }
    finally { setRepairBusy(false); }
  }

  const loadGroup = useCallback(async (group: string) => {
    const key = group.trim();
    if (!key) return;
    setMembersByGroup((prev) => (key in prev ? prev : { ...prev, [key]: [] }));
    const response = await fetch(
      `/api/inventory/group-members?group=${encodeURIComponent(key)}`,
      { cache: "no-store" },
    ).catch(() => null);
    const body = (await response?.json().catch(() => null)) as
      | { members?: string[] }
      | null;
    setMembersByGroup((prev) => ({ ...prev, [key]: body?.members ?? [] }));
  }, []);

  useEffect(() => {
    const groups = [
      ...new Set(items.map((item) => item.brand?.trim()).filter(Boolean)),
    ] as string[];
    for (const group of groups) {
      if (!(group in membersByGroup)) queueMicrotask(() => void loadGroup(group));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loadGroup]);

  function toggle(productId: string, member: string) {
    setSelected((prev) => {
      const set = new Set(prev[productId] ?? []);
      if (set.has(member)) set.delete(member);
      else set.add(member);
      return { ...prev, [productId]: set };
    });
  }

  async function save(item: Item) {
    const members = [...(selected[item.id] ?? [])];
    if (!members.length) {
      setMessage(`${item.sku}: 멤버를 1명 이상 선택해 주세요.`);
      return;
    }
    setSavingId(item.id);
    setMessage("");
    try {
      const response = await fetch("/api/inventory/featured-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: item.id, members }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? "저장에 실패했습니다.");
      }
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setMessage(`${item.sku} · 멤버 ${members.length}명 지정 완료`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <OperationProgressOverlay open={repairBusy} title={repairStage === "scan" ? "eBay 유닛 옵션 점검 중" : "eBay 유닛 옵션 수정 중"} detail={repairStage === "scan" ? "활성상품을 조회하고 Item ID·SKU·현재 옵션명을 대조하고 있습니다." : `${repairs.length}건의 옵션명과 옵션 사진 연결을 순서대로 반영하고 있습니다.`} elapsedSeconds={repairElapsed} estimateSeconds={repairStage === "scan" ? 60 : Math.max(20, repairs.length * 12)} total={repairStage === "apply" ? repairs.length : undefined}/>
      {repairResult ? <div className={`rounded-xl border p-4 ${repairResult.failed ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`} role="status"><b>eBay 반영 결과</b><p className="mt-1 text-sm">성공 {repairResult.succeeded}건 · 실패 {repairResult.failed}건</p></div> : null}
      {message ? (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-800">
          {message}
        </p>
      ) : null}
      <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-blue-950">기존 eBay 유닛 옵션 수정</h2><p className="mt-1 text-xs text-blue-800">eBay의 현재 옵션을 SKU로 대조하여 unit/유닛만 실제 멤버명으로 바꿉니다. 가격·수량·SKU는 현재 eBay 값을 유지합니다.</p></div><button type="button" disabled={repairBusy} onClick={() => void scanRepairs()} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{repairBusy ? "확인 중..." : "eBay 잘못된 옵션 점검"}</button></div>
        {repairs.length ? <div className="mt-3 overflow-auto rounded-lg border bg-white"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-zinc-100"><tr><th className="p-2">Item ID</th><th>SKU</th><th>현재 옵션</th><th>수정 옵션</th></tr></thead><tbody>{repairs.map((row) => <tr key={`${row.itemId}:${row.sku}`} className="border-t"><td className="p-2">{row.itemId}</td><td>{row.sku}</td><td className="text-red-700">{row.currentName}</td><td className="font-semibold text-emerald-700">{row.desiredName}</td></tr>)}</tbody></table><div className="border-t p-3 text-right"><button type="button" disabled={repairBusy} onClick={() => void applyRepairs()} className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">표시된 {repairs.length}건 eBay에 적용</button></div></div> : null}
      </section>
      {!items.length ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">멤버 지정이 필요한 유닛 상품이 없습니다. 모두 완료됐습니다.</div> : null}
      <div className="space-y-3">
        {items.map((item) => {
          const group = item.brand?.trim() ?? "";
          const options = membersByGroup[group];
          const chosen = selected[item.id] ?? new Set<string>();
          return (
            <article
              key={item.id}
              className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row"
            >
              <div className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl ?? ""}
                  alt={item.sku}
                  className="h-16 w-16 shrink-0 rounded-md border border-zinc-200 object-cover"
                />
                <div className="min-w-0">
                  <p className="text-xs text-zinc-500">{item.sku}</p>
                  <p className="truncate text-sm font-semibold text-zinc-900">
                    {item.productName}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    그룹: {group || "-"}
                    {item.category ? ` · ${item.category}` : ""}
                  </p>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                {options === undefined ? (
                  <p className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 멤버 불러오는 중...
                  </p>
                ) : options.length === 0 ? (
                  <p className="text-xs text-amber-700">
                    이 그룹({group || "?"})의 멤버 목록을 찾지 못했습니다. 상품 그룹명을
                    확인해 주세요.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {options.map((member) => {
                      const active = chosen.has(member);
                      return (
                        <button
                          key={member}
                          type="button"
                          onClick={() => toggle(item.id, member)}
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                            active
                              ? "border-violet-600 bg-violet-600 text-white"
                              : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          {member}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-center sm:flex-col sm:justify-center">
                <button
                  type="button"
                  onClick={() => void save(item)}
                  disabled={savingId === item.id || chosen.size === 0}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
                >
                  <Users className="h-4 w-4" />
                  {savingId === item.id ? "저장 중..." : `저장 (${chosen.size})`}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
