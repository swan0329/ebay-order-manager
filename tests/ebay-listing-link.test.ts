import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listingFindFirst = vi.fn();
const reportFindFirst = vi.fn();
const productFindUnique = vi.fn();
const productFindFirst = vi.fn();
const listingUpdate = vi.fn();
const listingUpdateMany = vi.fn();
const productUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ebayActiveListing: {
      findFirst: (...args: unknown[]) => listingFindFirst(...args),
      update: (...args: unknown[]) => listingUpdate(...args),
    },
    ebayReportImport: {
      findFirst: (...args: unknown[]) => reportFindFirst(...args),
    },
    product: {
      findUnique: (...args: unknown[]) => productFindUnique(...args),
      findFirst: (...args: unknown[]) => productFindFirst(...args),
      update: (...args: unknown[]) => productUpdate(...args),
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        ebayActiveListing: { update: listingUpdate, updateMany: listingUpdateMany },
        product: { update: productUpdate },
      }),
  },
}));

const { linkEbayActiveListing, EbayListingLinkError } = await import(
  "@/lib/ebay-active-report"
);

const input = { productId: "prod-1", itemId: "123456789012" };

beforeEach(() => {
  vi.clearAllMocks();
  reportFindFirst.mockResolvedValue({ id: "report-latest" });
  listingFindFirst.mockResolvedValue({
    id: "listing-1",
    itemId: input.itemId,
    productId: null,
    title: "Stray Kids HAN ATE POP-UP STORE REWARD Official Photocard",
  });
  productFindUnique.mockResolvedValue({
    id: "prod-1",
    ebayItemId: null,
    brand: "Stray Kids",
    category: "ATE POP-UP STORE REWARD",
    optionName: "HAN",
    productName: "Stray Kids ATE POP-UP STORE REWARD HAN",
    ebayTitle: null,
    featuredMembers: null,
  });
  productFindFirst.mockResolvedValue(null);
});

describe("수동 리스팅 연결", () => {
  it("최신 활성상품 보고서가 없으면 연결을 거부한다", async () => {
    reportFindFirst.mockResolvedValue(null);

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow(
      "최신 보고서를 먼저 가져와 주세요",
    );
    expect(listingFindFirst).not.toHaveBeenCalled();
  });

  it("보고서에 있는 리스팅을 상품에 연결하고 판매중으로 표시한다", async () => {
    await expect(linkEbayActiveListing("user-1", input)).resolves.toEqual({
      productId: "prod-1",
      itemId: input.itemId,
      replacedItemId: null,
      addedAlongside: false,
    });

    // 연결 검토 파일이 matchStatus != MATCHED로 거르므로 MATCHED여야 목록에서 빠진다.
    // linkedAt은 "방금 연결한 것" 목록의 정렬 기준이므로 함께 기록돼야 한다.
    expect(listingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: "prod-1",
          matchStatus: "MATCHED",
          linkedAt: expect.any(Date),
        }),
      }),
    );
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ebayItemId: input.itemId, listingStatus: "ACTIVE" },
      }),
    );
  });

  it("보고서에 없는 상품번호는 거부한다", async () => {
    listingFindFirst.mockResolvedValue(null);

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow(
      EbayListingLinkError,
    );
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("가격 화면의 연결은 같은 멤버라도 앨범이 다르면 서버에서 거부한다", async () => {
    listingFindFirst.mockResolvedValue({
      id: "listing-1",
      itemId: input.itemId,
      productId: null,
      title: "Stray Kids HAN ROCK-STAR Official Photocard",
    });

    await expect(
      linkEbayActiveListing("user-1", { ...input, requireCompatibleTitle: true }),
    ).rejects.toThrow("앨범과 충분히 일치하지 않아");
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("이미 다른 상품에 연결된 리스팅은 거부한다", async () => {
    listingFindFirst.mockResolvedValue({
      id: "listing-1",
      itemId: input.itemId,
      productId: "prod-other",
    });

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow(
      "이미 다른 상품에 연결",
    );
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("다른 상품번호가 이미 붙은 상품은 거부한다", async () => {
    productFindUnique.mockResolvedValue({ id: "prod-1", ebayItemId: "999999999999" });

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow(
      "이미 다른 상품번호",
    );
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("같은 상품번호를 이미 쓰는 다른 상품이 있으면 거부한다", async () => {
    productFindFirst.mockResolvedValue({ id: "prod-other", sku: "SKU-OTHER" });

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow("SKU-OTHER");
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("바꾸기를 요청하면 예전 연결을 풀고 새 상품번호로 바꾼다", async () => {
    productFindUnique.mockResolvedValue({ id: "prod-1", ebayItemId: "999999999999" });

    await expect(
      linkEbayActiveListing("user-1", { ...input, replaceExisting: true }),
    ).resolves.toEqual({
      productId: "prod-1",
      itemId: input.itemId,
      replacedItemId: "999999999999",
      addedAlongside: false,
    });

    // 예전 리스팅이 같은 상품을 계속 가리키면 두 건이 한 상품을 물게 된다.
    expect(listingUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { itemId: "999999999999", productId: "prod-1" },
        data: { productId: null, matchStatus: "UNMATCHED", linkedAt: null },
      }),
    );
  });

  it("함께 연결하면 기존 상품번호를 그대로 두고 리스팅만 묶는다", async () => {
    productFindUnique.mockResolvedValue({ id: "prod-1", ebayItemId: "999999999999" });

    await expect(
      linkEbayActiveListing("user-1", { ...input, allowMultiple: true }),
    ).resolves.toEqual({
      productId: "prod-1",
      itemId: input.itemId,
      replacedItemId: null,
      addedAlongside: true,
    });

    // 예전 리스팅은 그대로 둔다.
    expect(listingUpdateMany).not.toHaveBeenCalled();
    // 상품의 대표 상품번호는 먼저 붙은 것을 유지한다.
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { listingStatus: "ACTIVE" } }),
    );
  });

  it("바꾸기를 요청하지 않으면 기존 연결을 건드리지 않는다", async () => {
    productFindUnique.mockResolvedValue({ id: "prod-1", ebayItemId: "999999999999" });

    await expect(linkEbayActiveListing("user-1", input)).rejects.toThrow(
      "이미 다른 상품번호",
    );
    expect(listingUpdateMany).not.toHaveBeenCalled();
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("바꾸기라도 다른 상품이 쓰는 상품번호는 거부한다", async () => {
    productFindUnique.mockResolvedValue({ id: "prod-1", ebayItemId: "999999999999" });
    productFindFirst.mockResolvedValue({ id: "prod-other", sku: "SKU-OTHER" });

    await expect(
      linkEbayActiveListing("user-1", { ...input, replaceExisting: true }),
    ).rejects.toThrow("SKU-OTHER");
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("같은 연결을 다시 요청해도 안전하다", async () => {
    listingFindFirst.mockResolvedValue({
      id: "listing-1",
      itemId: input.itemId,
      productId: "prod-1",
    });
    productFindUnique.mockResolvedValue({ id: "prod-1", ebayItemId: input.itemId });

    await expect(linkEbayActiveListing("user-1", input)).resolves.toEqual({
      productId: "prod-1",
      itemId: input.itemId,
      replacedItemId: null,
      addedAlongside: false,
    });
  });
});
