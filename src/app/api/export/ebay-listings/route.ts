import { jsonError } from "@/lib/http";
import { productWhere } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { requireApiUser, UnauthorizedError } from "@/lib/session";
import { toCsv } from "@/lib/csv";

// eBay File Exchange format for Seller Hub bulk upload
// https://developer.ebay.com/DevZone/file-exchange/docs/index.html

const HEADER = [
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
    await requireApiUser();

    const url = new URL(request.url);
    const p = (key: string, fallback: string) =>
      url.searchParams.get(key)?.trim() || fallback;

    const defaultCategoryId = p("category_id", "");
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
    const defaultSiteId = p("site_id", "0");

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

    const rows = products
      .filter((product) => {
        const hasPrice = Boolean(product.ebayPrice ?? product.salePrice);
        const hasImage =
          product.ebayImageUrls.length > 0 || Boolean(product.imageUrl);
        return hasPrice && hasImage;
      })
      .map((product) => {
        const title = (product.ebayTitle ?? product.productName).slice(0, 80);
        const price = (product.ebayPrice ?? product.salePrice)?.toFixed(2) ?? "";
        const description =
          product.descriptionHtml ??
          product.memo ??
          `<p>${product.productName}</p>`;
        const picUrl =
          product.ebayImageUrls.length > 0
            ? product.ebayImageUrls.join("|")
            : (product.imageUrl ?? "");
        const categoryId =
          defaultCategoryId || (product.ebayCategoryId ?? "");
        const currency = product.ebayCurrency ?? defaultCurrency;

        return [
          "Add",
          defaultSiteId,
          categoryId,
          product.sku,
          title,
          description,
          picUrl,
          "Gallery",
          price,
          product.stockQuantity,
          "FixedPriceItem",
          "GTC",
          currency,
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

    const csv = toCsv([HEADER, ...rows]);
    const date = new Date().toISOString().slice(0, 10);

    return new Response(`﻿${csv}`, {
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
