type Request = (input: { method: string; path: string; body: unknown }) => Promise<unknown>;
export class ShopifyMediaPendingError extends Error {
  constructor() { super("Shopify 이미지 처리 대기 중입니다. 기존 상품에서 준비 상태를 다시 확인합니다."); }
}

export function shopifyImageIdentity(url: string) {
  try {
    const name = new URL(url).pathname.split("/").pop() ?? "";
    // Channel render keys are SHA-256. Shopify may append a duplicate suffix.
    return name.match(/^([a-f0-9]{64})(?:_|\.)/i)?.[1].toLowerCase() ?? name;
  } catch { return ""; }
}

export async function assertShopifyGallery(request: Request, productId: string, expectedUrls: string[]) {
  const expected = [...new Set(expectedUrls.map(shopifyImageIdentity))];
  if (!expected.length || expected.some((id) => !id)) throw new Error("승인된 Shopify 등록 이미지를 확인할 수 없습니다.");
  const deadline = Date.now() + 30_000;
  for (;;) {
    const result = await request({ method: "POST", path: "/graphql.json", body: {
      query: `query approvedProductGallery($id: ID!) { product(id: $id) { media(first: 250) { pageInfo { hasNextPage } nodes { status ... on MediaImage { image { url } } } } } }`,
      variables: { id: productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}` },
    } }) as { errors?: unknown[]; data?: { product?: { media?: { pageInfo?: { hasNextPage: boolean }; nodes: Array<{ status: string; image?: { url: string } }> } } } };
    const media = result.data?.product?.media;
    if (result.errors?.length || !media || media.pageInfo?.hasNextPage) throw new Error("Shopify 전체 이미지 검증에 실패하여 게시를 중단했습니다.");
    const pending = !media.nodes.length || media.nodes.some((item) => ["PROCESSING", "UPLOADED"].includes(item.status));
    if (pending && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      continue;
    }
    if (pending) throw new ShopifyMediaPendingError();
    const actual = media.nodes.map((item) => shopifyImageIdentity(item.image?.url ?? ""));
    if (media.nodes.some((item) => item.status !== "READY") || actual.length !== expected.length || actual[0] !== expected[0] || new Set(actual).size !== actual.length || actual.some((id) => !expected.includes(id))) {
      throw new Error("Shopify 이미지에 미승인·과거 이미지가 있거나 승인 이미지가 누락되어 게시를 중단했습니다. 이미지 교체 후 다시 확인해 주세요.");
    }
    return;
  }
}
