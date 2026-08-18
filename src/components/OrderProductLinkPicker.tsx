/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";

// 주문 상품 연결에 촬영본 연결 화면과 같은 방식을 쓴다. 자유 입력 한 칸으로
// 찾으면 무엇을 입력해야 맞는지 알 수 없지만, 실제 데이터에서 뽑은 그룹·멤버·앨범
// 목록에서 고르면 존재하는 조합만 좁혀 갈 수 있다.

export type LinkCandidate = {
  id: string;
  sku: string;
  title: string;
  groupName: string | null;
  memberName: string | null;
  albumName: string | null;
  currentImageUrl: string | null;
  userFrontImageUrl: string | null;
  stockQuantity: number;
};

type Facets = {
  groups: string[];
  members: string[];
  albums: string[];
  versions: string[];
};

const emptyFacets: Facets = { groups: [], members: [], albums: [], versions: [] };

// 대소문자, 공백, 마침표 차이로 못 찾는 일이 없게 맞춘다. eBay 제목은 표기가
// 제각각이라 "I.N" 과 "IN", "I AM NOT" 과 "IAMNOT" 이 섞여 들어온다.
function comparable(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^a-z0-9가-힣]/g, "");
}

/**
 * 주문 제목에서 그룹·멤버·앨범을 추측한다.
 *
 * 후보 목록은 데이터베이스에서 실제로 쓰이는 값이므로, 코드에 그룹 이름을 적어 둘
 * 필요가 없다. 예전에는 스트레이키즈 멤버와 앨범 이름을 코드에 나열해 두어 다른
 * 그룹 주문에서는 검색어가 아예 비어 있었다.
 *
 * 같은 값이 여러 개 걸리면 가장 긴 것을 고른다. "I AM NOT"이 "I AM"보다 정확하다.
 */
export function guessFacetFromTitle(title: string, options: string[]) {
  const haystack = comparable(title);
  if (!haystack) return "";
  let best = "";
  for (const option of options) {
    const needle = comparable(option);
    if (!needle || needle.length < 2) continue;
    if (haystack.includes(needle) && needle.length > comparable(best).length) {
      best = option;
    }
  }
  return best;
}

export function OrderProductLinkPicker({
  itemTitle,
  itemSku,
  selectedProductId,
  disabled,
  onPick,
}: {
  itemTitle: string;
  itemSku?: string | null;
  selectedProductId: string;
  disabled?: boolean;
  onPick: (product: LinkCandidate) => void;
}) {
  const [facets, setFacets] = useState<Facets>(emptyFacets);
  const [group, setGroup] = useState("");
  const [member, setMember] = useState("");
  const [album, setAlbum] = useState("");
  const [keyword, setKeyword] = useState(itemSku?.trim() ?? "");
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [guessed, setGuessed] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "24", registrationStatus: "all" });
    if (group) params.set("group", group);
    if (member) params.set("member", member);
    if (album) params.set("album", album);
    if (keyword.trim()) params.set("keyword", keyword.trim());
    return params.toString();
  }, [group, member, album, keyword]);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/inventory/photo-card-candidates?${search}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "후보를 불러오지 못했습니다.");
      setCandidates(body.candidates ?? []);
      setFacets(body.facets ?? emptyFacets);
      return (body.facets ?? emptyFacets) as Facets;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // 처음 한 번은 필터 없이 불러 전체 목록을 받은 뒤, 그 값으로 주문 제목을 맞춰 본다.
  useEffect(() => {
    if (guessed) return;
    let cancelled = false;
    void (async () => {
      const loaded = await load("limit=24&registrationStatus=all");
      if (cancelled || !loaded) return;
      const guessedGroup = guessFacetFromTitle(itemTitle, loaded.groups);
      const guessedMember = guessFacetFromTitle(itemTitle, loaded.members);
      const guessedAlbum = guessFacetFromTitle(itemTitle, loaded.albums);
      setGroup(guessedGroup);
      setMember(guessedMember);
      setAlbum(guessedAlbum);
      setGuessed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [guessed, itemTitle, load]);

  useEffect(() => {
    if (!guessed) return;
    const timer = window.setTimeout(() => void load(query), 250);
    return () => window.clearTimeout(timer);
  }, [guessed, query, load]);

  const picked = useMemo(
    () => (group || member || album ? [group, member, album].filter(Boolean).join(" · ") : "조건 없음"),
    [group, member, album],
  );

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-zinc-800">상품 찾아 연결</p>
        <p className="truncate text-[11px] text-zinc-500" title={picked}>
          {picked}
        </p>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1">
        <FacetSelect label="그룹" value={group} options={facets.groups} onChange={setGroup} disabled={disabled} />
        <FacetSelect label="멤버" value={member} options={facets.members} onChange={setMember} disabled={disabled} />
        <FacetSelect label="앨범" value={album} options={facets.albums} onChange={setAlbum} disabled={disabled} />
      </div>

      <div className="mt-1 flex gap-1">
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.currentTarget.value)}
          placeholder="SKU 또는 이름으로 더 좁히기"
          disabled={disabled}
          className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300 px-2 text-xs outline-none focus:border-zinc-900 disabled:bg-zinc-100"
        />
        <button
          type="button"
          onClick={() => {
            setGroup("");
            setMember("");
            setAlbum("");
            setKeyword("");
          }}
          disabled={disabled}
          className="h-8 shrink-0 rounded-md border border-zinc-300 px-2 text-xs text-zinc-700 hover:bg-zinc-50 disabled:text-zinc-300"
        >
          조건 지우기
        </button>
      </div>

      {error ? <p className="mt-1 rounded bg-red-50 p-1.5 text-[11px] text-red-700">{error}</p> : null}

      <div className="mt-2 max-h-56 overflow-y-auto">
        {loading && !candidates.length ? (
          <p className="flex items-center gap-1 p-2 text-[11px] text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" /> 불러오는 중…
          </p>
        ) : candidates.length ? (
          <div className="grid grid-cols-2 gap-1">
            {candidates.map((candidate) => {
              const image = candidate.userFrontImageUrl || candidate.currentImageUrl;
              return (
                <button
                  type="button"
                  key={candidate.id}
                  onClick={() => onPick(candidate)}
                  disabled={disabled}
                  className={`flex items-center gap-1.5 rounded-md border p-1 text-left text-[11px] hover:bg-zinc-50 disabled:cursor-not-allowed ${
                    selectedProductId === candidate.id
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-zinc-200"
                  }`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                    {image ? (
                      <img src={image} alt={candidate.title} className="h-full w-full object-cover" />
                    ) : (
                      <ImageOff className="h-4 w-4 text-zinc-400" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-zinc-900">{candidate.sku}</span>
                    <span className="block truncate text-zinc-600">
                      {[candidate.memberName, candidate.albumName].filter(Boolean).join(" · ") || candidate.title}
                    </span>
                    <span className="block text-zinc-500">재고 {candidate.stockQuantity}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="p-2 text-[11px] text-zinc-500">
            조건에 맞는 상품이 없습니다. 위 조건을 지우거나 바꿔 보세요.
          </p>
        )}
      </div>
    </div>
  );
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        disabled={disabled}
        className="h-8 w-full rounded-md border border-zinc-300 bg-white px-1 text-[11px] outline-none focus:border-zinc-900 disabled:bg-zinc-100"
      >
        <option value="">{label} 전체</option>
        {/* 지금 선택한 값이 목록에 없어도 사라지지 않게 함께 넣는다. */}
        {(value && !options.includes(value) ? [value, ...options] : options).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
