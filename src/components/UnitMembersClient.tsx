"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Users } from "lucide-react";

type Item = {
  id: string;
  sku: string;
  productName: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
};

export function UnitMembersClient({ items: initial }: { items: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

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

  if (!items.length) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">
        멤버 지정이 필요한 유닛 상품이 없습니다. 모두 완료됐습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {message ? (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-800">
          {message}
        </p>
      ) : null}
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
