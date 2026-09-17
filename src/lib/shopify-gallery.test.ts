import { describe, expect, it, vi } from "vitest";
import { assertShopifyGallery, ShopifyMediaPendingError } from "./shopify-gallery";

const hash = "a".repeat(64);
const cover = "b".repeat(64);
const source = `https://r2.example/products/channel-watermarked/${hash}.jpg`;
const cdn = (name: string) => `https://cdn.shopify.com/s/files/1/files/${name}.jpg?v=1`;
function request(urls: string[], hasNextPage = false) {
  return vi.fn().mockResolvedValue({ data: { product: { media: { pageInfo: { hasNextPage }, nodes: urls.map((url) => ({ status: "READY", image: { url } })) } } } });
}
describe("Shopify 게시 전 갤러리 검사", () => {
  it("작업 이미지 뒤에 포카마켓 원본이 남은 실제 사고 구성을 차단한다", async () => {
    await expect(assertShopifyGallery(request([cdn(hash), cdn("unapproved-pocamarket")]), "123", [source])).rejects.toThrow("미승인");
  });
  it("승인된 이미지와 Shopify 중복 파일명 접미사는 허용한다", async () => {
    await expect(assertShopifyGallery(request([cdn(`${hash}_123-456`)]), "123", [source])).resolves.toBeUndefined();
  });
  it("대표 묶음 썸네일이 첫 번째가 아니면 차단한다", async () => {
    await expect(assertShopifyGallery(request([cdn(hash), cdn(cover)]), "123", [cdn(cover), source])).rejects.toThrow("미승인");
  });
  it("누락 이미지와 조회가 잘린 갤러리도 통과시키지 않는다", async () => {
    await expect(assertShopifyGallery(request([cdn(hash)], true), "123", [source])).rejects.toThrow("전체 이미지");
  });
  it("처리 대기 중인 이미지는 미승인으로 판단하지 않고 재확인 가능한 오류를 반환한다", async () => {
    vi.useFakeTimers();
    try {
      const pending = expect(assertShopifyGallery(request([]), "123", [source])).rejects.toBeInstanceOf(ShopifyMediaPendingError);
      await vi.runAllTimersAsync(); await pending;
    } finally { vi.useRealTimers(); }
  });
  it("12초 이후 준비된 정상 이미지는 게시 검증을 통과한다", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      const query = vi.fn(async () => ({ data: { product: { media: { nodes: [{ status: Date.now()-start < 15000 ? 'PROCESSING' : 'READY', image: {url:cdn(hash)} }] } } } }));
      const result = assertShopifyGallery(query, '123', [source]);
      await vi.runAllTimersAsync(); await expect(result).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
});
