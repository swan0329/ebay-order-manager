"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, UploadCloud } from "lucide-react";

type TemplateOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

export function ListingExcelUploader({ templates }: { templates: TemplateOption[] }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(
    templates.find((template) => template.isDefault)?.id ?? templates[0]?.id ?? "",
  );
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const sampleXlsxHref = useMemo(
    () =>
      `/api/listings/upload/sample?format=xlsx${
        templateId ? `&templateId=${encodeURIComponent(templateId)}` : ""
      }`,
    [templateId],
  );
  const sampleCsvHref = useMemo(
    () =>
      `/api/listings/upload/sample?format=csv${
        templateId ? `&templateId=${encodeURIComponent(templateId)}` : ""
      }`,
    [templateId],
  );

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");

    if (!(file instanceof File) || !file.name) {
      setMessage("엑셀 또는 CSV 파일을 선택해 주세요.");
      return;
    }

    form.set("templateId", templateId);
    setUploading(true);
    setMessage("");

    const response = await fetch("/api/listing-upload/drafts/from-excel", {
      method: "POST",
      body: form,
    });
    const data = (await response.json().catch(() => null)) as
      | { created?: number; error?: string }
      | null;

    setUploading(false);
    if (!response.ok) {
      setMessage(data?.error ?? "Draft 생성 실패");
      return;
    }

    setMessage(`${data?.created ?? 0}개 draft를 저장했습니다. 작업내역에서 검증 상태를 확인해 주세요.`);
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
        <p className="text-sm font-semibold text-blue-900">권장 순서</p>
        <p className="mt-1 text-sm text-blue-800">
          1) 템플릿 다운로드 2) 데이터 입력 3) 파일 업로드 후 Draft 검증
        </p>
      </div>

      <form onSubmit={upload} className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">업로드 템플릿</span>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900"
            >
              <option value="">템플릿 없음</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.isDefault ? " (기본)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-600">엑셀/CSV 파일</span>
            <input
              name="file"
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="block h-10 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1 file:text-sm file:font-medium focus:border-zinc-900"
            />
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-400"
          >
            <UploadCloud className="h-4 w-4" />
            {uploading ? "Draft 저장 중..." : "Draft 저장"}
          </button>
          <a
            href={sampleXlsxHref}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            <Download className="h-4 w-4" />
            템플릿 XLSX
          </a>
          <a
            href={sampleCsvHref}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            <Download className="h-4 w-4" />
            템플릿 CSV
          </a>
          <Link
            href="/listing-upload/jobs"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            작업내역
          </Link>
        </div>

        {message ? (
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
