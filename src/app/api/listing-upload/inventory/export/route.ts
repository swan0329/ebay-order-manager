import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { z } from "zod";
import {
  buildEbayListingCategoryId,
  buildEbayListingCategoryName,
  buildEbayListingConditionId,
  buildEbayListingDescription,
  buildEbayListingImageUrls,
  buildEbayListingItemSpecificArrays,
  buildEbayListingItemSpecifics,
  buildEbayListingTitle,
  type ProductImageExtras,
} from "@/lib/ebay-listing-fields";
import { asErrorMessage, jsonError } from "@/lib/http";
import { hasListingPrice, resolveListingPriceUsd } from "@/lib/listing-price";
import {
  productImageExtrasById,
  withProductImageExtras,
} from "@/lib/product-export-image-extras";
import { prisma } from "@/lib/prisma";
import { getOperationalProductIds } from "@/lib/product-operations";
import { ensureImageWorkAssignments } from "@/lib/image-work-assignments";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import {
  mergeListingUploadDrafts,
  type ListingUploadDraft,
} from "@/lib/services/listingUploadInput";
import {
  listingTemplateToDefaults,
  resolveListingTemplateDefaults,
} from "@/lib/services/listingTemplateService";

const schema = z.object({
  productIds: z.array(z.string().min(1)).max(5000).optional(),
  templateId: z.string().optional().nullable(),
  // When true, export every unlisted product (ignores productIds / current page)
  allUnlisted: z.boolean().optional(),
  lensOnly: z.boolean().optional(),
  // When true, export the union of general + Lens-approved unlisted products.
  combined: z.boolean().optional(),
  // When true, export only directly-photographed, own-stock, unlisted products.
  ownPhotoOnly: z.boolean().optional(),
});

function readEbayTemplate(): XLSX.WorkBook | null {
  const templatePath = path.join(
    process.cwd(),
    "public",
    "templates",
    "eBay-category-listing-template.xlsx",
  );
  if (!fs.existsSync(templatePath)) {
    return null;
  }

  const buffer = fs.readFileSync(templatePath);
  return XLSX.read(new Uint8Array(buffer), { type: "array" });
}

type ProductForExport = Awaited<ReturnType<typeof getProducts>>[number];
type PolicyLookup = Awaited<ReturnType<typeof policyLookup>>;

function text(value: unknown) {
  const output = String(value ?? "").trim();
  return output ? output : "";
}

function boolText(value: unknown) {
  return value === true ? "1" : "";
}

function imageText(value: ListingUploadDraft["imageUrls"]) {
  const urls = Array.isArray(value) ? value : String(value ?? "").split(/[\n,;|]+/);

  return urls.map(text).filter(Boolean).join("|");
}

function renderTitle(template: string | null | undefined, draft: ListingUploadDraft) {
  if (!template) {
    return text(draft.title);
  }

  const replacements: Record<string, string> = {
    title: text(draft.title),
    sku: text(draft.sku),
    price: text(draft.price),
    quantity: text(draft.quantity),
    brand: text(draft.brand),
    condition: text(draft.condition),
  };

  return template.replace(
    /\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g,
    (_, key: string) => replacements[key] ?? "",
  );
}

// Renders the template's description HTML per product, substituting {title} etc.
// so each listing shows its own product name on top with a shared body below.
// Falls back to the product's own description when no template body is set.
function renderDescription(
  template: string | null | undefined,
  draft: ListingUploadDraft,
  title: string,
) {
  const source = template && template.trim() ? template : text(draft.descriptionHtml);
  if (!source) {
    return "";
  }

  const replacements: Record<string, string> = {
    title: text(title),
    sku: text(draft.sku),
    price: text(draft.price),
    quantity: text(draft.quantity),
    brand: text(draft.brand),
    condition: text(draft.condition),
  };

  return source.replace(
    /\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g,
    (_, key: string) => replacements[key] ?? "",
  );
}

function listingFormat(value: unknown) {
  const normalized = text(value).toUpperCase().replace(/[-_\s]/g, "");

  if (normalized === "CHINESE" || normalized === "AUCTION") {
    return "Auction";
  }

  // Seller Hub Reports upload expects "FixedPrice" — NOT the API enum FIXED_PRICE
  // (the template's ListingStaticData sheet only allows Auction / FixedPrice)
  return "FixedPrice";
}

