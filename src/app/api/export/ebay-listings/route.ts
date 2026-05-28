import { jsonError } from "@/lib/http";
import { productWhere } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { toCsv } from "@/lib/csv";
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
];

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();

    const url = new URL(request.url);
    const p = (key: string, fallback: string) =>
      url.searchParams.get(key)?.trim() || fallback;

    const savedTemplate = await getEbayFileTemplate(user.id);

    const products = await prisma.product.findMany({
      where: productWhere({
        q: url.searchParams.get("q"),
        status: url.searchParams.get("status") ?? "active",
        stock: url.searchParams.get("stock") ?? "in_stock",
        group: url.searchParams.get("group"),
        member: url.searchParams.get("member"),
        album: url.searchParams.get("album"),
        version: url.searchParams.get("version"),
      }),
      orderBy: { sku: "asc" },
    });

    const exportable = products.filter((product) => {
      const hasPrice = Boolean(product.ebayPrice ?? product.salePrice);
      const hasImage =
        product.ebayImageUrls.length > 0 || Boolean(product.imageUrl);
      return hasPrice && hasImage;
    });

    const date = new Date().toISOString().slice(0, 10);
    let csvBody: string;

    if (savedTemplate) {
      const { columns, defaults, isSellerHubFormat } = savedTemplate;

      const rows = exportable.map((product) =>
        columns.map((col) =>
          getProductValue(col, product, defaults[col] ?? ""),
        ),
      );

      const dataCsv = toCsv([columns, ...rows]);

      if (isSellerHubFormat) {
        // Prepend the #INFO metadata rows required by Seller Hub Reports format
        const ts = Date.now();
        const infoPart = [
          `#INFO,Created=${ts}`,
          `#INFO,Version=1.0,,Template=fx_category_template_EBAY_US`,
          `#INFO`,
        ].join("\n");
        csvBody = `﻿${infoPart}\n${dataCsv}`;
      } else {
        csvBody = `﻿${dataCsv}`;
      }
    } else {
      // Fallback: classic File Exchange format using query-param defaults
      const defaultSiteId = p("site_id", "0");
      const defaultConditionId = p("condition_id", "3000");
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
        const price =
          (product.ebayPrice ?? product.salePrice)?.toFixed(2) ?? "";
        const picUrl =
          product.ebayImageUrls.length > 0
            ? product.ebayImageUrls.join("|")
            : (product.imageUrl ?? "");

        return [
          "Add",
          defaultSiteId,
          defaultCategoryId || (product.ebayCategoryId ?? ""),
          product.sku,
          (product.ebayTitle ?? product.productName).slice(0, 80),
          product.descriptionHtml ??
            product.memo ??
            `<p>${product.productName}</p>`,
          picUrl,
          "Gallery",
          price,
          String(product.stockQuantity),
          "FixedPriceItem",
          "GTC",
          product.ebayCurrency ?? defaultCurrency,
          defaultConditionId,
          defaultHandlingTime,
          defaultShippingService,
          defaultShippingCost,
          defaultFreeShipping,
          defaultReturnsAccepted,
          defaultReturnsWithin,
          defaultRefundOption,
          defaultShippingCostPaidBy,
          product.brand ?? "",
          product.optionName ?? product.productName,
        ];
      });

      csvBody = `﻿${toCsv([DEFAULT_HEADER, ...rows])}`;
    }

    return new Response(csvBody, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ebay-listings-${date}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError("Unauthorized", 401);
    }

    throw error;
  }
}
