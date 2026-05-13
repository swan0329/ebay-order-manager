import path from "node:path";
import * as XLSX from "xlsx";
import { z } from "zod";
import { asErrorMessage, jsonError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
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
  productIds: z.array(z.string().min(1)).min(1).max(5000),
  templateId: z.string().optional().nullable(),
});

const ebayTemplatePath = path.join(
  process.cwd(),
  "public",
  "templates",
  "eBay-category-listing-template.xlsx",
);

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

function conditionId(value: unknown) {
  const normalized = text(value).toUpperCase();

  if (/^\d+$/.test(normalized)) {
    return normalized;
  }

  if (["NEW", "NEW_WITH_TAGS"].includes(normalized)) {
    return "1000";
  }

  if (["LIKE_NEW", "NEW_OTHER"].includes(normalized)) {
    return "1500";
  }

  if (["USED", "PREOWNED"].includes(normalized)) {
    return "3000";
  }

  return "1000";
}

function productDraft(product: ProductForExport) {
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
  } satisfies ListingUploadDraft;
}

function getProducts(ids: string[]) {
  return prisma.product.findMany({
    where: { id: { in: ids } },
  });
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

function policyName(
  lookup: Map<string, string>,
  value: string | null | undefined,
) {
  const key = text(value);
  return key ? lookup.get(key) ?? key : "";
}

function headerMap(sheet: XLSX.WorkSheet) {
  const headers = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    range: 3,
    defval: "",
    blankrows: false,
  })[0];

  return new Map(headers.map((header, index) => [header, index]));
}

function setCell(sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number, value: unknown) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });

  sheet[address] = {
    t: typeof value === "number" ? "n" : "s",
    v: value,
  };
}

function setByHeader(
  sheet: XLSX.WorkSheet,
  headers: Map<string, number>,
  rowIndex: number,
  header: string,
  value: unknown,
) {
  const columnIndex = headers.get(header);

  if (columnIndex === undefined || value === "") {
    return;
  }

  setCell(sheet, rowIndex, columnIndex, value);
}

function clearListingRows(sheet: XLSX.WorkSheet) {
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) {
      continue;
    }

    const cell = XLSX.utils.decode_cell(address);

    if (cell.r >= 4) {
      delete sheet[address];
    }
  }
}

function listingRow(input: {
  draft: ListingUploadDraft;
  policies: PolicyLookup;
}) {
  const draft = input.draft;

  return {
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)": "Add",
    "Custom label (SKU)": text(draft.sku),
    "Category ID": text(draft.categoryId) || "108857",
    Title: text(draft.title).slice(0, 80),
    "Start price": text(draft.price),
    Quantity: text(draft.quantity),
    "Item photo URL": imageText(draft.imageUrls),
    "Condition ID": conditionId(draft.condition),
    Description: text(draft.descriptionHtml),
    Format: text(draft.listingFormat) || "FixedPrice",
    Duration: text(draft.listingDuration) || "GTC",
    "Best Offer Enabled": boolText(draft.bestOfferEnabled),
    "Best Offer Auto Accept Price": text(draft.autoAcceptPrice),
    "Minimum Best Offer Price": text(draft.minimumOfferPrice),
    "Immediate pay required": boolText(draft.immediatePayRequired),
    Location: text(draft.merchantLocationKey),
    "Shipping profile name": policyName(input.policies.fulfillment, text(draft.shippingProfile)),
    "Return profile name": policyName(input.policies.return, text(draft.returnProfile)),
    "Payment profile name": policyName(input.policies.payment, text(draft.paymentProfile)),
    "C:Original/Reproduction": "Original",
  };
}

function fillListingsSheet(
  workbook: XLSX.WorkBook,
  rows: Array<Record<string, unknown>>,
) {
  const sheet = workbook.Sheets.Listings;

  if (!sheet) {
    throw new Error("eBay template is missing the Listings sheet.");
  }

  const headers = headerMap(sheet);
  clearListingRows(sheet);

  rows.forEach((row, index) => {
    const rowIndex = index + 4;

    for (const [header, value] of Object.entries(row)) {
      setByHeader(sheet, headers, rowIndex, header, value);
    }
  });
}

function fillBusinessPolicySheet(workbook: XLSX.WorkBook, policies: PolicyLookup) {
  const sheet = workbook.Sheets.BusinessPolicy;

  if (!sheet) {
    return;
  }

  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) {
      continue;
    }

    const cell = XLSX.utils.decode_cell(address);

    if (cell.r >= 1) {
      delete sheet[address];
    }
  }

  const maxRows = Math.max(
    policies.fulfillment.size,
    policies.return.size,
    policies.payment.size,
    1,
  );
  const fulfillment = Array.from(policies.fulfillment.values());
  const returns = Array.from(policies.return.values());
  const payments = Array.from(policies.payment.values());

  for (let index = 0; index < maxRows; index += 1) {
    setCell(sheet, index + 1, 0, fulfillment[index] ?? "");
    setCell(sheet, index + 1, 1, returns[index] ?? "");
    setCell(sheet, index + 1, 2, payments[index] ?? "");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    const [products, templateResult, policies] = await Promise.all([
      getProducts(input.productIds),
      resolveListingTemplateDefaults(user.id, input.templateId),
      policyLookup(user.id),
    ]);
    const productOrder = new Map(input.productIds.map((id, index) => [id, index]));
    const sortedProducts = products.sort(
      (a, b) => (productOrder.get(a.id) ?? 0) - (productOrder.get(b.id) ?? 0),
    );
    const templateDefaults = templateResult.template
      ? listingTemplateToDefaults(templateResult.template)
      : templateResult.defaults;
    const rows = sortedProducts.map((product, index) => {
      const primary = productDraft(product);
      const merged = mergeListingUploadDrafts(primary, templateDefaults, {
        rowIndex: index + 1,
      });
      const title = renderTitle(templateResult.template?.titleTemplate, merged);

      return listingRow({
        draft: { ...merged, title: title || merged.title },
        policies,
      });
    });
    const workbook = XLSX.readFile(ebayTemplatePath, { cellStyles: true });

    fillListingsSheet(workbook, rows);
    fillBusinessPolicySheet(workbook, policies);

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const body = new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    return new Response(body, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="ebay-category-listing-upload.xlsx"',
      },
    });
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
