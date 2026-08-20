import "server-only";

import type { EbayAccount } from "@/generated/prisma";
import { getValidAccessToken } from "@/lib/ebay";
import { getEbayConfig, getShopifyConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { shopifyApiRequest, ShopifyApiError } from "@/lib/services/shopifyService";

const FINANCES_SCOPE = "https://api.ebay.com/oauth/api_scope/sell.finances";
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown) { return typeof value === "string" ? value : null; }
function amount(value: unknown) { const numeric = Number(record(value).value ?? value); return Number.isFinite(numeric) ? numeric : 0; }

export type SettlementActual = { net: number; fees: number; gross: number; currency: string; payoutId: string | null };

export function aggregateEbayTransactions(values: unknown[]) {
  const result = new Map<string, SettlementActual>();
  for (const value of values) {
    const row = record(value); const orderId = text(row.orderId); if (!orderId) continue;
    const sign = text(row.bookingEntry) === "DEBIT" ? -1 : 1;
    const current = result.get(orderId) ?? { net: 0, fees: 0, gross: 0, currency: text(record(row.amount).currency) ?? "USD", payoutId: null };
    current.net += sign * amount(row.amount);
    current.fees += amount(row.totalFeeAmount);
    current.gross += sign * amount(row.totalFeeBasisAmount);
    current.payoutId = text(row.payoutId) ?? current.payoutId;
    result.set(orderId, current);
  }
  return result;
}

export function aggregateShopifyTransactions(values: unknown[]) {
  const result = new Map<string, SettlementActual>();
  for (const value of values) {
    const row = record(value); const orderId = String(row.source_order_id ?? ""); if (!orderId) continue;
    const current = result.get(orderId) ?? { net: 0, fees: 0, gross: 0, currency: text(row.currency) ?? "USD", payoutId: null };
    current.net += Number(row.net ?? 0) || 0;
    current.fees += Number(row.fee ?? 0) || 0;
    current.gross += Number(row.amount ?? 0) || 0;
    current.payoutId = row.payout_id == null ? current.payoutId : String(row.payout_id);
    result.set(orderId, current);
  }
  return result;
}

async function fetchEbayTransactions(account: EbayAccount, from: Date, to: Date) {
  if (!account.scopes.split(/\s+/).includes(FINANCES_SCOPE)) throw new Error("EBAY_FINANCES_SCOPE_REQUIRED");
  const config = getEbayConfig(); const transactions: unknown[] = []; let offset = 0;
  while (true) {
    const url = new URL("/sell/finances/v1/transaction", config.hosts.identity);
    url.searchParams.set("limit", "200"); url.searchParams.set("offset", String(offset));
    url.searchParams.append("filter", `transactionDate:[${from.toISOString()}..${to.toISOString()}]`);
    const response = await fetch(url, { headers: { authorization: `Bearer ${await getValidAccessToken(account)}`, accept: "application/json" } });
    const body = response.status === 204 ? {} : await response.json().catch(() => null);
    if (!response.ok && response.status !== 204) throw new Error(response.status === 403 ? "EBAY_FINANCES_SCOPE_REQUIRED" : `eBay 정산 조회 실패 (HTTP ${response.status})`);
    const payload = record(body); const page = array(payload.transactions); transactions.push(...page);
    const total = Number(payload.total ?? transactions.length); offset += page.length;
    if (!page.length || offset >= total) break;
  }
  return transactions;
}

async function fetchShopifyTransactions() {
  try {
    const body = await shopifyApiRequest(getShopifyConfig(), { path: "/shopify_payments/balance/transactions.json?limit=250" });
    return array(record(body).transactions);
  } catch (error) {
    if (error instanceof ShopifyApiError && [401, 403].includes(error.status)) throw new Error("SHOPIFY_PAYOUT_SCOPE_REQUIRED");
    throw error;
  }
}

function orderCostUsd(order: { items: Array<{ quantity: number; product: { salePrice: { toString(): string } | null } | null }> }, settings: { domesticShippingKrw: { toString(): string }; buyingAgencyFeeKrw: { toString(): string }; exchangeRateKrwPerUsd: { toString(): string } } | null) {
  if (!settings) return null;
  let krw = 0;
  for (const item of order.items) {
    if (!item.product?.salePrice) return null;
    krw += item.quantity * (Number(item.product.salePrice) + Number(settings.domesticShippingKrw) + Number(settings.buyingAgencyFeeKrw));
  }
  return krw / Number(settings.exchangeRateKrwPerUsd);
}

export async function reconcileSettlements(userId: string, days: number) {
  const to = new Date(); const from = new Date(to.getTime() - days * 86400000);
  const [orders, settings, account] = await Promise.all([
    prisma.order.findMany({ where: { userId, orderDate: { gte: from } }, include: { items: { include: { product: { select: { salePrice: true } } } } }, orderBy: { orderDate: "desc" } }),
    prisma.pricingSettings.findUnique({ where: { id: "default" } }),
    prisma.ebayAccount.findFirst({ where: { userId, environment: getEbayConfig().environment === "production" ? "PRODUCTION" : "SANDBOX" }, orderBy: { updatedAt: "desc" } }),
  ]);
  let ebay = new Map<string, SettlementActual>(); let shopify = new Map<string, SettlementActual>();
  let ebayError: string | null = null; let shopifyError: string | null = null;
  if (!account) ebayError = "eBay 계정 연결이 필요합니다.";
  else try { ebay = aggregateEbayTransactions(await fetchEbayTransactions(account, from, to)); } catch (error) { ebayError = error instanceof Error ? error.message : "eBay 정산 조회 실패"; }
  try { shopify = aggregateShopifyTransactions(await fetchShopifyTransactions()); } catch (error) { shopifyError = error instanceof Error ? error.message : "Shopify 정산 조회 실패"; }

  const rows = orders.map((order) => {
    const actual = order.channel === "SHOPIFY" ? shopify.get(order.externalOrderId) : ebay.get(order.externalOrderId);
    const costUsd = orderCostUsd(order, settings);
    const actualMargin = actual && costUsd !== null ? actual.net - costUsd : null;
    return { orderId: order.id, externalOrderId: order.externalOrderId, channel: order.channel, orderDate: order.orderDate.toISOString(), grossOrderAmount: Number(order.totalAmount), currency: order.currency, actual, costUsd, actualMargin, matched: Boolean(actual) };
  });
  return { from: from.toISOString(), to: to.toISOString(), rows, channels: { ebay: { error: ebayError, reconnectRequired: ebayError === "EBAY_FINANCES_SCOPE_REQUIRED" }, shopify: { error: shopifyError, permissionRequired: shopifyError === "SHOPIFY_PAYOUT_SCOPE_REQUIRED" } } };
}
