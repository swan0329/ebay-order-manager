/* eslint-disable @next/next/no-img-element */
"use client";

import { productMember } from "@/lib/product-member";

import { productDisplayImageUrl, productDisplayImageLabel } from "@/lib/product-display-image";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { notifyProductDataChanged } from "@/lib/client-product-refresh";
import { Camera, PackageOpen, Save, Smartphone } from "lucide-react";
import {
  normalizeProductStatus,
  productStatusOptions,
} from "@/lib/product-status";
import {
  ebayListingUrl,
  shopifyAdminProductUrl,
} from "@/lib/channel-product-links";

export type ProductQuickEditValue = {
  id: string;
  sku: string;
  internalCode: string | null;
  productName: string;
  optionName: string | null;
  category: string | null;
  brand: string | null;
  costPrice: string | null;
  salePrice: string | null;
  isSoldOut?: boolean;
  pocamarketAvailableCount?: number | null;
  pocamarketSyncedAt?: string | null;
  pocamarketChangeStatus?: string | null;
  pocamarketPreviousPrice?: string | null;
  pocamarketPreviousAvailableCount?: number | null;
  ebayPrice: string | null;
  stockQuantity: number;
  safetyStock: number;
  location: string | null;
  memo: string | null;
  imageUrl: string | null;
  sourceImageUrl: string | null;
  imageSource: string | null;
  userImageRegistered: boolean;
  hasBackImage: boolean;
  imageWorkReady?: boolean;
  procurementSellable?: boolean;
  imageUpdatedAt?: string | null;
  status: string;
  featuredMembers: string | null;
  shopifyProductId: string | null;
  shopifyStatus?: string | null;
  shopifyLastUploadedAt: string | null;
  ebayItemId?: string | null;
  listingStatus?: string | null;
  ebayVariationItemId?: string | null;
  ebayVariationState?: "INCLUDED" | "PENDING" | null;
  ebayVariationTitle?: string | null;
  lastUploadedAt?: string | null;
};