function productDraft(
  product: ProductForExport & ProductImageExtras,
  baseUrl: string,
  recommendedPrice: string,
) {
  const itemSpecifics = buildEbayListingItemSpecifics(product);

  return {
    sku: product.sku,
    title: buildEbayListingTitle(product),
    descriptionHtml: buildEbayListingDescription(product),
    price: recommendedPrice,
    quantity:
      product.stockQuantity > 0
        ? product.stockQuantity
        : (product.pocamarketAvailableCount ?? 0) > 0
          ? 1
          : 0,
    imageUrls: buildEbayListingImageUrls(product, baseUrl),
    categoryId: buildEbayListingCategoryId(product),
    condition: product.ebayCondition,
    paymentProfile: product.ebayPaymentProfile,
    shippingProfile: product.ebayShippingProfile,
    returnProfile: product.ebayReturnProfile,
    merchantLocationKey: product.ebayMerchantLocationKey,
    marketplaceId: product.ebayMarketplaceId,
    currency: product.ebayCurrency,
    brand: product.brand,
    type: itemSpecifics.Type,
    countryOfOrigin: itemSpecifics["Country/Region of Manufacture"],
    customLabel: product.internalCode,
    itemSpecifics: buildEbayListingItemSpecificArrays(product),
  } satisfies ListingUploadDraft;
}

async function getProducts(ids: string[]) {
  const sellableIds = await getOperationalProductIds("sellable");
  const sellableIdSet = new Set(sellableIds);
  return prisma.product.findMany({
    where: {
      id: { in: ids.filter((id) => sellableIdSet.has(id)) },
      OR: [
        { ebayItemId: null },
        { listingStatus: { in: ["ENDED", "INACTIVE", "FAILED"] } },
      ],
    },
  });
}

async function getAllUnlistedProducts() {
  const sellableIds = await getOperationalProductIds("sellable");
  return prisma.product.findMany({
    where: {
      id: { in: sellableIds },
      OR: [
        { ebayItemId: null },
        { listingStatus: { in: ["ENDED", "INACTIVE", "FAILED"] } },
      ],
    },
    orderBy: { sku: "asc" },
    take: 5000,
  });
}

