import { Prisma, type ListingDraft, type Product } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import type { ListingUploadInput } from "@/lib/services/inventoryService";
import {
  coerceListingUploadInput,
  mergeListingUploadDrafts,
  parseListingUploadWorkbook,
  readListingUploadRowDraft,
  type ListingUploadDraft,
} from "@/lib/services/listingUploadInput";
import {
  listingTemplateToDefaults,
  resolveListingTemplateDefaults,
} from "@/lib/services/listingTemplateService";
import {
  buildListingPayloadPreview,
} from "@/lib/services/listingService";
import { validateListingUploadInput } from "@/lib/services/listingValidationService";
import { parseCsvObjects, toCsv } from "@/lib/csv";

type DraftUpdateInput = Partial<{
  sku: string;
  title: string;
  subtitle: string | null;
  descriptionHtml: string | null;
  price: string | number | null;
  quantity: string | number | null;
  imageUrls: string[] | string | null;
  categoryId: string | null;
  condition: string | null;
  conditionDescription: string | null;
  itemSpecifics: Record<string, string[]> | string | null;
  marketplaceId: string | null;
  currency: string | null;
  paymentPolicyId: string | null;
  fulfillmentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
  bestOfferEnabled: boolean;
  minimumOfferPrice: string | number | null;
  autoAcceptPrice: string | number | null;
  privateListing: boolean;
  immediatePayRequired: boolean;
  listingFormat: string | null;
  templateId: string | null;
  titlePrefix: string | null;
  titleSuffix: string | null;
  imageUrlPrefix: string | null;
}>;