function parseMembers(value: string | null | undefined) {
  return String(value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

// Member picker for "unit" cards — pick the real members from the group's roster.
// Non-unit rows just show the value (or "-"). Saves immediately via its own POST.
function MemberPicker({
  productId,
  isUnit,
  value,
  options,
}: {
  productId: string;
  isUnit: boolean;
  value: string | null;
  options: string[];
}) {
  const [members, setMembers] = useState(() => parseMembers(value));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setMembers(parseMembers(value)), 0);
    return () => window.clearTimeout(timer);
  }, [value]);

  async function commit(next: string[]) {
    setMembers(next);
    setSaving(true);
    try {
      await fetch("/api/inventory/featured-members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, members: next }),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!isUnit) {
    return <span className="text-xs text-zinc-400">{members.join(", ") || "-"}</span>;
  }

  return (
    <div className="space-y-1">
      {members.length ? (
        <div className="flex flex-wrap gap-1">
          {members.map((member) => (
            <span
              key={member}
              className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-zinc-800 ring-1 ring-amber-200"
            >
              {member}
              <button
                type="button"
                onClick={() => void commit(members.filter((name) => name !== member))}
                disabled={saving}
                aria-label={`${member} 제거`}
                className="text-zinc-400 hover:text-rose-600 disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <select
        value=""
        onChange={(event) => {
          const picked = event.currentTarget.value;
          if (picked && !members.includes(picked)) {
            void commit([...members, picked]);
          }
          event.currentTarget.value = "";
        }}
        disabled={saving || options.length === 0}
        className="h-8 w-full rounded-md border border-amber-300 bg-white px-2 text-xs outline-none focus:border-amber-500 disabled:opacity-50"
      >
        <option value="">{options.length ? "+ 멤버 추가" : "멤버 불러오는 중…"}</option>
        {options
          .filter((member) => !members.includes(member))
          .map((member) => (
            <option key={member} value={member}>
              {member}
            </option>
          ))}
      </select>
    </div>
  );
}

type EditableState = {
  productName: string;
  brand: string;
  category: string;
  optionName: string;
  stockQuantity: string;
  salePrice: string;
  ebayPrice: string;
  memo: string;
  status: string;
};

function toState(product: ProductQuickEditValue): EditableState {
  return {
    productName: product.productName,
    brand: product.brand ?? "",
    category: product.category ?? "",
    optionName: product.optionName ?? "",
    stockQuantity: String(product.stockQuantity),
    salePrice: product.salePrice ?? "",
    ebayPrice: product.ebayPrice ?? "",
    memo: product.memo ?? "",
    status: normalizeProductStatus(product.status),
  };
}

function editableStateKey(value: EditableState) {
  return [
    value.productName,
    value.brand,
    value.category,
    value.optionName,
    value.stockQuantity,
    value.salePrice,
    value.ebayPrice,
    value.memo,
    value.status,
  ].join("\x1f");
}

function sameEditableState(left: EditableState, right: EditableState) {
  return editableStateKey(left) === editableStateKey(right);
}

function fieldClass(extra = "") {
  return `h-9 w-full min-w-0 rounded-md border border-zinc-300 px-2 text-xs outline-none focus:border-zinc-900 ${extra}`;
}

const defaultVisibleColumnIds = [
  "select",
  "sku",
  "stockQuantity",
  "brand",
  "category",
  "optionName",
  "featuredMembers",
  "imageUrl",
  "ebayPrice",
  "salePrice",
  "pocamarketStock",
  "pocamarketSyncedAt",
  "memo",
  "productName",
  "status",
  "shopify",
  "save",
];

function ShopifyStatusCell({
  product,
  storeHandle,
}: {
  product: ProductQuickEditValue;
  storeHandle: string | null;
}) {
  if (!product.shopifyProductId) {
    return (
      <span className="inline-flex w-fit items-center rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500">
        미업로드
      </span>
    );
  }

  const productUrl = storeHandle
    ? `/api/products/${encodeURIComponent(product.id)}/shopify-link?view=storefront`
    : null;

  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex w-fit items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        {product.shopifyStatus === "PRICE_HOLD" ? "가격 미확정 · 판매 보류" : product.shopifyStatus === "publication_pending" ? "상품 등록됨 · 게시 대기" : product.shopifyStatus?.toLowerCase() === "archived" ? "보관됨" : product.shopifyStatus?.toLowerCase() === "draft" ? "초안" : "상품 등록됨"}
      </span>
      {product.shopifyLastUploadedAt ? (
        <span className="text-[10px] text-zinc-400">
          {new Date(product.shopifyLastUploadedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
        </span>
      ) : null}
      {productUrl ? (
        <a
          href={productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-[11px] text-emerald-700 underline-offset-2 hover:underline"
        >
          판매페이지 ↗
        </a>
      ) : null}
      {shopifyAdminProductUrl(storeHandle, product.shopifyProductId) ? <a href={shopifyAdminProductUrl(storeHandle, product.shopifyProductId)!} target="_blank" rel="noopener noreferrer" className="w-fit text-[11px] text-zinc-500 hover:underline">상품 관리 ↗</a> : null}
    </div>
  );
}

function PocamarketProductPurchaseButton({
  product,
}: {
  product: ProductQuickEditValue;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [requestedQuantity, setRequestedQuantity] = useState("1");
  const referencePrice = Number(product.salePrice);
  const soldOut = product.isSoldOut || product.pocamarketAvailableCount === 0;
  const disabledReason = soldOut
    ? "포카마켓 품절"
    : !Number.isFinite(referencePrice) || referencePrice <= 0
      ? "기준가격 없음"
      : null;

  async function requestPurchase() {
    if (disabledReason || loading) return;
    const quantity = Number(requestedQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      setMessage("수량은 1개부터 20개까지 입력해 주세요.");
      return;
    }
    if (!window.confirm(
      `${product.sku} ${quantity}개를 휴대전화 구매 대기열에 추가할까요? 기준가격의 120%를 넘으면 구매하지 않으며 결제 직전에 사람 확인이 필요합니다. 구매 후 실제 보유 수량은 재고에서 직접 추가해 주세요.`,
    )) return;

    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/pocamarket-purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: product.id, requestedQuantity: quantity }),
      });
      const body = await response.json() as {
        error?: string;
        created?: Array<{ quantity: number; maxUnitPrice: number }>;
      };
      if (!response.ok) throw new Error(body.error ?? "구매 요청에 실패했습니다.");
      const createdQuantity = (body.created ?? []).reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      const maxPrice = body.created?.[0]?.maxUnitPrice;
      setMessage(
        `${createdQuantity}개 휴대전화 대기 완료${maxPrice ? ` · 최대 ${maxPrice.toLocaleString()}원` : ""}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "구매 요청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        <input
          type="number"
          min="1"
          max="20"
          step="1"
          value={requestedQuantity}
          onChange={(event) => setRequestedQuantity(event.currentTarget.value)}
          disabled={Boolean(disabledReason) || loading}
          aria-label={`${product.sku} 구매 수량`}
          className="h-8 w-14 rounded-md border border-zinc-300 px-1 text-center text-[11px] disabled:bg-zinc-100"
        />
        <button
          type="button"
          onClick={requestPurchase}
          disabled={Boolean(disabledReason) || loading}
          title={disabledReason ?? "상품을 휴대전화 구매 대기열에 추가"}
          className="inline-flex min-h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
        >
          <Smartphone className="h-3.5 w-3.5" />
          {loading ? "요청 중…" : disabledReason ?? "폰으로 구매"}
        </button>
      </div>
      {message ? <p className="text-[10px] leading-4 text-zinc-600">{message}</p> : null}
    </div>
  );
}

function EbayStatusCell({ product }: { product: ProductQuickEditValue }) {
  const [reviewBusy, setReviewBusy] = useState<"confirm" | "disconnect" | "request_reconnect" | "cancel_reconnect" | "reopen_review" | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewResolved, setReviewResolved] = useState<"confirm" | "disconnect" | "request_reconnect" | "cancel_reconnect" | "reopen_review" | null>(null);
  async function resolveReview(action: "confirm" | "disconnect" | "request_reconnect" | "cancel_reconnect" | "reopen_review") {
    setReviewBusy(action); setReviewError("");
    try {
      const response = await fetch(`/api/products/${product.id}/ebay-link-review`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "연결을 처리하지 못했습니다.");
      setReviewResolved(action);
      setReviewBusy(null);
      notifyProductDataChanged();
    } catch (error) { setReviewError(error instanceof Error ? error.message : "연결을 처리하지 못했습니다."); setReviewBusy(null); }
  }
  const directStatus = (product.listingStatus ?? "").toUpperCase();
  const directIsActive = ["ACTIVE", "PUBLISHED", "LISTED"].includes(directStatus);
  const directUrl = ebayListingUrl(product.ebayItemId);
  const variationUrl = ebayListingUrl(product.ebayVariationItemId);

  if (reviewResolved) {
    if (reviewResolved === "cancel_reconnect") {
      return <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 font-semibold text-zinc-700">eBay 등록정보 미연결</span>;
    }
    if (reviewResolved === "reopen_review") {
      return <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-800">eBay 연결 검토 필요</span>;
    }
    if (reviewResolved === "request_reconnect") {
      return (
        <div className="flex flex-col gap-1">
          <span className="inline-flex w-fit rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-800">연결 복구 검토 필요</span>
          <a href={`/products/ebay-link?productSku=${encodeURIComponent(product.sku)}`} className="text-[11px] text-blue-700 underline">eBay 사진과 대조해 연결 ↗</a>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <span className={`inline-flex w-fit rounded-full px-2 py-1 font-semibold ${reviewResolved === "confirm" ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"}`}>
          {reviewResolved === "confirm" ? "정상 연결 확정 완료" : "잘못된 연결 해제 완료"}
        </span>
        <span className="text-[11px] text-zinc-500">새로고침 없이 처리됐습니다.</span>
      </div>
    );
  }

  if (
    product.listingStatus !== "REVIEW_REQUIRED" &&
    product.ebayVariationState === "INCLUDED" &&
    variationUrl
  ) {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit rounded-full bg-violet-100 px-2 py-1 font-semibold text-violet-800">
          eBay 옵션으로 등록됨
        </span>
        {directStatus === "ENDED" ? (
          <span className="text-[11px] text-zinc-500">기존 단품 ENDED</span>
        ) : null}
        <a
          href={variationUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={product.ebayVariationTitle ?? undefined}
          className="w-fit text-[11px] text-violet-700 underline-offset-2 hover:underline"
        >
          eBay 옵션상품 보기 ↗
        </a>
      </div>
    );
  }

  if (
    product.listingStatus !== "REVIEW_REQUIRED" &&
    product.ebayVariationState === "PENDING"
  ) {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">
          eBay 옵션 등록 대기
        </span>
        <span className="text-[11px] text-zinc-500">
          {directStatus === "ENDED" ? "기존 단품 ENDED · " : ""}아직 옵션 미반영
        </span>
        {variationUrl ? (
          <a
            href={variationUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={product.ebayVariationTitle ?? undefined}
            className="w-fit text-[11px] text-amber-700 underline-offset-2 hover:underline"
          >
            옵션 부모상품 보기 ↗
          </a>
        ) : null}
      </div>
    );
  }

  if (
    product.listingStatus !== "REVIEW_REQUIRED" &&
    product.ebayItemId &&
    directStatus === "ENDED"
  ) {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit rounded-full bg-zinc-200 px-2 py-1 font-semibold text-zinc-700">
          eBay 단품 종료됨
        </span>
        <span className="text-[11px] text-zinc-500">현재 단품 판매 안 됨</span>
      </div>
    );
  }

  if (product.ebayItemId && product.listingStatus === "REVIEW_REQUIRED") {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-800">
          eBay 연결 검토 필요
        </span>
        <span className="text-[11px] text-rose-700">
          자동 가격·수량·이미지 반영 차단됨
        </span>
        {directUrl ? (
          <a
            href={directUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-[11px] text-blue-700 underline-offset-2 hover:underline"
          >
            eBay 상품 보기 ↗
          </a>
        ) : null}
        <div className="flex flex-wrap gap-1">
          <button type="button" disabled={reviewBusy !== null} onClick={() => void resolveReview("confirm")} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
            {reviewBusy === "confirm" ? "처리 중" : "같은 카드 · 정상 확정"}
          </button>
          <button type="button" disabled={reviewBusy !== null} onClick={() => void resolveReview("disconnect")} className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
            {reviewBusy === "disconnect" ? "처리 중" : "다른 카드 · 연결 해제"}
          </button>
        </div>
        {reviewError ? <span className="text-[11px] text-rose-700">{reviewError}</span> : null}
      </div>
    );
  }

  if (!product.ebayItemId && product.listingStatus === "REVIEW_REQUIRED") {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-800">연결 복구 검토 필요</span>
        <a href={`/products/ebay-link?productSku=${encodeURIComponent(product.sku)}`} className="text-[11px] text-blue-700 underline">eBay 사진과 대조해 연결 ↗</a>
        <button type="button" disabled={reviewBusy !== null} onClick={() => void resolveReview("cancel_reconnect")} className="w-fit text-[11px] text-zinc-600 underline disabled:opacity-50">
          {reviewBusy === "cancel_reconnect" ? "취소 중" : "복구 검토 취소"}
        </button>
      </div>
    );
  }

  if (product.ebayItemId) {
    return (
      <div className="flex flex-col gap-1">
        <span className={`inline-flex w-fit rounded-full px-2 py-1 font-semibold ${directIsActive ? "bg-blue-100 text-blue-800" : "bg-zinc-100 text-zinc-700"}`}>
          {directIsActive ? "eBay 단품 판매중" : "eBay 등록정보 연결됨"}
        </span>
        <span className="text-[11px] text-zinc-500">
          {product.listingStatus || "상태 미확인"}
        </span>
        {directUrl ? (
          <a
            href={directUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit text-[11px] text-blue-700 underline-offset-2 hover:underline"
          >
            eBay 상품 보기 ↗
          </a>
        ) : null}
        <button type="button" disabled={reviewBusy !== null} onClick={() => void resolveReview("reopen_review")} className="w-fit text-[11px] text-amber-700 underline disabled:opacity-50">
          {reviewBusy === "reopen_review" ? "전환 중" : "연결 다시 검토"}
        </button>
      </div>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 font-semibold text-zinc-700">
      eBay 등록정보 미연결
    </span>
  );
}

function PhotoThumb({
  src,
  label,
  registered,
  showCamera,
  sizeClass,
  onClick,
}: {
  src: string | null;
  label: string;
  registered: boolean;
  showCamera: boolean;
  sizeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 ring-1 ring-zinc-200 transition hover:ring-zinc-900`}
      title={`${label} 이미지 보기 · 촬영본 등록`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <PackageOpen className="h-5 w-5 text-zinc-400" />
      )}
      <span
        className={`absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-semibold shadow-sm ${
          registered ? "bg-emerald-600 text-white" : "bg-zinc-950 text-white"
        }`}
      >
        {label}
      </span>
      {showCamera ? (
        <span className="absolute right-1 top-1 rounded bg-white/90 p-1 text-zinc-700 opacity-0 shadow-sm transition group-hover:opacity-100">
          <Camera className="h-3 w-3" />
        </span>
      ) : null}
    </button>
  );
}

function ProductImageButton({
  product,
  sizeClass,
  onClick,
}: {
  product: ProductQuickEditValue;
  sizeClass: string;
  onClick: () => void;
}) {
  const t = product.imageUpdatedAt ? new Date(product.imageUpdatedAt).getTime() : null;
  const frontUrl = productDisplayImageUrl(product);
  const backUrl = product.hasBackImage && t
    ? `/api/products/image-match/assets/${product.id}/back?t=${t}`
    : null;

  if (backUrl) {
    return (
      <div className="flex gap-1">
        <PhotoThumb
          src={frontUrl}
          label="앞"
          registered
          showCamera={false}
          sizeClass={sizeClass}
          onClick={onClick}
        />
        <PhotoThumb
          src={backUrl}
          label="뒤"
          registered
          showCamera
          sizeClass={sizeClass}
          onClick={onClick}
        />
      </div>
    );
  }

  return (
    <PhotoThumb
      src={frontUrl}
      label={productDisplayImageLabel(product)}
      registered={productDisplayImageLabel(product) !== "포카마켓"}
      showCamera
      sizeClass={sizeClass}
      onClick={onClick}
    />
  );
}

export function ProductQuickEditRow({
  product,
  visibleColumnIds = defaultVisibleColumnIds,
  selected = false,
  memberOptions = [],
  shopifyStoreHandle = null,
  onSelectedChange,
  onPhotoUploadClick,
}: {
  product: ProductQuickEditValue;
  visibleColumnIds?: string[];
  selected?: boolean;
  memberOptions?: string[];
  shopifyStoreHandle?: string | null;
  onSelectedChange?: (checked: boolean) => void;
  onPhotoUploadClick?: (product: ProductQuickEditValue) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(() => toState(product));
  const [savedValue, setSavedValue] = useState(() => toState(product));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const visibleColumns = new Set(visibleColumnIds);
  const dirty = !sameEditableState(value, savedValue);

  function setField(key: keyof EditableState, nextValue: string) {
    setMessage("");
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  function saveOnEnter(
    event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  }

  async function save() {
    if (saving || !dirty) {
      return;
    }

    const submittedValue = value;
    setSaving(true);
    setMessage("");

    const response = await fetch(`/api/products/${product.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku: product.sku,
        internalCode: product.internalCode,
        productName: submittedValue.productName,
        optionName: submittedValue.optionName,
        category: submittedValue.category,
        brand: submittedValue.brand,
        costPrice: product.costPrice,
        salePrice: submittedValue.salePrice,
        ebayPrice: submittedValue.ebayPrice,
        stockQuantity: submittedValue.stockQuantity,
        safetyStock: product.safetyStock,
        location: product.location,
        memo: submittedValue.memo,
        imageUrl: product.imageUrl,
        status: submittedValue.status,
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    setSaving(false);

    if (!response.ok) {
      setMessage(data?.error ?? "저장 실패");
      return;
    }

    setSavedValue(submittedValue);
    setMessage("저장됨");
    notifyProductDataChanged();
    router.refresh();
  }

  return (
    <tr className="align-top hover:bg-zinc-50">
      {visibleColumns.has("select") ? (
        <td className="px-2 py-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange?.(event.currentTarget.checked)}
            aria-label={`${product.sku} 선택`}
            className="h-4 w-4 rounded border-zinc-300"
          />
        </td>
      ) : null}
      {visibleColumns.has("imageSource") ? (
        <td className="px-2 py-3">
          {product.userImageRegistered ? (
            <span className="inline-flex rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">직접 촬영</span>
          ) : productDisplayImageLabel(product) === "Lens 작업" ? (
            <span className="inline-flex rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">Lens 작업</span>
          ) : (
            <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600">포카마켓</span>
          )}
        </td>
      ) : null}
      {visibleColumns.has("sku") ? (
        <td className="px-2 py-3 font-medium text-zinc-900">
          <Link
            href={`/products/${product.id}`}
            prefetch={false}
            className="block truncate hover:underline"
            title={product.sku}
          >
            {product.sku}
          </Link>
          {dirty ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="mt-2 inline-flex h-7 items-center gap-1 rounded-md bg-zinc-950 px-2 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
            >
              <Save className="h-3 w-3" />
              저장
            </button>
          ) : message ? (
            <p className="mt-2 text-xs text-zinc-500">{message}</p>
          ) : null}
        </td>
      ) : null}
      {visibleColumns.has("stockQuantity") ? (
        <td className="px-2 py-3">
          <input
            value={value.stockQuantity}
            onChange={(event) => setField("stockQuantity", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            type="number"
            min="0"
            className={fieldClass()}
          />
          {dirty ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="mt-1 inline-flex h-7 w-full items-center justify-center rounded-md bg-zinc-950 px-2 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
            >
              저장
            </button>
          ) : null}
        </td>
      ) : null}
      {visibleColumns.has("sellability") ? (
        <td className="px-2 py-3 text-xs">
          {product.stockQuantity > 0 && product.imageWorkReady ? (
            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">
              보유재고 판매
            </span>
          ) : product.procurementSellable ? (
            <span className="inline-flex rounded-full bg-violet-100 px-2 py-1 font-semibold text-violet-800">
              포카 조달판매
            </span>
          ) : product.stockQuantity > 0 ||
            (product.pocamarketAvailableCount ?? 0) > 0 ? (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">
              이미지 작업 필요
            </span>
          ) : !product.pocamarketSyncedAt ? (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">
              최신화 필요
            </span>
          ) : product.ebayItemId &&
            ["ACTIVE", "PUBLISHED", "LISTED"].includes(
              (product.listingStatus ?? "ACTIVE").toUpperCase(),
            ) ? (
            <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-800">
              판매중단 필요
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-zinc-200 px-2 py-1 font-semibold text-zinc-700">
              품절
            </span>
          )}
        </td>
      ) : null}
      {visibleColumns.has("uploadStatus") ? (
        <td className="px-2 py-3 text-xs">
          <EbayStatusCell product={product} />
        </td>
      ) : null}
      {visibleColumns.has("shopify") ? (
        <td className="px-2 py-3">
          <ShopifyStatusCell product={product} storeHandle={shopifyStoreHandle} />
        </td>
      ) : null}
      {visibleColumns.has("brand") ? (
        <td className="px-2 py-3">
          <input
            value={value.brand}
            onChange={(event) => setField("brand", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("category") ? (
        <td className="px-2 py-3">
          <input
            value={value.category}
            onChange={(event) => setField("category", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("optionName") ? (
        <td className="px-2 py-3">
          {productMember(value.optionName) !== value.optionName && <div className="mb-1 text-sm font-semibold">{productMember(value.optionName)}<span className="block text-[10px] font-normal text-zinc-500">카드 구분 / 원본 옵션</span></div>}
          <input
            aria-label="멤버 및 카드 구분 원본 옵션"
            value={value.optionName}
            onChange={(event) => setField("optionName", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("featuredMembers") ? (
        <td className="px-2 py-3 align-top">
          <MemberPicker
            productId={product.id}
            isUnit={value.optionName.trim().toLowerCase() === "unit"}
            value={product.featuredMembers}
            options={memberOptions}
          />
        </td>
      ) : null}
      {visibleColumns.has("imageUrl") ? (
        <td className="px-2 py-3">
          <ProductImageButton
            product={product}
            sizeClass="h-16 w-16"
            onClick={() => onPhotoUploadClick?.(product)}
          />
        </td>
      ) : null}
      {visibleColumns.has("ebayPrice") ? (
        <td className="px-2 py-3">
          <input
            value={value.ebayPrice}
            onChange={(event) => setField("ebayPrice", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            type="number"
            min="0"
            step="0.01"
            placeholder="$"
            title="가격 후보입니다. 판매 채널 가격은 가격관리에서 최종 USD 가격을 확정한 뒤에만 반영됩니다."
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("salePrice") ? (
        <td className="px-2 py-3">
          {product.pocamarketPreviousPrice &&
          Number(product.pocamarketPreviousPrice) !== Number(product.salePrice) ? (
            <span className={`mb-1 block text-[11px] font-semibold ${
              Number(product.salePrice) > Number(product.pocamarketPreviousPrice)
                ? "text-rose-600"
                : "text-blue-600"
            }`}>
              {Number(product.salePrice) > Number(product.pocamarketPreviousPrice)
                ? "가격 상승"
                : "가격 하락"}
            </span>
          ) : null}
          <input
            value={value.salePrice}
            onChange={(event) => setField("salePrice", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            type="number"
            min="0"
            step="0.01"
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("pocamarketStock") ? (
        <td className="px-2 py-3 text-xs">
          {product.pocamarketAvailableCount === null ||
          product.pocamarketAvailableCount === undefined ? (
            <span className="text-zinc-400">미확인</span>
          ) : product.isSoldOut || product.pocamarketAvailableCount === 0 ? (
            <span className="font-semibold text-rose-600">품절 (0)</span>
          ) : (
            <>
              <span className="font-semibold text-emerald-700">
                {product.pocamarketAvailableCount.toLocaleString()}개 매물
              </span>
              {product.pocamarketPreviousAvailableCount !== null &&
              product.pocamarketPreviousAvailableCount !== undefined &&
              product.pocamarketPreviousAvailableCount !==
                product.pocamarketAvailableCount ? (
                <span className="mt-1 block text-[11px] text-amber-700">
                  이전 {product.pocamarketPreviousAvailableCount.toLocaleString()}개
                </span>
              ) : null}
            </>
          )}
          <PocamarketProductPurchaseButton product={product} />
        </td>
      ) : null}
      {visibleColumns.has("pocamarketSyncedAt") ? (
        <td className="px-2 py-3 text-xs text-zinc-600">
          {product.pocamarketSyncedAt
            ? new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(new Date(product.pocamarketSyncedAt))
            : "미확인"}
        </td>
      ) : null}
      {visibleColumns.has("memo") ? (
        <td className="px-2 py-3">
          <input
            value={value.memo}
            onChange={(event) => setField("memo", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("productName") ? (
        <td className="px-2 py-3">
          <input
            value={value.productName}
            onChange={(event) => setField("productName", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass()}
          />
        </td>
      ) : null}
      {visibleColumns.has("status") ? (
        <td className="px-2 py-3">
          <select
            value={value.status}
            onChange={(event) => setField("status", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={fieldClass("text-sm")}
          >
            {productStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </td>
      ) : null}
      {visibleColumns.has("save") ? (
        <td className="px-2 py-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            title={dirty ? "저장" : "변경 없음"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
          >
            <Save className="h-4 w-4" />
          </button>
          {message ? <p className="mt-1 text-xs text-zinc-500">{message}</p> : null}
        </td>
      ) : null}
    </tr>
  );
}

export function ProductQuickEditCard({
  product,
  selected = false,
  memberOptions = [],
  shopifyStoreHandle = null,
  onSelectedChange,
  onPhotoUploadClick,
}: {
  product: ProductQuickEditValue;
  selected?: boolean;
  memberOptions?: string[];
  shopifyStoreHandle?: string | null;
  onSelectedChange?: (checked: boolean) => void;
  onPhotoUploadClick?: (product: ProductQuickEditValue) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(() => toState(product));
  const [savedValue, setSavedValue] = useState(() => toState(product));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = !sameEditableState(value, savedValue);

  function setField(key: keyof EditableState, nextValue: string) {
    setMessage("");
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  function saveOnEnter(
    event: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
  }

  async function save() {
    if (saving || !dirty) {
      return;
    }

    const submittedValue = value;
    setSaving(true);
    setMessage("");

    const response = await fetch(`/api/products/${product.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku: product.sku,
        internalCode: product.internalCode,
        productName: submittedValue.productName,
        optionName: submittedValue.optionName,
        category: submittedValue.category,
        brand: submittedValue.brand,
        costPrice: product.costPrice,
        salePrice: submittedValue.salePrice,
        ebayPrice: submittedValue.ebayPrice,
        stockQuantity: submittedValue.stockQuantity,
        safetyStock: product.safetyStock,
        location: product.location,
        memo: submittedValue.memo,
        imageUrl: product.imageUrl,
        status: submittedValue.status,
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    setSaving(false);

    if (!response.ok) {
      setMessage(data?.error ?? "저장 실패");
      return;
    }

    setSavedValue(submittedValue);
    setMessage("저장됨");
    notifyProductDataChanged();
    router.refresh();
  }

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4">
      <label className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-700">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange?.(event.currentTarget.checked)}
          className="h-4 w-4 rounded border-zinc-300"
        />
        선택
      </label>
      <div className="mb-3 flex gap-3">
        <ProductImageButton
          product={product}
          sizeClass="h-20 w-20 shrink-0"
          onClick={() => onPhotoUploadClick?.(product)}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/products/${product.id}`}
            prefetch={false}
            className="text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline"
          >
            {product.sku}
          </Link>
          <input
            value={value.productName}
            onChange={(event) => setField("productName", event.currentTarget.value)}
            onKeyDown={saveOnEnter}
            className={`${fieldClass()} mt-2`}
          />
          {dirty ? (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
            >
              <Save className="h-4 w-4" />
              변경 저장
            </button>
          ) : null}
          <div className="mt-2">
            <EbayStatusCell product={product} />
          </div>
          <div className="mt-2">
            <ShopifyStatusCell product={product} storeHandle={shopifyStoreHandle} />
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={value.stockQuantity}
          onChange={(event) => setField("stockQuantity", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          type="number"
          min="0"
          className={fieldClass()}
          aria-label="재고"
        />
        <select
          value={value.status}
          onChange={(event) => setField("status", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={fieldClass()}
          aria-label="상태"
        >
          {productStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          value={value.brand}
          onChange={(event) => setField("brand", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={fieldClass()}
          aria-label="그룹명"
        />
        <input
          value={value.optionName}
          onChange={(event) => setField("optionName", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={fieldClass()}
          aria-label="멤버"
        />
        <input
          value={value.category}
          onChange={(event) => setField("category", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={`${fieldClass()} sm:col-span-2`}
          aria-label="앨범명"
        />
        <input
          value={value.ebayPrice}
          onChange={(event) => setField("ebayPrice", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          type="number"
          min="0"
          step="0.01"
          placeholder="$"
          className={fieldClass()}
          aria-label="달러 가격 (USD)"
        />
        <input
          value={value.salePrice}
          onChange={(event) => setField("salePrice", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          type="number"
          min="0"
          step="0.01"
          className={fieldClass()}
          aria-label="포카마켓 가격"
        />
        <input
          value={value.memo}
          onChange={(event) => setField("memo", event.currentTarget.value)}
          onKeyDown={saveOnEnter}
          className={fieldClass()}
          aria-label="원본 앨범명"
        />
      </div>
      {value.optionName.trim().toLowerCase() === "unit" ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2">
          <p className="mb-1 text-xs font-semibold text-amber-800">유닛 — 포함 멤버 지정</p>
          <MemberPicker
            productId={product.id}
            isUnit
            value={product.featuredMembers}
            options={memberOptions}
          />
        </div>
      ) : null}
      <div className="mt-3 rounded-md border border-rose-100 bg-rose-50 p-2">
        <p className="text-xs font-semibold text-rose-800">
          포카마켓 {product.pocamarketAvailableCount ?? "미확인"}개 매물
        </p>
        <PocamarketProductPurchaseButton product={product} />
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {message ? <p className="text-xs text-zinc-500">{message}</p> : null}
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:cursor-wait disabled:text-zinc-400"
        >
          <Save className="h-4 w-4" />
          저장
        </button>
      </div>
    </article>
  );
}
