type RouteContext={params:Promise<{id:string}>};
// Shopify 상품 쓰기는 /api/ebay/operations?channel=SHOPIFY 한 곳에서만 한다.
// 그 경로는 묶음 옵션 구성, 최신 재고, 가격, 미리보기 토큰과 최종 확인을 모두
// 검사한다. 이 옛 단건 엔드포인트를 남겨 두면 그 안전 절차를 우회하게 된다.
export async function POST(_request:Request,context:RouteContext){await context.params;return Response.json({error:"Shopify 전송은 채널 운영 메뉴에서 미리보기와 최종 확인 후 실행해 주세요."},{status:409});}
