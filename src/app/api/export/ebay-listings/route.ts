import { jsonError } from "@/lib/http";
import {
  buildEbayListingCategoryId,
  buildEbayListingConditionId,
  buildEbayListingDescription,
  buildEbayListingImageUrls,
  buildEbayListingItemSpecifics,
  buildEbayListingPrice,
  buildEbayListingTitle,
} from "@/lib/ebay-listing-fields";
import { resolveListingPriceUsd } from "@/lib/listing-price";
import {
  productImageExtrasById,
  withProductImageExtras,
} from "@/lib/product-export-image-extras";
import { productWhere } from "@/lib/products";
import { getOperationalProductIds } from "@/lib/product-operations";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import * as XLSX from "xlsx";
import {
  getEbayFileTemplate,
  getProductValue,
} from "@/lib/services/ebayFileTemplateService";

// Fallback header when no template is uploaded (old File Exchange format)
const DEFAULT_HEADER = [
  "*Action",
  "SiteID",
  "*Category",
  "CustomLabel",
  "*Title",
  "*Description",
  "PicURL",
  "GalleryType",
  "*BuyItNowPrice",
  "*Quantity",
  "*Format",
  "*Duration",
  "*Currency",
  "ConditionID",
  "DispatchTimeMax",
  "ShippingService-1:Option",
  "ShippingService-1:Cost",
  "ShippingService-1:FreeShipping",
  "ReturnsAcceptedOption",
  "ReturnsWithinOption",
  "RefundOption",
  "ShippingCostPaidByOption",
  "C:Brand",
  "C:Type",
  "C:Artist",
  "C:Featured Person/Artist",
  "C:Franchise",
  "C:Set",
  "C:Genre",
  "C:Country/Region of Manufacture",
  "C:Original/Reproduction",
];

const REQUIRED_EXPORT_COLUMNS = [
  "Category ID",
  "Category name",
  "Condition ID",
  "C:Brand",
  "C:Type",
  "C:Artist",
  "C:Featured Person/Artist",
  "C:Franchise",
  "C:Set",
  "C:Genre",
  "C:Country/Region of Manufacture",
  "C:Original/Reproduction",
];

function exportColumnKey(column: string) {
  const col = column.toLowerCase();

  if (col === "*category" || col === "category" || col === "category id") {
    return "category";
  }

  if (
    col === "conditionid" ||
    col === "*conditionid" ||
    col === "condition id" ||
    col === "*condition id"
  ) {
    return "condition";
  }

  return col;
}