function toJson(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function text(value: unknown) {
  const output = String(value ?? "").trim();
  return output ? output : null;
}

function decimal(value: unknown) {
  const output = text(value);
  return output ? output : null;
}

function intValue(value: unknown) {
  const output = text(value);

  if (!output) {
    return null;
  }

  const parsed = Number.parseInt(output, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  return String(value ?? "")
    .split(/[\n,;|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasDraftValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim() !== "";
  }

  return true;
}

function jsonObject(value: unknown) {
  if (!value) {
    return {};
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function buildFieldSource(
  primary: ListingUploadDraft,
  templateDefaults: ListingUploadDraft | null,
  primarySource: "inventory" | "excel",
) {
  const pairs: Array<[string, keyof ListingUploadDraft]> = [
    ["sku", "sku"],
    ["title", "title"],
    ["descriptionHtml", "descriptionHtml"],
    ["price", "price"],
    ["quantity", "quantity"],
    ["imageUrls", "imageUrls"],
    ["categoryId", "categoryId"],
    ["condition", "condition"],
    ["conditionDescription", "conditionDescription"],
    ["itemSpecifics", "itemSpecifics"],
    ["marketplaceId", "marketplaceId"],
    ["currency", "currency"],
    ["paymentPolicyId", "paymentProfile"],
    ["fulfillmentPolicyId", "shippingProfile"],
    ["returnPolicyId", "returnProfile"],
    ["merchantLocationKey", "merchantLocationKey"],
    ["bestOfferEnabled", "bestOfferEnabled"],
    ["minimumOfferPrice", "minimumOfferPrice"],
    ["autoAcceptPrice", "autoAcceptPrice"],
    ["privateListing", "privateListing"],
    ["immediatePayRequired", "immediatePayRequired"],
    ["listingFormat", "listingFormat"],
  ];

  return Object.fromEntries(
    pairs.map(([field, draftKey]) => [
      field,
      hasDraftValue(primary[draftKey])
        ? primarySource
        : hasDraftValue(templateDefaults?.[draftKey])
          ? "template"
          : "default",
    ]),
  );
}

function markManualSources(
  current: ListingDraft,
  input: DraftUpdateInput,
) {
  const source = jsonObject(current.fieldSourceJson);
  const fields = [
    "sku",
    "title",
    "subtitle",
    "descriptionHtml",
    "price",
    "quantity",
    "imageUrls",
    "categoryId",
    "condition",
    "conditionDescription",
    "itemSpecifics",
    "marketplaceId",
    "currency",
    "paymentPolicyId",
    "fulfillmentPolicyId",
    "returnPolicyId",
    "merchantLocationKey",
    "bestOfferEnabled",
    "minimumOfferPrice",
    "autoAcceptPrice",
    "privateListing",
    "immediatePayRequired",
    "listingFormat",
    "templateId",
  ] as const;

  for (const field of fields) {
    if (input[field] !== undefined) {
      source[field] = "manual";
    }
  }

  if (input.titlePrefix !== undefined || input.titleSuffix !== undefined) {
    source.title = "manual";
  }

  if (input.imageUrlPrefix !== undefined) {
    source.imageUrls = "manual";
  }

  return source;
}

function applyImagePrefix(urls: string[], prefix?: string | null) {
  const normalizedPrefix = text(prefix)?.replace(/\/+$/, "");

  if (!normalizedPrefix) {
    return urls;
  }

  return urls.map((url) => {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    return `${normalizedPrefix}/${url.replace(/^\/+/, "")}`;
  });
}

function renderTitle(template: string | null | undefined, draft: ListingUploadDraft) {
  if (!template) {
    return null;
  }

  const replacements: Record<string, string> = {
    title: String(draft.title ?? ""),
    sku: String(draft.sku ?? ""),
    price: String(draft.price ?? ""),
    quantity: String(draft.quantity ?? ""),
    brand: String(draft.brand ?? ""),
    condition: String(draft.condition ?? ""),
  };

  return template.replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (_, key: string) => replacements[key] ?? "");
}

function productDraft(product: Product): ListingUploadDraft {
  return {
    sku: product.sku,
    title: product.ebayTitle ?? product.productName,
    descriptionHtml:
      product.descriptionHtml ?? product.memo ?? `<p>${product.productName}</p>`,
    price: product.ebayPrice?.toString() ?? product.salePrice?.toString() ?? null,
    quantity: product.stockQuantity,
    imageUrls: product.ebayImageUrls.length
      ? product.ebayImageUrls
      : product.imageUrl
        ? [product.imageUrl]
        : [],
    categoryId: product.ebayCategoryId,
    condition: product.ebayCondition,
    paymentProfile: product.ebayPaymentProfile,
    shippingProfile: product.ebayShippingProfile,
    returnProfile: product.ebayReturnProfile,
    merchantLocationKey: product.ebayMerchantLocationKey,
    marketplaceId: product.ebayMarketplaceId,
    currency: product.ebayCurrency,
    brand: product.brand,
    customLabel: product.internalCode,
  };
}

function draftCreateData(input: {
  userId: string;
  sourceInventoryId?: string | null;
  templateId?: string | null;
  draft: ListingUploadDraft;
  fieldSource?: Record<string, unknown>;
}) {
  return {
    userId: input.userId,
    sourceInventoryId: input.sourceInventoryId ?? null,
    templateId: input.templateId ?? null,
    sku: text(input.draft.sku) ?? "",
    title: text(input.draft.title) ?? text(input.draft.sku) ?? "Untitled listing",
    descriptionHtml: text(input.draft.descriptionHtml),
    price: decimal(input.draft.price),
    quantity: intValue(input.draft.quantity),
    imageUrlsJson: toJson(stringArray(input.draft.imageUrls)),
    categoryId: text(input.draft.categoryId),
    condition: text(input.draft.condition),
    conditionDescription: text(input.draft.conditionDescription),
    itemSpecificsJson: toJson(jsonObject(input.draft.itemSpecifics)),
    marketplaceId: text(input.draft.marketplaceId),
    currency: text(input.draft.currency),
    paymentPolicyId: text(input.draft.paymentProfile),
    fulfillmentPolicyId: text(input.draft.shippingProfile),
    returnPolicyId: text(input.draft.returnProfile),
    merchantLocationKey: text(input.draft.merchantLocationKey),
    bestOfferEnabled: Boolean(input.draft.bestOfferEnabled),
    minimumOfferPrice: decimal(input.draft.minimumOfferPrice),
    autoAcceptPrice: decimal(input.draft.autoAcceptPrice),
    privateListing: Boolean(input.draft.privateListing),
    immediatePayRequired: Boolean(input.draft.immediatePayRequired),
    listingFormat: text(input.draft.listingFormat) ?? "FIXED_PRICE",
    fieldSourceJson: toJson(input.fieldSource ?? {}),
    status: "draft",
  };
}

function draftToPrimary(draft: ListingDraft): ListingUploadDraft {
  return {
    sku: draft.sku,
    title: draft.title,
    descriptionHtml: draft.descriptionHtml,
    price: draft.price?.toString() ?? null,
    quantity: draft.quantity,
    imageUrls: stringArray(draft.imageUrlsJson),
    categoryId: draft.categoryId,
    condition: draft.condition,
    conditionDescription: draft.conditionDescription,
    itemSpecifics: jsonObject(draft.itemSpecificsJson) as Record<string, string[]>,
    marketplaceId: draft.marketplaceId,
    currency: draft.currency,
    paymentProfile: draft.paymentPolicyId,
    shippingProfile: draft.fulfillmentPolicyId,
    returnProfile: draft.returnPolicyId,
    merchantLocationKey: draft.merchantLocationKey,
    bestOfferEnabled: draft.bestOfferEnabled,
    minimumOfferPrice: draft.minimumOfferPrice?.toString() ?? null,
    autoAcceptPrice: draft.autoAcceptPrice?.toString() ?? null,
    privateListing: draft.privateListing,
    immediatePayRequired: draft.immediatePayRequired,
    listingFormat: draft.listingFormat,
  };
}

export async function createDraftsFromInventory(input: {
  userId: string;
  productIds: string[];
  templateId?: string | null;
}) {
  const products = await prisma.product.findMany({
    where: { id: { in: input.productIds } },
    orderBy: { updatedAt: "desc" },
  });
  const template = input.templateId
    ? await prisma.listingTemplate.findFirst({
        where: { id: input.templateId, userId: input.userId },
      })
    : await prisma.listingTemplate.findFirst({
        where: { userId: input.userId, isDefault: true },
      });
  const templateDefaults = template ? listingTemplateToDefaults(template) : null;
  const drafts = [];

  for (const product of products) {
    const primary = productDraft(product);
    const merged = mergeListingUploadDrafts(primary, templateDefaults);
    const title = renderTitle(template?.titleTemplate, merged);
    drafts.push(
      await prisma.listingDraft.create({
        data: draftCreateData({
          userId: input.userId,
          sourceInventoryId: product.id,
          templateId: template?.id ?? null,
          draft: { ...merged, title: title || merged.title },
          fieldSource: buildFieldSource(primary, templateDefaults, "inventory"),
        }),
      }),
    );
  }

  return drafts;
}

export async function createDraftsFromRows(input: {
  userId: string;
  rows: Record<string, unknown>[];
  templateId?: string | null;
}) {
  const { template, defaults } = await resolveListingTemplateDefaults(
    input.userId,
    input.templateId,
  );
  const rowDrafts = input.rows.map((row, index) => ({
    row,
    index,
    primary: readListingUploadRowDraft(row),
  }));
  const sourceIds = rowDrafts
    .map((entry) => text(entry.row.source_inventory_id))
    .filter((value): value is string => Boolean(value));
  const skus = rowDrafts
    .map((entry) => text(entry.primary.sku))
    .filter((value): value is string => Boolean(value));
  const inventoryWhere: Prisma.ProductWhereInput[] = [];

  if (sourceIds.length) {
    inventoryWhere.push({ id: { in: sourceIds } });
  }

  if (skus.length) {
    inventoryWhere.push({ sku: { in: skus } });
  }

  const inventoryMatches = inventoryWhere.length
    ? await prisma.product.findMany({
        where: { OR: inventoryWhere },
        select: { id: true, sku: true },
      })
    : [];
  const inventoryById = new Map(inventoryMatches.map((product) => [product.id, product]));
  const inventoryBySku = new Map(inventoryMatches.map((product) => [product.sku, product]));
  const drafts = [];

  for (const { row, index, primary } of rowDrafts) {
    const merged = mergeListingUploadDrafts(primary, defaults, { rowIndex: index + 1 });
    const title = renderTitle(template?.titleTemplate, merged);
    const sourceId = text(row.source_inventory_id);
    const sku = text(primary.sku);
    const sourceInventory =
      (sourceId ? inventoryById.get(sourceId) : null) ??
      (sku ? inventoryBySku.get(sku) : null) ??
      null;
    drafts.push(
      await prisma.listingDraft.create({
        data: draftCreateData({
          userId: input.userId,
          sourceInventoryId: sourceInventory?.id ?? null,
          templateId: template?.id ?? null,
          draft: { ...merged, title: title || merged.title },
          fieldSource: buildFieldSource(primary, defaults, "excel"),
        }),
      }),
    );
  }

  return drafts;
}

export function parseListingDraftRows(fileName: string, content: Buffer | string) {
  if (fileName.toLowerCase().endsWith(".csv")) {
    return parseCsvObjects(String(content));
  }

  return parseListingUploadWorkbook(
    Buffer.isBuffer(content) ? content : Buffer.from(content),
  );
}

export async function listDrafts(userId: string, status?: string | null) {
  return prisma.listingDraft.findMany({
    where: {
      userId,
      ...(status && status !== "all" ? { status } : {}),
    },
    include: {
      sourceInventory: {
        select: {
          id: true,
          sku: true,
          productName: true,
          stockQuantity: true,
          imageUrl: true,
          ebayItemId: true,
          ebayOfferId: true,
          listingStatus: true,
        },
      },
      template: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}

export async function updateDraft(
  userId: string,
  draftId: string,
  input: DraftUpdateInput,
) {
  const current = await prisma.listingDraft.findFirst({
    where: { id: draftId, userId },
  });

  if (!current) {
    throw new Error("업로드 draft를 찾을 수 없습니다.");
  }

  const title =
    `${text(input.titlePrefix) ?? ""}${text(input.title) ?? current.title}${
      text(input.titleSuffix) ?? ""
    }`.trim() || current.title;
  const imageUrls =
    input.imageUrls === undefined && input.imageUrlPrefix === undefined
      ? undefined
      : applyImagePrefix(
          input.imageUrls === undefined
            ? stringArray(current.imageUrlsJson)
            : stringArray(input.imageUrls),
          input.imageUrlPrefix,
        );

  return prisma.listingDraft.update({
    where: { id: draftId },
    data: {
      sku: text(input.sku) ?? current.sku,
      title,
      subtitle: input.subtitle === undefined ? undefined : text(input.subtitle),
      descriptionHtml:
        input.descriptionHtml === undefined ? undefined : text(input.descriptionHtml),
      price: input.price === undefined ? undefined : decimal(input.price),
      quantity: input.quantity === undefined ? undefined : intValue(input.quantity),
      imageUrlsJson:
        imageUrls === undefined ? undefined : toJson(imageUrls),
      categoryId: input.categoryId === undefined ? undefined : text(input.categoryId),
      condition: input.condition === undefined ? undefined : text(input.condition),
      conditionDescription:
        input.conditionDescription === undefined
          ? undefined
          : text(input.conditionDescription),
      itemSpecificsJson:
        input.itemSpecifics === undefined ? undefined : toJson(jsonObject(input.itemSpecifics)),
      marketplaceId:
        input.marketplaceId === undefined ? undefined : text(input.marketplaceId),
      currency: input.currency === undefined ? undefined : text(input.currency),
      paymentPolicyId:
        input.paymentPolicyId === undefined ? undefined : text(input.paymentPolicyId),
      fulfillmentPolicyId:
        input.fulfillmentPolicyId === undefined
          ? undefined
          : text(input.fulfillmentPolicyId),
      returnPolicyId:
        input.returnPolicyId === undefined ? undefined : text(input.returnPolicyId),
      merchantLocationKey:
        input.merchantLocationKey === undefined
          ? undefined
          : text(input.merchantLocationKey),
      bestOfferEnabled: input.bestOfferEnabled,
      minimumOfferPrice:
        input.minimumOfferPrice === undefined ? undefined : decimal(input.minimumOfferPrice),
      autoAcceptPrice:
        input.autoAcceptPrice === undefined ? undefined : decimal(input.autoAcceptPrice),
      privateListing: input.privateListing,
      immediatePayRequired: input.immediatePayRequired,
      listingFormat:
        input.listingFormat === undefined ? undefined : text(input.listingFormat),
      templateId: input.templateId === undefined ? undefined : text(input.templateId),
      fieldSourceJson: toJson(markManualSources(current, input)),
      status: "draft",
    },
  });
}

export async function bulkUpdateDrafts(userId: string, input: DraftUpdateInput & { ids: string[] }) {
  const ids = [...new Set(input.ids)].filter(Boolean);
  const results = [];

  for (const id of ids) {
    results.push(await updateDraft(userId, id, input));
  }

  return results;
}

export async function draftToListingInput(
  userId: string,
  draft: ListingDraft,
): Promise<ListingUploadInput> {
  const { defaults } = await resolveListingTemplateDefaults(userId, draft.templateId);
  return coerceListingUploadInput(draftToPrimary(draft), defaults);
}

export async function validateDrafts(userId: string, ids: string[]) {
  const drafts = await prisma.listingDraft.findMany({
    where: { userId, id: { in: ids } },
  });
  const skuCounts = new Map<string, number>();

  for (const draft of drafts) {
    const sku = draft.sku.trim();
    skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  }

  const [policyCaches, locationCaches] = await Promise.all([
    prisma.ebayPolicyCache.findMany({ where: { userId } }),
    prisma.ebayInventoryLocationCache.findMany({ where: { userId } }),
  ]);
  const paymentPolicies = new Set(
    policyCaches
      .filter((policy) => policy.policyType === "payment")
      .map((policy) => policy.policyId),
  );
  const fulfillmentPolicies = new Set(
    policyCaches
      .filter((policy) => policy.policyType === "fulfillment")
      .map((policy) => policy.policyId),
  );
  const returnPolicies = new Set(
    policyCaches
      .filter((policy) => policy.policyType === "return")
      .map((policy) => policy.policyId),
  );
  const locations = new Set(
    locationCaches.map((location) => location.merchantLocationKey),
  );
  const results = [];

  for (const draft of drafts) {
    try {
      const input = await draftToListingInput(userId, draft);
      const validation = await validateListingUploadInput(input, {
        userId,
        checkImageUrls: true,
        checkOAuthScope: true,
      });
      const issues = [...validation.issues];

      if ((skuCounts.get(input.sku) ?? 0) > 1) {
        issues.push({
          field: "sku",
          message: "선택한 업로드 draft 안에서 SKU가 중복되었습니다.",
        });
      }

      if (paymentPolicies.size && !paymentPolicies.has(input.paymentProfile ?? "")) {
        issues.push({
          field: "payment_policy_id",
          message: "동기화된 eBay 결제정책에서 해당 policy id를 찾을 수 없습니다.",
        });
      }

      if (
        fulfillmentPolicies.size &&
        !fulfillmentPolicies.has(input.shippingProfile ?? "")
      ) {
        issues.push({
          field: "fulfillment_policy_id",
          message: "동기화된 eBay 배송정책에서 해당 policy id를 찾을 수 없습니다.",
        });
      }

      if (returnPolicies.size && !returnPolicies.has(input.returnProfile ?? "")) {
        issues.push({
          field: "return_policy_id",
          message: "동기화된 eBay 반품정책에서 해당 policy id를 찾을 수 없습니다.",
        });
      }

      if (locations.size && !locations.has(input.merchantLocationKey ?? "")) {
        issues.push({
          field: "merchant_location_key",
          message: "동기화된 eBay 재고 위치에서 해당 merchantLocationKey를 찾을 수 없습니다.",
        });
      }

      const fullValidation = {
        ...validation,
        valid: issues.length === 0,
        issues,
        checks: {
          imageUrlsChecked: true,
          oauthScopeChecked: true,
          skuDuplicate: (skuCounts.get(input.sku) ?? 0) > 1,
          policyCacheChecked: policyCaches.length > 0,
          locationCacheChecked: locationCaches.length > 0,
          existingOfferKnown: Boolean(draft.offerId || draft.ebayItemId),
        },
      };
      let preview: unknown = null;

      if (fullValidation.valid) {
        preview = buildListingPayloadPreview(input);
      }

      const status = fullValidation.valid ? "validated" : "draft";
      await prisma.listingDraft.update({
        where: { id: draft.id },
        data: {
          status,
          validationJson: toJson({ ...fullValidation, preview }),
          errorSummary: fullValidation.valid
            ? null
            : fullValidation.issues.map((issue) => issue.message).join(" / "),
        },
      });
      results.push({ draftId: draft.id, validation: fullValidation, preview });
    } catch (error) {
      const message = error instanceof Error ? error.message : "검증 실패";
      await prisma.listingDraft.update({
        where: { id: draft.id },
        data: {
          status: "draft",
          errorSummary: message,
          validationJson: toJson({ valid: false, issues: [{ field: "draft", message }] }),
        },
      });
      results.push({
        draftId: draft.id,
        validation: { valid: false, issues: [{ field: "draft", message }] },
      });
    }
  }

  return results;
}

export async function listingDraftResultsCsv(userId: string, status?: string | null) {
  const drafts = await prisma.listingDraft.findMany({
    where: {
      userId,
      ...(status && status !== "all" ? { status } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  const rows = drafts.map((draft) => [
    draft.sku,
    draft.title,
    draft.status,
    draft.ebayItemId,
    draft.offerId,
    draft.listingStatus,
    draft.errorSummary,
    draft.lastUploadedAt?.toISOString(),
  ]);

  return toCsv([
    [
      "sku",
      "title",
      "status",
      "ebay_item_id",
      "offer_id",
      "listing_status",
      "error_summary",
      "last_uploaded_at",
    ],
    ...rows,
  ]);
}