async function getLensWorkbenchProducts() {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "products"
    WHERE (
        "stock_quantity" > 0
        OR COALESCE("pocamarket_available_count", 0) > 0
      )
      AND (
        COALESCE("ebay_item_id", '') = ''
        OR UPPER(COALESCE("listing_status", '')) IN ('ENDED','INACTIVE','FAILED')
      )
      AND (
        "image_source" = 'lens_workbench'
        OR COALESCE("ebay_image_urls"::text, '') LIKE '%/products/%/lens-card-%'
      )
      AND EXISTS (
        SELECT 1 FROM "image_work_assignments" assignment
        WHERE assignment."product_id" = "products"."id" AND assignment."status" = 'approved'
      )
    ORDER BY "sku" ASC
    LIMIT 5000
  `;
  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];

  const products = await prisma.product.findMany({ where: { id: { in: ids } } });
  const order = new Map(ids.map((id, index) => [id, index]));
  return products.sort(
    (left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
  );
}

// 직접촬영(촬영본 연결) + 내 재고 보유 + 미등록 상품만 내려받는다.
async function getOwnPhotoListableProducts() {
  const ids = await getOperationalProductIds("own_photo_listable");
  if (!ids.length) return [];
  const products = await prisma.product.findMany({ where: { id: { in: ids } } });
  return products.sort((left, right) => left.sku.localeCompare(right.sku));
}

// 신규등록 가능(일반) + Lens 승인·미등록을 한 파일로 합쳐 내려받는다.
async function getCombinedListableProducts() {
  const [general, lens] = await Promise.all([
    getAllUnlistedProducts(),
    getLensWorkbenchProducts(),
  ]);
  const byId = new Map<string, (typeof general)[number]>();
  for (const product of [...general, ...lens]) byId.set(product.id, product);
  return [...byId.values()];
}

async function policyLookup(userId: string) {
  const [policies, locations] = await Promise.all([
    prisma.ebayPolicyCache.findMany({ where: { userId } }),
    prisma.ebayInventoryLocationCache.findMany({ where: { userId } }),
  ]);

  return {
    payment: new Map(
      policies
        .filter((policy) => policy.policyType === "payment")
        .map((policy) => [policy.policyId, policy.name ?? policy.policyId]),
    ),
    fulfillment: new Map(
      policies
        .filter((policy) => policy.policyType === "fulfillment")
        .map((policy) => [policy.policyId, policy.name ?? policy.policyId]),
    ),
    return: new Map(
      policies
        .filter((policy) => policy.policyType === "return")
        .map((policy) => [policy.policyId, policy.name ?? policy.policyId]),
    ),
    locations: new Map(
      locations.map((location) => [
        location.merchantLocationKey,
        location.name ?? location.merchantLocationKey,
      ]),
    ),
  };
}

type TemplatePolicies = { shipping: string; return: string; payment: string };

function policyName(
  lookup: Map<string, string>,
  value: string | null | undefined,
) {
  const key = text(value);
  return key ? lookup.get(key) ?? key : "";
}

// Account default business policies. Production excludes the xlsx template
// (.vercelignore has *.xlsx), so the workbook is unavailable there — without
// these defaults the policy columns ship empty and eBay rejects the listing
// ("no valid shipping service", err 216118).
const DEFAULT_BUSINESS_POLICIES: TemplatePolicies = {
  shipping: "Kpop PC New",
  return: "No Return Accepted (411199464022)",
  // Left blank on purpose: eBay (managed payments) applies the account's default
  // payment policy automatically. A wrong/stale name here is rejected as an
  // "invalid payment business policy identifier".
  payment: "",
};

function extractTemplatePolicies(workbook: XLSX.WorkBook | null): TemplatePolicies {
  const sheet = workbook?.Sheets.BusinessPolicy;
  if (!sheet) return { ...DEFAULT_BUSINESS_POLICIES };

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  return {
    shipping: String(rows[1]?.[0] ?? "").trim() || DEFAULT_BUSINESS_POLICIES.shipping,
    return: String(rows[1]?.[1] ?? "").trim() || DEFAULT_BUSINESS_POLICIES.return,
    payment: String(rows[1]?.[2] ?? "").trim() || DEFAULT_BUSINESS_POLICIES.payment,
  };
}

function listingRow(input: {
  draft: ListingUploadDraft;
  policies: PolicyLookup;
  templatePolicies: TemplatePolicies;
}) {
  const draft = input.draft;
  const itemSpecifics = itemSpecificsMap(draft.itemSpecifics);

  // Explicit account policies (DEFAULT_BUSINESS_POLICIES / template) take
  // precedence — otherwise a stray product/template policy id silently overrides
  // them and eBay falls back to the wrong default (e.g. returns-accepted).
  const shippingProfile =
    input.templatePolicies.shipping ||
    policyName(input.policies.fulfillment, text(draft.shippingProfile));
  const returnProfile =
    input.templatePolicies.return ||
    policyName(input.policies.return, text(draft.returnProfile));
  // Payment profile intentionally left to the explicit default (blank) — no
  // policy-id fallback, so eBay applies the account's default payment policy.
  const paymentProfile = input.templatePolicies.payment;

  return {
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)": "Add",
    "Custom label (SKU)": text(draft.sku),
    "Category ID": text(draft.categoryId),
    "Category name": buildEbayListingCategoryName({
      ebayCategoryId: text(draft.categoryId),
    }),
    Title: text(draft.title).slice(0, 80),
    "Start price": text(draft.price),
    Quantity: text(draft.quantity),
    "Item photo URL": imageText(draft.imageUrls),
    "Condition ID": buildEbayListingConditionId({ ebayCondition: draft.condition }),
    ConditionDescription: text(draft.conditionDescription),
    Description: text(draft.descriptionHtml),
    Format: listingFormat(draft.listingFormat),
    Duration: text(draft.listingDuration) || "GTC",
    // Best Offer on by default so buyers can send offers (you review/decide each)
    "Best Offer Enabled": "1",
    "Best Offer Auto Accept Price": text(draft.autoAcceptPrice),
    "Minimum Best Offer Price": text(draft.minimumOfferPrice),
    "Immediate pay required": boolText(draft.immediatePayRequired),
    // eBay requires a non-empty Item.Location. The seller ships from Korea, so
    // declare KR as the country too — otherwise eBay infers US (from the Action
    // header's Country=US) and rejects with a location/shipping mismatch.
    Location: text(draft.merchantLocationKey) || "South Korea",
    Country: "KR",
    "Shipping profile name": shippingProfile,
    "Return profile name": returnProfile,
    "Payment profile name": paymentProfile,
    "C:Original/Reproduction": "Original",
    "C:Brand": text(draft.brand) || firstItemSpecific(itemSpecifics, "Brand"),
    "C:Type": text(draft.type) || firstItemSpecific(itemSpecifics, "Type") || "Photocard",
    "C:Artist": firstItemSpecific(itemSpecifics, "Artist"),
    "C:Featured Person/Artist": firstItemSpecific(itemSpecifics, "Featured Person/Artist"),
    "C:Franchise": firstItemSpecific(itemSpecifics, "Franchise"),
    "C:Set": firstItemSpecific(itemSpecifics, "Set"),
    "C:Genre": firstItemSpecific(itemSpecifics, "Genre"),
    "C:Country/Region of Manufacture":
      text(draft.countryOfOrigin) ||
      firstItemSpecific(itemSpecifics, "Country/Region of Manufacture"),
  };
}

function itemSpecificsMap(value: ListingUploadDraft["itemSpecifics"]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map<string, string[]>();
  }

  return new Map(
    Object.entries(value).map(([key, values]) => [
      key,
      Array.isArray(values) ? values.map(text).filter(Boolean) : [],
    ]),
  );
}

function firstItemSpecific(values: Map<string, string[]>, key: string) {
  return values.get(key)?.[0] ?? "";
}

function emptyDraft(): ListingUploadDraft {
  return {
    sku: "",
    title: "",
    descriptionHtml: "",
    price: null,
    quantity: 0,
    imageUrls: [],
    categoryId: null,
    condition: null,
    paymentProfile: null,
    shippingProfile: null,
    returnProfile: null,
    merchantLocationKey: null,
    marketplaceId: null,
    currency: null,
    brand: null,
    customLabel: null,
  };
}

function csvResponse(
  rows: string[][],
  filename: string,
  counts: { exported: number; excluded: number; reportImportedAt: Date },
) {
  // eBay's bulk upload parses a delimited text file ("use comma/semicolon/tab").
  // An xlsx re-encoded outside the original template gets rejected, so emit CSV.
  const escape = (value: string) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((row) => row.map(escape).join(",")).join("\r\n");
  // UTF-8 BOM so eBay reads Korean business-policy names correctly
  const csv = `﻿${body}`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-exported-count": String(counts.exported),
      "x-excluded-count": String(counts.excluded),
      "x-ebay-report-imported-at": counts.reportImportedAt.toISOString(),
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const latestCompleteReport = await prisma.ebayReportImport.findFirst({
      where: { userId: user.id, completeSnapshot: true },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!latestCompleteReport) {
      return jsonError(
        "중복등록 방지를 위해 eBay 전체 활성상품 보고서를 먼저 가져와 주세요.",
        409,
      );
    }
    if (input.lensOnly || input.combined) await ensureImageWorkAssignments();
    const requestedIds = input.productIds ?? [];

    if (
      !input.allUnlisted &&
      !input.lensOnly &&
      !input.combined &&
      !input.ownPhotoOnly &&
      requestedIds.length === 0
    ) {
      return jsonError("내려받을 상품을 선택하거나 미등록 전체 받기를 사용해 주세요.", 422);
    }

    const [products, templateResult, policies, pricingSettings] = await Promise.all([
      input.ownPhotoOnly
        ? getOwnPhotoListableProducts()
        : input.combined
          ? getCombinedListableProducts()
          : input.lensOnly
            ? getLensWorkbenchProducts()
            : input.allUnlisted
              ? getAllUnlistedProducts()
              : getProducts(requestedIds),
      resolveListingTemplateDefaults(user.id, input.templateId),
      policyLookup(user.id),
      prisma.pricingSettings.findUnique({ where: { id: "default" } }),
    ]);
    if (!pricingSettings) {
      return jsonError("가격 설정을 먼저 저장해 주세요.", 422);
    }
    const imageExtras = await productImageExtrasById(products.map((product) => product.id));
    // Preserve the requested order; for "all unlisted" keep the DB (SKU) order.
    const orderIds =
      input.allUnlisted || input.lensOnly || input.combined || input.ownPhotoOnly
        ? products.map((product) => product.id)
        : requestedIds;
    const productOrder = new Map(orderIds.map((id, index) => [id, index]));
    const baseUrl = publicBaseUrl(request);
    const sortedProducts = withProductImageExtras(products, imageExtras)
      .filter(
        (product) =>
          hasListingPrice(product) &&
          buildEbayListingImageUrls(product, baseUrl).length > 0,
      )
      .sort(
        (a, b) => (productOrder.get(a.id) ?? 0) - (productOrder.get(b.id) ?? 0),
      );
    if (!sortedProducts.length) {
      return jsonError(
        "이미지가 완료됐고 가격(포카마켓 또는 수동 eBay 판매가)이 있으며 eBay에 활성 등록되지 않은 상품이 없습니다.",
        422,
      );
    }

    const templateDefaults = templateResult.template
      ? listingTemplateToDefaults(templateResult.template)
      : templateResult.defaults;
    const workbook = readEbayTemplate();
    const templatePolicies = extractTemplatePolicies(workbook);
    const rows = sortedProducts.flatMap((product, index) => {
      // 포카마켓 가격이 있으면 마진 계산가, 없으면 수동 eBay 판매가를 사용한다.
      const priceUsd =
        resolveListingPriceUsd(product, pricingSettings)?.priceUsd.toFixed(2) ?? "";
      if (!priceUsd) return [];
      const primary = productDraft(product, baseUrl, priceUsd);
      const merged = mergeListingUploadDrafts(primary, templateDefaults, {
        rowIndex: index + 1,
      });
      if (!text(merged.price)) return [];
      const title =
        renderTitle(templateResult.template?.titleTemplate, merged) || text(merged.title);
      const descriptionHtml = renderDescription(
        templateResult.template?.descriptionTemplateHtml,
        merged,
        title,
      );
      // eBay's separate Condition Description field (the one shown in the
      // individual listing flow) — kept distinct from the item description.
      const conditionDescription = templateResult.template?.conditionDescription
        ? renderDescription(templateResult.template.conditionDescription, merged, title)
        : text(merged.conditionDescription);
      // The template's quantity is an explicit listing quantity, so it wins over
      // the product's stock count. Procurement listings are always capped at 1
      // because the external Pocamarket supply can disappear before the next sync.
      const quantity =
        product.stockQuantity <= 0 &&
        (product.pocamarketAvailableCount ?? 0) > 0
          ? 1
          : templateResult.template?.defaultQuantity ?? merged.quantity;

      return [listingRow({
        draft: { ...merged, title, descriptionHtml, conditionDescription, quantity },
        policies,
        templatePolicies,
      })];
    });

    if (!rows.length) {
      return jsonError(
        "포카마켓 가격과 최종 eBay 판매가가 모두 있는 상품만 판매 엑셀에 포함할 수 있습니다.",
        422,
      );
    }

    const headers = Object.keys(
      rows[0] ?? listingRow({
        draft: emptyDraft(),
        policies,
        templatePolicies,
      }),
    );
    const csvRows = [
      headers,
      ...rows.map((row) => headers.map((h) => String(row[h as keyof typeof row] ?? ""))),
    ];

    const date = new Date().toISOString().slice(0, 10);
    return csvResponse(
      csvRows,
      input.ownPhotoOnly
        ? `ebay-new-listings-own-photo-${date}.csv`
        : input.combined
          ? `ebay-new-listings-all-${date}.csv`
          : input.lensOnly
            ? `ebay-new-listings-lens-ready-${date}.csv`
            : `ebay-new-listings-ready-${date}.csv`,
      {
        exported: rows.length,
        excluded: Math.max(
          0,
          (input.ownPhotoOnly || input.combined || input.lensOnly || input.allUnlisted
            ? products.length
            : requestedIds.length) - rows.length,
        ),
        reportImportedAt: latestCompleteReport.createdAt,
      },
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    if (error instanceof z.ZodError) {
      return jsonError("Select at least one inventory item.", 422, error.flatten());
    }

    return jsonError(asErrorMessage(error), 500);
  }
}

function publicBaseUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
  const protocol =
    request.headers.get("x-forwarded-proto") ??
    (requestUrl.protocol ? requestUrl.protocol.replace(/:$/, "") : "https");

  return `${protocol}://${host}`;
}