function withRequiredExportColumns(columns: string[]) {
  const existing = new Set(columns.map(exportColumnKey));
  const output = [...columns];

  for (const column of REQUIRED_EXPORT_COLUMNS) {
    const key = exportColumnKey(column);

    if (!existing.has(key)) {
      output.push(column);
      existing.add(key);
    }
  }

  return output;
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

function workbookResponse(rows: string[][], filename: string) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "eBay Listings");
  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();

    const url = new URL(request.url);
    const p = (key: string, fallback: string) =>
      url.searchParams.get(key)?.trim() || fallback;

    const savedTemplate = await getEbayFileTemplate(user.id);
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

    const sellableIds = await getOperationalProductIds("sellable");
    const baseWhere = productWhere({
      q: url.searchParams.get("q"),
      stock: url.searchParams.get("stock"),
      group: url.searchParams.get("group"),
      member: url.searchParams.get("member"),
      album: url.searchParams.get("album"),
      version: url.searchParams.get("version"),
    });
    const existingAnd = Array.isArray(baseWhere.AND)
      ? baseWhere.AND
      : baseWhere.AND
        ? [baseWhere.AND]
        : [];
    baseWhere.AND = [
      ...existingAnd,
      { id: { in: sellableIds } },
      {
        OR: [
          { ebayItemId: null },
          { listingStatus: { in: ["ENDED", "INACTIVE", "FAILED"] } },
        ],
      },
    ];

    const [products, pricingSettings] = await Promise.all([
      prisma.product.findMany({
        where: baseWhere,
        orderBy: { sku: "asc" },
      }),
      prisma.pricingSettings.findUnique({ where: { id: "default" } }),
    ]);
    if (!pricingSettings) {
      return jsonError("가격 설정을 먼저 저장해 주세요.", 422);
    }
    const imageExtras = await productImageExtrasById(products.map((product) => product.id));
    const exportProducts = withProductImageExtras(products, imageExtras);
    const baseUrl = publicBaseUrl(request);

    // 가격은 신규등록 엑셀과 같은 규칙을 쓴다: 포카마켓 가격이 있으면 마진 계산가가
    // 우선이고, 포카마켓에 없는 상품만 수동 입력한 eBay 판매가(USD)를 쓴다.
    const exportable = exportProducts
      .flatMap((product) => {
        const hasImage = buildEbayListingImageUrls(product, baseUrl).length > 0;
        const price = resolveListingPriceUsd(product, pricingSettings);
        if (!hasImage || !price) return [];

        return [
          {
            ...product,
            stockQuantity:
              product.stockQuantity > 0
                ? product.stockQuantity
                : (product.pocamarketAvailableCount ?? 0) > 0
                  ? 1
                  : 0,
            ebayPrice: price.priceUsd,
          },
        ];
      });

    const date = new Date().toISOString().slice(0, 10);
    let workbookRows: string[][];

    if (savedTemplate) {
      const { columns, defaults, isSellerHubFormat } = savedTemplate;
      const exportColumns = withRequiredExportColumns(columns);

      const rows = exportable.map((product) =>
        exportColumns.map((col) =>
          getProductValue(col, product, defaults[col] ?? "", baseUrl),
        ),
      );

      if (isSellerHubFormat) {
        // Prepend the #INFO metadata rows required by Seller Hub Reports format
        const ts = Date.now();
        workbookRows = [
          ["#INFO", `Created=${ts}`],
          ["#INFO", "Version=1.0", "", "Template=fx_category_template_EBAY_US"],
          ["#INFO"],
          exportColumns,
          ...rows,
        ];
      } else {
        workbookRows = [exportColumns, ...rows];
      }
    } else {
      // Fallback: classic File Exchange format using query-param defaults
      const defaultSiteId = p("site_id", "0");
      const defaultConditionId = p("condition_id", "1000");
      const defaultCurrency = p("currency", "USD");
      const defaultHandlingTime = p("handling_time", "3");
      const defaultShippingService = p("shipping_service", "USPSFirstClass");
      const defaultShippingCost = p("shipping_cost", "0");
      const defaultFreeShipping = p("free_shipping", "Y");
      const defaultReturnsAccepted = p("returns_accepted", "ReturnsAccepted");
      const defaultReturnsWithin = p("returns_within", "Days_30");
      const defaultRefundOption = p("refund_option", "MoneyBackOrExchange");
      const defaultShippingCostPaidBy = p("shipping_cost_paid_by", "Buyer");
      const defaultCategoryId = p("category_id", "");

      const rows = exportable.map((product) => {
        const itemSpecifics = buildEbayListingItemSpecifics(product);
        const price = buildEbayListingPrice(product);
        const picUrl = buildEbayListingImageUrls(product, baseUrl).join("|");

        return [
          "Add",
          defaultSiteId,
          buildEbayListingCategoryId(product, defaultCategoryId || undefined),
          product.sku,
          buildEbayListingTitle(product),
          buildEbayListingDescription(product),
          picUrl,
          "Gallery",
          price,
          String(product.stockQuantity),
          "FixedPriceItem",
          "GTC",
          product.ebayCurrency ?? defaultCurrency,
          buildEbayListingConditionId(product, defaultConditionId),
          defaultHandlingTime,
          defaultShippingService,
          defaultShippingCost,
          defaultFreeShipping,
          defaultReturnsAccepted,
          defaultReturnsWithin,
          defaultRefundOption,
          defaultShippingCostPaidBy,
          itemSpecifics.Brand,
          itemSpecifics.Type,
          itemSpecifics.Artist,
          itemSpecifics["Featured Person/Artist"],
          itemSpecifics.Franchise,
          itemSpecifics.Set,
          itemSpecifics.Genre,
          itemSpecifics["Country/Region of Manufacture"],
          itemSpecifics["Original/Reproduction"],
        ];
      });

      workbookRows = [DEFAULT_HEADER, ...rows];
    }

    return workbookResponse(workbookRows, `ebay-new-listings-ready-${date}.xlsx`);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    throw error;
  }
}
