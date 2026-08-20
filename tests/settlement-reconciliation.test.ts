import { describe, expect, it, vi } from "vitest";

vi.mock("server-only",()=>({}));vi.mock("@/lib/prisma",()=>({prisma:{}}));vi.mock("@/lib/ebay",()=>({getValidAccessToken:vi.fn()}));vi.mock("@/lib/env",()=>({getEbayConfig:vi.fn(),getShopifyConfig:vi.fn()}));vi.mock("@/lib/services/shopifyService",()=>({shopifyApiRequest:vi.fn(),ShopifyApiError:class extends Error{status=500}}));
const {aggregateEbayTransactions,aggregateShopifyTransactions}=await import("@/lib/services/settlementReconciliation");

describe("settlement aggregation",()=>{
  it("nets eBay credits and debits by exact order id",()=>{const map=aggregateEbayTransactions([{orderId:"o1",bookingEntry:"CREDIT",amount:{value:"8.50",currency:"USD"},totalFeeAmount:{value:"1.50"},totalFeeBasisAmount:{value:"10"},payoutId:"pay1"},{orderId:"o1",bookingEntry:"DEBIT",amount:{value:"2.00",currency:"USD"},totalFeeAmount:{value:"0"},totalFeeBasisAmount:{value:"2"}}]);expect(map.get("o1")).toEqual({net:6.5,fees:1.5,gross:8,currency:"USD",payoutId:"pay1"})});
  it("uses Shopify's canonical balance net",()=>{const map=aggregateShopifyTransactions([{source_order_id:42,amount:"10",fee:"1",net:"9",currency:"USD",payout_id:7},{source_order_id:42,amount:"-2",fee:"0",net:"-2",currency:"USD",payout_id:7}]);expect(map.get("42")).toEqual({net:7,fees:1,gross:8,currency:"USD",payoutId:"7"})});
});
