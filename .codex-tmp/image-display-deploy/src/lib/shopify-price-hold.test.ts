import {expect,it,vi} from 'vitest';
import {holdShopifyVariantForMissingPrice} from './shopify-price-hold';
const identity={sku:'SKU',shopifyProductId:'1',shopifyVariantId:'2',shopifyInventoryItemId:'3'};
function fixture(){
 const state={id:'gid://shopify/ProductVariant/2',sku:'SKU',product:{id:'gid://shopify/Product/1'},inventoryPolicy:'CONTINUE',metafield:{value:'false'},inventoryItem:{id:'gid://shopify/InventoryItem/3',tracked:false,inventoryLevels:{pageInfo:{hasNextPage:false,endCursor:null},nodes:[4,5].map(id=>({location:{id:`gid://shopify/Location/${id}`},quantities:[{name:'available',quantity:8}]}))}}};
 const request=vi.fn(async (input:{path:string;body?:unknown})=>{
   const body=input.body as Record<string,unknown>;
   if(String(body?.query).includes('query priceHoldState'))return {data:{productVariant:structuredClone(state)}};
   if(String(body?.query).includes('mutation priceHold')){state.metafield.value='true';return {data:{metafieldsSet:{metafields:[{key:'price_review_required',value:'true'}],userErrors:[]}}};}
   if(input.path.startsWith('/variants/'))state.inventoryPolicy='DENY';
   if(input.path.startsWith('/inventory_items/'))state.inventoryItem.tracked=true;
   if(input.path==='/inventory_levels/set.json')state.inventoryItem.inventoryLevels.nodes.find(l=>l.location.id.endsWith('/'+body.location_id))!.quantities[0].quantity=0;
   return {};
 });return {state,request};
}
it('가격 미확정 옵션을 모든 위치에서 수량 0·추적·초과판매 금지로 만든 뒤 재조회한다',async()=>{
 const {state,request}=fixture();await holdShopifyVariantForMissingPrice(request,identity);
 expect(state.inventoryItem.inventoryLevels.nodes.every(l=>l.quantities[0].quantity===0)).toBe(true);
 expect(state.inventoryPolicy).toBe('DENY');expect(state.inventoryItem.tracked).toBe(true);
 expect(request.mock.calls.filter(([x])=>x.path==='/inventory_levels/set.json')).toHaveLength(2);
 expect(request.mock.calls.some(([x])=>JSON.stringify(x.body).includes('"price":'))).toBe(false);
});
it('잘못 연결된 SKU는 가격 보류도 다른 상품에 적용하지 않는다',async()=>{
 const {request}=fixture();await expect(holdShopifyVariantForMissingPrice(request,{...identity,sku:'OTHER'})).rejects.toThrow('연결');
 expect(request).toHaveBeenCalledTimes(1);
});
it('HTTP 성공이어도 재조회한 판매 수량이 남으면 성공 처리하지 않는다',async()=>{
 const {request}=fixture();const call=async(input:Parameters<typeof request>[0])=>input.path==='/inventory_levels/set.json'?{}:request(input);
 await expect(holdShopifyVariantForMissingPrice(call,identity)).rejects.toThrow('실제로 적용되지');
});
