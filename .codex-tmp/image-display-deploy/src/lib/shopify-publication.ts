type Request = (input: { method: string; path: string; body: unknown }) => Promise<unknown>;
export const publicationPermissionMessage = "Shopify 온라인 스토어 게시 권한이 없습니다. 연결 앱에 read_publications·write_publications 권한을 추가하고 적용해 주세요.";

export async function onlineStorePublication(request: Request) {
  const result = await request({ method: "POST", path: "/graphql.json", body: { query: `query onlineStorePublication { currentAppInstallation { accessScopes { handle } } publications(first: 100) { nodes { id name } } }` } }) as {
    errors?: unknown[]; data?: { currentAppInstallation?: { accessScopes: { handle: string }[] }; publications?: { nodes: { id: string; name: string }[] } };
  };
  const scopes = result.data?.currentAppInstallation?.accessScopes.map((scope) => scope.handle) ?? [];
  if (result.errors?.length || !scopes.includes("write_publications")) throw new Error(publicationPermissionMessage);
  const publication = result.data?.publications?.nodes.find((node) => ["online store", "온라인 스토어"].includes(node.name.toLowerCase()));
  if (!publication) throw new Error("Shopify 온라인 스토어 판매채널을 찾지 못했습니다.");
  return publication.id;
}

export async function publishOnlineStore(request: Request, productId: string, publicationId: string) {
  const id = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;
  const result = await request({ method: "POST", path: "/graphql.json", body: {
    query: `mutation publishOnlineStore($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }`,
    variables: { id, input: [{ publicationId }] },
  } }) as { errors?: unknown[]; data?: { publishablePublish?: { userErrors: { message: string }[] } } };
  if (result.errors?.length || !result.data?.publishablePublish || result.data.publishablePublish.userErrors.length) throw new Error("Shopify 상품은 저장됐지만 온라인 스토어 게시에 실패했습니다. 상품 관리에서 게시 상태를 확인해 주세요.");
  const verified = await request({ method: "POST", path: "/graphql.json", body: {
    query: `query verifyOnlineStore($id: ID!, $publicationId: ID!) { product(id: $id) { status publishedOnPublication(publicationId: $publicationId) } }`, variables: { id, publicationId },
  } }) as { errors?: unknown[]; data?: { product?: { status: string; publishedOnPublication: boolean } } };
  if (verified.errors?.length || verified.data?.product?.status !== "ACTIVE" || !verified.data.product.publishedOnPublication) throw new Error("Shopify 온라인 스토어 게시 결과가 확인되지 않았습니다.");
}
