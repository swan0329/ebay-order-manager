"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, RefreshCw, UploadCloud } from "lucide-react";

type UploadJob = {
  id: string;
  sku: string;
  source: string;
  action: string | null;
  status: string;
  message: string | null;
  error: string | null;
  createdAt: Date | string;
  product: {
    id: string;
    sku: string;
    productName: string;
    listingStatus: string | null;
    ebayItemId: string | null;
  } | null;
};

type ProductListingUploaderProps = {
  recentJobs: UploadJob[];
};

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function statusClass(status: string) {
  if (status === "success") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status === "failed") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }

  if (status === "running") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}

export function ProductListingUploader({ recentJobs }: ProductListingUploaderProps) {
  const router = useRouter();
  const [singleMessage, setSingleMessage] = useState("");
  const [excelMessage, setExcelMessage] = useState("");
  const [retryMessage, setRetryMessage] = useState("");
  const [singleLoading, setSingleLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);

  async function submitSingle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setSingleLoading(true);
    setSingleMessage("");
    const response = await fetch("/api/listings/upload/single", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku: formValue(form, "sku"),
        title: formValue(form, "title"),
        descriptionHtml: formValue(form, "descriptionHtml"),
        price: formValue(form, "price"),
        quantity: formValue(form, "quantity"),
        imageUrls: formValue(form, "imageUrls"),
        categoryId: formValue(form, "categoryId"),
        condition: formValue(form, "condition") || "NEW",
        shippingProfile: formValue(form, "shippingProfile"),
        returnProfile: formValue(form, "returnProfile"),
        paymentProfile: formValue(form, "paymentProfile") || null,
        merchantLocationKey: formValue(form, "merchantLocationKey") || null,
        marketplaceId: formValue(form, "marketplaceId") || "EBAY_US",
        currency: formValue(form, "currency") || "USD",
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { upload?: { error?: string; result?: { listingId?: string } }; error?: string }
      | null;

    setSingleLoading(false);
    setSingleMessage(
      response.ok
        ? data?.upload && "error" in data.upload
          ? `실패: ${data.upload.error}`
          : `완료: ${data?.upload?.result?.listingId ?? "업로드됨"}`
        : data?.error ?? "상품 업로드 실패",
    );
    router.refresh();
  }

  async function uploadExcel(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    setExcelLoading(true);
    setExcelMessage("");
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/listings/upload/excel", {
      method: "POST",
      body: form,
    });
    const data = (await response.json().catch(() => null)) as
      | {
          created?: number;
          updated?: number;
          success?: number;
          failed?: number;
          skipped?: number;
          error?: string;
        }
      | null;

    setExcelLoading(false);
    event.currentTarget.value = "";
    setExcelMessage(
      response.ok
        ? `등록 ${data?.created ?? 0} / 수정 ${data?.updated ?? 0} / 성공 ${
            data?.success ?? 0
          } / 실패 ${data?.failed ?? 0}${
            data?.skipped ? ` / 제외 ${data.skipped}` : ""
          }`
        : data?.error ?? "엑셀 업로드 실패",
    );
    router.refresh();
  }

  async function retryFailed() {
    setRetryLoading(true);
    setRetryMessage("");
    const response = await fetch("/api/listings/upload/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allFailed: true }),
    });
    const data = (await response.json().catch(() => null)) as
      | { retried?: number; success?: number; failed?: number; error?: string }
      | null;

    setRetryLoading(false);
    setRetryMessage(
      response.ok
        ? `재시도 ${data?.retried ?? 0} / 성공 ${data?.success ?? 0} / 실패 ${
            data?.failed ?? 0
          }`
        : data?.error ?? "재시도 실패",
    );
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-zinc-950">엑셀 업로드</h2>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800">
            <FileUp className="h-4 w-4" />
            {excelLoading ? "업로드 중" : "파일 선택"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={uploadExcel}
              className="sr-only"
            />
          </label>
        </div>
        {excelMessage ? <p className="text-sm text-zinc-600">{excelMessage}</p> : null}
      </section>

      <form onSubmit={submitSingle} className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-950">단일 상품 등록</h2>
          <button
            type="submit"
            disabled={singleLoading}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
          >
            <UploadCloud className="h-4 w-4" />
            {singleLoading ? "업로드 중" : "업로드"}
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <input name="sku" required placeholder="SKU" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <input name="title" required placeholder="title" maxLength={80} className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <input name="price" required type="number" min="0" step="0.01" placeholder="price" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <input name="quantity" required type="number" min="0" placeholder="quantity" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <input name="categoryId" required placeholder="category_id" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <select name="condition" defaultValue="NEW" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900">
            <option value="NEW">NEW</option>
            <option value="LIKE_NEW">LIKE_NEW</option>
            <option value="USED_EXCELLENT">USED_EXCELLENT</option>
            <option value="USED_VERY_GOOD">USED_VERY_GOOD</option>
            <option value="USED_GOOD">USED_GOOD</option>
          </select>
          <input name="shippingProfile" required placeholder="shipping_profile" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <input name="returnProfile" required placeholder="return_profile" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <input name="paymentProfile" placeholder="payment_profile" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <input name="merchantLocationKey" placeholder="merchant_location_key" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <input name="marketplaceId" defaultValue="EBAY_US" placeholder="marketplace_id" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <input name="currency" defaultValue="USD" placeholder="currency" className="h-10 rounded-md border border-zinc-300 px-3 text-sm outline-none focus:border-zinc-900" />
          <textarea name="imageUrls" required rows={3} placeholder="image_urls" className="md:col-span-2 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900" />
          <textarea name="descriptionHtml" required rows={5} placeholder="description_html" className="md:col-span-2 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-900" />
        </div>
        {singleMessage ? <p className="mt-3 text-sm text-zinc-600">{singleMessage}</p> : null}
      </form>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-zinc-950">업로드 상태</h2>
          <button
            type="button"
            onClick={retryFailed}
            disabled={retryLoading}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
          >
            <RefreshCw className="h-4 w-4" />
            실패 재시도
          </button>
        </div>
        {retryMessage ? <p className="mb-3 text-sm text-zinc-600">{retryMessage}</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">작업</th>
                <th className="px-3 py-2">eBay Item ID</th>
                <th className="px-3 py-2">메시지</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {recentJobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-3 py-2 font-medium text-zinc-950">{job.sku}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusClass(job.status)}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-700">
                    {[job.source, job.action].filter(Boolean).join(" / ") || "-"}
                  </td>
                  <td className="px-3 py-2 text-zinc-700">
                    {job.product?.ebayItemId ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-zinc-700">
                    <span className="line-clamp-2" title={job.error ?? job.message ?? ""}>
                      {job.error ?? job.message ?? "-"}
                    </span>
                  </td>
                </tr>
              ))}
              {!recentJobs.length ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                    업로드 이력이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
