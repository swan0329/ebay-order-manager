"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  Image as ImageIcon,
  Plus,
  Search,
  Settings,
  Upload,
  UploadCloud,
} from "lucide-react";

type ProductFacetOptions = {
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

export function ProductsControls() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [facets, setFacets] = useState<ProductFacetOptions>(emptyFacets);
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [group, setGroup] = useState(searchParams.get("group") ?? "");
  const [member, setMember] = useState(searchParams.get("member") ?? "");
  const [album, setAlbum] = useState(searchParams.get("album") ?? "");
  const [version, setVersion] = useState(searchParams.get("version") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "all");
  const [stock, setStock] = useState(searchParams.get("stock") ?? "all");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadStartedAt, setUploadStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const paramsText = useMemo(() => searchParams.toString(), [searchParams]);
  const resetHref = useMemo(() => {
    const pageSize = searchParams.get("pageSize");

    return pageSize ? `/products?pageSize=${pageSize}` : "/products";
  }, [searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        includeRegistered: "1",
        limit: "1",
      });

      for (const [key, value] of Object.entries({
        group,
        member,
        album,
        version,
      })) {
        const text = value.trim();

        if (text) {
          params.set(key, text);
        }
      }

      fetch(`/api/inventory/photo-card-candidates?${params.toString()}`, {
        signal: controller.signal,
      })
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
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [group, member, album, version]);

  useEffect(() => {
    if (!uploadStartedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - uploadStartedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [uploadStartedAt]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

    const query = params.toString();
    router.push(query ? `/products?${query}` : "/products");
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
      setMessage("업로드 요청이 끊겼습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setUploading(false);
      setUploadStartedAt(null);
      event.currentTarget.value = "";
    }
  }

  return (
    <section className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3">
          <form
            onSubmit={applyFilters}
            className="grid flex-1 gap-2 lg:grid-cols-4 xl:grid-cols-[minmax(180px,1.2fr)_repeat(4,minmax(120px,1fr))_130px_130px_auto_auto]"
          >
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                name="q"
                value={q}
                onChange={(event) => setQ(event.currentTarget.value)}
                placeholder="키워드, SKU, 상품명"
                className="h-10 w-full rounded-md border border-zinc-300 pl-9 pr-3 text-sm outline-none focus:border-zinc-900"
              />
            </label>
            <FilterInput
              name="group"
              label="그룹"
              value={group}
              onChange={setGroup}
              options={facets.groups}
            />
            <FilterInput
              name="member"
              label="멤버"
              value={member}
              onChange={setMember}
              options={facets.members}
            />
            <FilterInput
              name="album"
              label="앨범"
              value={album}
              onChange={setAlbum}
              options={facets.albums}
            />
            <FilterInput
              name="version"
              label="버전/특전처"
              value={version}
              onChange={setVersion}
              options={facets.versions}
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
              className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              조회
            </button>
            <Link
              href={resetHref}
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              초기화
            </Link>
          </form>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/products/new"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              <Plus className="h-4 w-4" />
              상품 등록
            </Link>
            <Link
              href="/inventory/photo-card-match"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <ImageIcon className="h-4 w-4" />
              촬영본 연결
            </Link>
            <Link
              href="/listing-upload"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <UploadCloud className="h-4 w-4" />
              eBay 업로드
            </Link>
            <Link
              href="/listing-upload/templates"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              <Settings className="h-4 w-4" />
              Templates
            </Link>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
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
              className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
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
