"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bookmark,
  Download,
  Image as ImageIcon,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  UploadCloud,
} from "lucide-react";

export type ProductFacetOptions = {
  groups: string[];
  members: string[];
  albums: string[];
  versions: string[];
};

const emptyFacets: ProductFacetOptions = {
  groups: [],
  members: [],
  albums: [],
  versions: [],
};

type SavedProductView = {
  id: string;
  name: string;
  query: string;
  createdAt: number;
};

const savedViewsStorageKey = "products-saved-filter-views";
const maxSavedViews = 12;

export function ProductsControls({
  initialFacets = emptyFacets,
}: {
  initialFacets?: ProductFacetOptions;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [facets, setFacets] = useState<ProductFacetOptions>(initialFacets);
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [group, setGroup] = useState(searchParams.get("group") ?? "");
  const [member, setMember] = useState(searchParams.get("member") ?? "");
  const [album, setAlbum] = useState(searchParams.get("album") ?? "");
  const [version, setVersion] = useState(searchParams.get("version") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "all");
  const [stock, setStock] = useState(searchParams.get("stock") ?? "all");
  const [message, setMessage] = useState("");
  const [savedViews, setSavedViews] = useState<SavedProductView[]>([]);
  const [viewName, setViewName] = useState("");
  const [viewMessage, setViewMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [normalizing, setNormalizing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const paramsText = useMemo(() => searchParams.toString(), [searchParams]);
  const filteredGroupOptions = useMemo(
    () => filterFacetOptions(facets.groups, group),
    [facets.groups, group],
  );
  const filteredMemberOptions = useMemo(
    () => filterFacetOptions(facets.members, member),
    [facets.members, member],
  );
  const filteredAlbumOptions = useMemo(
    () => filterFacetOptions(facets.albums, album),
    [facets.albums, album],
  );
  const filteredVersionOptions = useMemo(
    () => filterFacetOptions(facets.versions, version),
    [facets.versions, version],
  );
  const resetHref = useMemo(() => {
    const pageSize = searchParams.get("pageSize");

    return pageSize ? `/products?pageSize=${pageSize}` : "/products";
  }, [searchParams]);
  const secondaryActionClass =
    "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50";

  useEffect(() => {
    const timer = window.setTimeout(() => setSavedViews(readSavedViews()), 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(searchParams.get("q") ?? "");
      setGroup(searchParams.get("group") ?? "");
      setMember(searchParams.get("member") ?? "");
      setAlbum(searchParams.get("album") ?? "");
      setVersion(searchParams.get("version") ?? "");
      setStatus(searchParams.get("status") ?? "all");
      setStock(searchParams.get("stock") ?? "all");
    }, 0);

    return () => window.clearTimeout(timer);
  }, [searchParams]);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/products/facets", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { facets?: ProductFacetOptions } | null) => {
        if (data?.facets) {
          setFacets(data.facets);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFacets(emptyFacets);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!uploadStartedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - uploadStartedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [uploadStartedAt]);

  function currentFilterParams() {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries({
      q,
      group,
      member,
      album,
      version,
      status,
      stock,
    })) {
      const text = value.trim();

      if (text && text !== "all") {
        params.set(key, text);
      }
    }

    const pageSize = searchParams.get("pageSize");

    if (pageSize) {
      params.set("pageSize", pageSize);
    }

    return params;
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(productsHref(currentFilterParams()));
  }

  function storeSavedViews(nextViews: SavedProductView[]) {
    setSavedViews(nextViews);

    try {
      window.localStorage.setItem(savedViewsStorageKey, JSON.stringify(nextViews));
      return true;
    } catch {
      setViewMessage("보기 저장에 실패했습니다.");
      return false;
    }
  }

  function saveCurrentView() {
    const name = viewName.trim();

    if (!name) {
      setViewMessage("보기 이름을 입력하세요.");
      return;
    }

    const query = currentFilterParams().toString();
    const view: SavedProductView = {
      id: createViewId(),
      name: name.slice(0, 40),
      query,
      createdAt: Date.now(),
    };
    const nextViews = [
      view,
      ...savedViews.filter(
        (savedView) => savedView.name !== view.name && savedView.query !== view.query,
      ),
    ].slice(0, maxSavedViews);

    if (storeSavedViews(nextViews)) {
      setViewName("");
      setViewMessage("보기를 저장했습니다.");
    }
  }

  function applySavedView(view: SavedProductView) {
    router.push(productsHref(new URLSearchParams(view.query)));
  }

  function deleteSavedView(id: string) {
    if (storeSavedViews(savedViews.filter((view) => view.id !== id))) {
      setViewMessage("보기를 삭제했습니다.");
    }
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    setUploading(true);
    setUploadFileName(file.name);
    setUploadStartedAt(Date.now());
    setElapsedSeconds(0);
    setMessage("업로드 처리 중입니다. 완료되면 등록/수정 건수가 표시됩니다.");
    const form = new FormData();
    form.set("file", file);

    try {
      const response = await fetch("/api/import/products", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => null)) as
        | { created?: number; updated?: number; errors?: string[]; error?: string }
        | null;

      setMessage(
        response.ok
          ? `등록 ${data?.created ?? 0}건, 수정 ${data?.updated ?? 0}건${
              data?.errors?.length ? `, 오류 ${data.errors.length}건` : ""
            }`
          : data?.error ?? "업로드 실패",
      );
      router.refresh();
    } catch {
      setMessage("업로드 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setUploading(false);
      setUploadStartedAt(null);
      event.currentTarget.value = "";
    }
  }

  async function normalizeStatus() {
    setNormalizing(true);
    setMessage("상태 정규화 중...");

    try {
      const response = await fetch("/api/admin/normalize-product-status", { method: "POST" });
      const data = (await response.json().catch(() => null)) as
        | { updated?: number; soldOut?: number; reactivated?: number; error?: string }
        | null;

      setMessage(
        response.ok
          ? `상태 정규화 완료: 품절처리 ${data?.soldOut ?? 0}건, 활성화 ${data?.reactivated ?? 0}건`
          : data?.error ?? "상태 정규화 실패",
      );
      router.refresh();
    } catch {
      setMessage("상태 정규화 요청에 실패했습니다.");
    } finally {
      setNormalizing(false);
    }
  }

  return (
    <section className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3">
          <form
            onSubmit={applyFilters}
            className="grid flex-1 gap-2 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[minmax(280px,2fr)_repeat(4,minmax(120px,1fr))_120px_120px_96px_96px]"
          >
            <label className="relative block lg:col-span-2 xl:col-span-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                name="q"
                value={q}
                onChange={(event) => setQ(event.currentTarget.value)}
                placeholder="키워드 / SKU / 상품명 검색"
                className="h-12 w-full rounded-md border border-zinc-300 pl-10 pr-4 text-base outline-none focus:border-zinc-900"
              />
            </label>
            <FilterInput
              name="group"
              label="그룹"
              value={group}
              onChange={setGroup}
              options={filteredGroupOptions}
            />
            <FilterInput
              name="member"
              label="멤버"
              value={member}
              onChange={setMember}
              options={filteredMemberOptions}
            />
            <FilterInput
              name="album"
              label="앨범"
              value={album}
              onChange={setAlbum}
              options={filteredAlbumOptions}
            />
            <FilterInput
              name="version"
              label="버전/특전처"
              value={version}
              onChange={setVersion}
              options={filteredVersionOptions}
            />
            <select
              name="status"
              value={status}
              onChange={(event) => setStatus(event.currentTarget.value)}
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            >
              <option value="all">전체 상태</option>
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
              <option value="sold_out">품절</option>
            </select>
            <select
              name="stock"
              value={stock}
              onChange={(event) => setStock(event.currentTarget.value)}
              className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            >
              <option value="all">전체 재고</option>
              <option value="in_stock">재고보유</option>
              <option value="sold_out">품절</option>
            </select>
            <button
              type="submit"
              className="h-10 whitespace-nowrap rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              조회
            </button>
            <Link
              href={resetHref}
              className="inline-flex h-10 whitespace-nowrap items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              초기화
            </Link>
          </form>

          <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-zinc-600">
                저장된 보기
              </span>
              {savedViews.length ? (
                savedViews.map((view) => (
                  <span
                    key={view.id}
                    className="inline-flex max-w-full items-center overflow-hidden rounded-md border border-zinc-300 bg-white text-sm"
                  >
                    <button
                      type="button"
                      onClick={() => applySavedView(view)}
                      className="max-w-[180px] truncate px-3 py-1.5 text-zinc-800 hover:bg-zinc-100"
                      title={view.name}
                    >
                      {view.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSavedView(view.id)}
                      className="border-l border-zinc-200 px-2 py-1.5 text-zinc-500 hover:bg-rose-50 hover:text-rose-700"
                      aria-label={`${view.name} 보기 삭제`}
                      title="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-sm text-zinc-500">없음</span>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={viewName}
                onChange={(event) => {
                  setViewName(event.currentTarget.value);
                  setViewMessage("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveCurrentView();
                  }
                }}
                maxLength={40}
                placeholder="보기 이름"
                className="h-9 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
              />
              <button
                type="button"
                onClick={saveCurrentView}
                className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
              >
                <Bookmark className="h-4 w-4" />
                현재 보기 저장
              </button>
            </div>
          </div>
          {viewMessage ? (
            <p className="text-sm text-zinc-600">{viewMessage}</p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <Link
              href="/products/new"
              className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" />
              상품 등록
            </Link>
            <Link
              href="/inventory/photo-card-match"
              className={secondaryActionClass}
            >
              <ImageIcon className="h-4 w-4" />
              촬영본 연결
            </Link>
            <Link
              href="/listing-upload"
              className={secondaryActionClass}
            >
              <UploadCloud className="h-4 w-4" />
              eBay 업로드
            </Link>
            <Link
              href="/listing-upload/templates"
              className={secondaryActionClass}
            >
              <Settings className="h-4 w-4" />
              Templates
            </Link>
            <label
              className={`${secondaryActionClass} cursor-pointer`}
            >
              <Upload className="h-4 w-4" />
              {uploading ? "처리 중..." : "엑셀/CSV 업로드"}
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={importCsv}
                disabled={uploading}
                className="sr-only"
              />
            </label>
            <a
              href={`/api/export/products${paramsText ? `?${paramsText}` : ""}`}
              className={secondaryActionClass}
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
          </div>
        </div>
        {uploading ? (
          <p className="text-sm text-zinc-600">
            {uploadFileName ? `${uploadFileName} ` : ""}
            업로드 처리 중... {elapsedSeconds}초 경과
          </p>
        ) : message ? (
          <p className="text-sm text-zinc-600">{message}</p>
        ) : null}
        <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2">
          <p className="flex-1 text-sm text-amber-900">
            재고가 있는데 품절/비활성 상태인 상품이 있으면 아래 버튼으로 일괄 수정하세요.
          </p>
          <button
            type="button"
            onClick={() => void normalizeStatus()}
            disabled={normalizing}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {normalizing ? "정리 중..." : "상태 자동정리"}
          </button>
        </div>
      </div>
    </section>
  );
}

function FilterInput({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  const listId = `products-${name}-options`;

  return (
    <label className="block">
      <input
        name={name}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        list={listId}
        placeholder={label}
        className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </label>
  );
}

function productsHref(params: URLSearchParams) {
  const query = params.toString();

  return query ? `/products?${query}` : "/products";
}

function createViewId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readSavedViews(): SavedProductView[] {
  try {
    const raw = window.localStorage.getItem(savedViewsStorageKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is SavedProductView => {
        if (!entry || typeof entry !== "object") {
          return false;
        }

        const view = entry as Partial<SavedProductView>;

        return (
          typeof view.id === "string" &&
          typeof view.name === "string" &&
          typeof view.query === "string" &&
          typeof view.createdAt === "number"
        );
      })
      .slice(0, maxSavedViews);
  } catch {
    return [];
  }
}

function filterFacetOptions(options: string[], query: string) {
  const keyword = query.trim().toLowerCase();

  if (!keyword) {
    return options;
  }

  return options.filter((option) => option.toLowerCase().includes(keyword));
}
