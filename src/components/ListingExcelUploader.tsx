"use client";

import { useState } from "react";
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

    setMessage(`${data?.created ?? 0}개 draft를 저장했습니다.`);
    event.currentTarget.reset();
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
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

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-400"
          >
            <UploadCloud className="h-4 w-4" />
            Draft 저장
          </button>
          <Link
            href={`/api/listings/upload/sample?format=xlsx${
              templateId ? `&templateId=${encodeURIComponent(templateId)}` : ""
            }`}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            <Download className="h-4 w-4" />
            샘플 파일
          </Link>
          <Link
            href="/listing-upload/jobs"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            작업내역
          </Link>
          {message ? <span className="text-sm text-zinc-600">{message}</span> : null}
        </div>
      </form>
    </section>
  );
}
