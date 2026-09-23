import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ getShopifyConfig: () => ({}) }));
vi.mock("@/lib/services/shopifyService", () => ({ shopifyApiRequest: request, ShopifyApiError: class extends Error {} }));
import { getOrdersFromShopify } from "@/lib/shopify-orders";
beforeEach(() => request.mockReset());
it("requests fulfillments as an array and retains order pagination", async () => {
 request.mockResolvedValueOnce({data:{orders:{nodes:[{id:"1",fulfillments:[{id:"f1"}]}],pageInfo:{hasNextPage:true,endCursor:"next"}}}}).mockResolvedValueOnce({data:{orders:{nodes:[],pageInfo:{hasNextPage:false}}}});
 const pages=[];for await(const page of getOrdersFromShopify({}))pages.push(page);
 expect(pages[0][0].fulfillments).toEqual([{id:"f1"}]);
 expect(request.mock.calls[0][1].body.query).toMatch(/fulfillments\(first: 50\)\s*\{\s*id status/);
 expect(request.mock.calls[1][1].body.variables.after).toBe("next");
});
it.each([["undefinedField","조회 형식"],["ACCESS_DENIED","접근이 거부"],["THROTTLED","요청량"]])("distinguishes %s from an assumed scope failure", async(code,text)=>{
 request.mockResolvedValue({errors:[{extensions:{code}}]});
 await expect(getOrdersFromShopify({}).next()).rejects.toThrow(text);
});
