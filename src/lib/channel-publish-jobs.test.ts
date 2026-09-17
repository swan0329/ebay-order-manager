import { beforeEach, describe, expect, it, vi } from "vitest";
const imageChangesMock = vi.hoisted(() => vi.fn());
const recordImageSyncMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/channel-image-changes", () => ({ getChannelImageChanges: imageChangesMock, recordChannelImageSync: recordImageSyncMock }));
vi.mock("@/lib/ebay-image-repair", () => ({ repairEbayImages: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  listingDraft: { findMany: vi.fn(), findFirst: vi.fn() },
  product: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  pricingSettings: { findUnique: vi.fn() },
  channelPublishJob: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  channelPublishItem: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    groupBy: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));
const syncShopifyMock = vi.hoisted(() => vi.fn());
const syncShopifyImagesMock = vi.hoisted(() => vi.fn());
const archiveShopifyMock = vi.hoisted(() => vi.fn());
const uploadShopifyMock = vi.hoisted(() => vi.fn());
const uploadShopifyVariationMock = vi.hoisted(() => vi.fn());
const createDraftsFromInventoryMock = vi.hoisted(() => vi.fn());
const publishEbayVariationMock = vi.hoisted(() => vi.fn());
const variationCandidateIdsMock = vi.hoisted(() => vi.fn(() => Promise.resolve(new Set<string>())));
const variationGroupsMock = vi.hoisted(() => vi.fn<() => Promise<Array<{
  key: string;
  groupName: string;
  albumName: string;
  versionName: string;
  title: string;
  products: Array<{ id: string; sku: string; variationName: string }>;
}>>>(() => Promise.resolve([])));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/services/ebayListingUploadService", () => ({ uploadDraft: vi.fn() }));
vi.mock("@/lib/services/shopifyService", () => ({
  archiveShopifyProduct: archiveShopifyMock,
  syncShopifyImages: syncShopifyImagesMock,
  syncShopifyPriceAndInventory: syncShopifyMock,
  uploadProductToShopify: uploadShopifyMock,
  uploadVariationGroupToShopify: uploadShopifyVariationMock,
}));
vi.mock("@/lib/variation-listing-products", () => ({
  getVariationCandidateProductIds: variationCandidateIdsMock,
  getEbayVariationMembershipByProductId: vi.fn().mockResolvedValue(new Map()),
  getVariationListingGroups: variationGroupsMock,
}));
vi.mock("@/lib/services/listingDraftService", () => ({
  createDraftsFromInventory: createDraftsFromInventoryMock,
}));
vi.mock("@/lib/ebay-variation-publish", () => ({
  publishEbayVariationGroup: publishEbayVariationMock,
}));

import { EbayApiError } from "@/lib/ebay";
import { PublishContinuationError } from "@/lib/channel-publish-runtime";

import {
  createAutomaticProductPublishJob,
  createChannelPublishJob,
  createShopifyAutomaticOperationJob,
  getShopifyAutomaticOperationProductIds,
  processChannelPublishJob,
} from "@/lib/channel-publish-jobs";

beforeEach(() => {
  vi.clearAllMocks();
  imageChangesMock.mockResolvedValue([{ parent: "100", fingerprint: "current", productId: "p1" }]);
  prismaMock.channelPublishItem.findFirst.mockReset();
  prismaMock.listingDraft.findMany.mockReset();
  prismaMock.product.findMany.mockReset();
  prismaMock.pricingSettings.findUnique.mockReset();
  prismaMock.channelPublishJob.create.mockReset();
  variationCandidateIdsMock.mockResolvedValue(new Set());
  variationGroupsMock.mockResolvedValue([]);
  prismaMock.product.findFirst.mockResolvedValue(null);
});

describe("판매채널 백그라운드 작업", () => {
  it("Shopify 게시 대기 상품은 기존 ID가 있어도 등록 완료로 건너뛰지 않는다", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ id:'pending-product', sku:'310771', shopifyProductId:'100', shopifyStatus:'publication_pending' }]);
    prismaMock.channelPublishJob.create.mockResolvedValue({id:'pending-job'});
    await createAutomaticProductPublishJob({userId:'u1',channel:'SHOPIFY',productIds:['pending-product']});
    expect(prismaMock.channelPublishJob.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({items:{create:[{targetType:'PRODUCT',targetId:'pending-product',sku:'310771'}]}})}));
  });
  it("가격 없음은 수량 0 보류 대상으로, 가격 입력 후에는 재개 대상으로 선택한다", async () => {
    const base = { salePrice:null, finalListingPriceUsd:null, stockQuantity:2, pocamarketAvailableCount:0,
      shopifyLastSyncedPrice:null, shopifyLastSyncedQuantity:0 };
    prismaMock.product.findMany.mockResolvedValue([
      { ...base, id:"hold", sku:"1", shopifyStatus:"ACTIVE" },
      { ...base, id:"held", sku:"2", shopifyStatus:"PRICE_HOLD" },
      { ...base, id:"resume", sku:"3", shopifyStatus:"PRICE_HOLD", finalListingPriceUsd:12 },
    ]);
    expect(await getShopifyAutomaticOperationProductIds("revise")).toEqual([{id:"hold"},{id:"resume"}]);
  });
  it.each(["EBAY", "SHOPIFY"] as const)("%s 실행 대기 중 옵션이 변경돼도 미리보지 않은 카드를 게시하지 않는다", async (channel) => {
    const job = { id: "snapshot-job", userId: "u1", channel, mode: "REGISTER", status: "QUEUED" };
    prismaMock.channelPublishJob.findUnique.mockResolvedValue(job);
    prismaMock.channelPublishJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishJob.update.mockImplementation(({ data }) => Promise.resolve({ ...job, ...data }));
    prismaMock.channelPublishItem.findFirst.mockResolvedValueOnce({ id: "snapshot-item", targetType: `${channel}_VARIATION_GROUP`, targetId: JSON.stringify({ productId: "p1", memberIds: ["p1"] }), attempts: 1 });
    prismaMock.channelPublishItem.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishItem.update.mockResolvedValue({});
    prismaMock.channelPublishItem.groupBy.mockResolvedValue([{ status: "FAILED", _count: { _all: 1 } }]);
    variationGroupsMock.mockResolvedValue([{ key: "g", title: "BTS", groupName: "BTS", albumName: "Album", versionName: "", products: [{ id: "p1", sku: "1", variationName: "Jin" }, { id: "new", sku: "2", variationName: "V" }] }]);
    await processChannelPublishJob(job.id);
    expect(publishEbayVariationMock).not.toHaveBeenCalled();
    expect(uploadShopifyVariationMock).not.toHaveBeenCalled();
    expect(prismaMock.channelPublishItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", error: expect.stringContaining("옵션 구성이 변경") }) }));
  });
  it("시험등록 미리보기와 달라진 옵션 구성은 초안 생성 전에 중단한다", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ id: "p1", sku: "1" }]);
    variationGroupsMock.mockResolvedValue([{ key: "g", title: "BTS", groupName: "BTS", albumName: "Album", versionName: "", products: [{ id: "p1", sku: "1", variationName: "Jin" }, { id: "new", sku: "2", variationName: "V" }] }]);
    await expect(createAutomaticProductPublishJob({ userId: "u1", channel: "EBAY", productIds: ["p1"], expectedOptionProductIds: ["p1"] })).rejects.toThrow("옵션 구성이 변경");
    expect(createDraftsFromInventoryMock).not.toHaveBeenCalled();
    expect(prismaMock.channelPublishJob.create).not.toHaveBeenCalled();
  });
  it.each(["EBAY", "SHOPIFY"] as const)("%s에 이미 등록된 상품은 초안·등록 없이 별도 처리한다", async (channel) => {
    prismaMock.product.findMany.mockResolvedValue([{ id: "p1", sku: "100284", ebayItemId: "ebay-1", shopifyProductId: "shopify-1" }]);
    prismaMock.channelPublishJob.create.mockImplementation(({ data }) => Promise.resolve({ id: "skip-job", ...data }));
    const job = await createAutomaticProductPublishJob({ userId: "u1", channel, productIds: ["p1"] });
    expect(job).toMatchObject({ mode: "REGISTER", totalCount: 1, items: { create: [{ targetType: "REGISTERED_PRODUCT", targetId: "p1", sku: "100284" }] } });
    expect(createDraftsFromInventoryMock).not.toHaveBeenCalled();
    expect(variationGroupsMock).not.toHaveBeenCalled();
  });

  it.each(["EBAY", "SHOPIFY"] as const)("%s 기등록 건수는 성공·실패에 포함하지 않고 완료한다", async (channel) => {
    const job = { id: "skip-job", userId: "u1", channel, mode: "REGISTER", status: "QUEUED" };
    prismaMock.channelPublishJob.findUnique.mockResolvedValue(job);
    prismaMock.channelPublishJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishJob.update.mockImplementation(({ data }) => Promise.resolve({ ...job, ...data }));
    prismaMock.channelPublishItem.findFirst.mockResolvedValueOnce({ id: "skip-item", targetType: "REGISTERED_PRODUCT", targetId: "p1", attempts: 1 });
    prismaMock.channelPublishItem.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishItem.update.mockResolvedValue({});
    prismaMock.channelPublishItem.groupBy.mockResolvedValue([{ status: "SKIPPED", _count: { _all: 1 } }]);
    const result = await processChannelPublishJob(job.id);
    expect(result.job).toMatchObject({ status: "COMPLETED", processedCount: 1, successCount: 0, failureCount: 0 });
    expect(prismaMock.channelPublishItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED", error: "이미 등록 완료" }) }));
    expect(publishEbayVariationMock).not.toHaveBeenCalled();
    expect(uploadShopifyMock).not.toHaveBeenCalled();
    expect(syncShopifyMock).not.toHaveBeenCalled();
  });
  it("정상적인 준비 작업 양보는 실패나 강제 종료 시도로 계산하지 않는다", async () => {
    const job = { id: "job-yield", userId: "user-1", channel: "EBAY", mode: "UPSERT", status: "RUNNING" };
    prismaMock.channelPublishJob.findUnique.mockResolvedValue(job);
    prismaMock.channelPublishJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishJob.update.mockImplementation(({ data }) => Promise.resolve({ ...job, ...data }));
    prismaMock.channelPublishItem.findFirst.mockResolvedValueOnce({ id: "yield-item", targetType: "EBAY_VARIATION_GROUP", targetId: "p1", attempts: 1 });
    prismaMock.channelPublishItem.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishItem.update.mockResolvedValue({});
    prismaMock.channelPublishItem.groupBy.mockResolvedValue([{ status: "QUEUED", _count: { _all: 1 } }]);
    variationGroupsMock.mockResolvedValue([{ key: "g", title: "BTS", groupName: "BTS", albumName: "Album", versionName: "", products: [{ id: "p1", sku: "100284", variationName: "Jimin" }] }]);
    publishEbayVariationMock.mockRejectedValueOnce(new PublishContinuationError());
    const result = await processChannelPublishJob(job.id);
    expect(result).toMatchObject({ shouldContinue: true, job: { failureCount: 0 } });
    expect(prismaMock.channelPublishItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED", attempts: { decrement: 1 } }) }));
  });
  it("Shopify 전체 가격·재고 대상을 자동 작업으로 만든다", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p1", sku: "SKU-1", salePrice: 0, finalListingPriceUsd: 12, shopifyLastSyncedPrice: 10, stockQuantity: 1, pocamarketAvailableCount: 0, shopifyLastSyncedQuantity: 1 },
      { id: "p2", sku: "SKU-2", salePrice: 0, finalListingPriceUsd: 15, shopifyLastSyncedPrice: 15, stockQuantity: 2, pocamarketAvailableCount: 0, shopifyLastSyncedQuantity: 1 },
    ]);
    prismaMock.channelPublishJob.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "job-auto", ...data }),
    );

    const job = await createShopifyAutomaticOperationJob({
      userId: "user-1",
      operation: "revise",
    });

    expect(job).toMatchObject({ channel: "SHOPIFY", mode: "PRICE_INVENTORY", totalCount: 2 });
  });

  it("Shopify는 업로드 시각이 아니라 실제 마지막 가격·수량과 비교한다", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "same", sku: "SAME", salePrice: 0, finalListingPriceUsd: 12, shopifyLastSyncedPrice: 12, stockQuantity: 2, pocamarketAvailableCount: 1, shopifyLastSyncedQuantity: 3 },
      { id: "quantity", sku: "QTY", salePrice: 0, finalListingPriceUsd: 9, shopifyLastSyncedPrice: 9, stockQuantity: 1, pocamarketAvailableCount: 1, shopifyLastSyncedQuantity: 1 },
    ]);

    await expect(getShopifyAutomaticOperationProductIds("revise")).resolves.toEqual([
      { id: "quantity" },
    ]);
  });

  it("선택한 Shopify 상품을 한 작업과 중복 없는 항목으로 저장한다", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p1", sku: "SKU-1" },
      { id: "p2", sku: "SKU-2" },
    ]);
    prismaMock.channelPublishJob.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "job-1", ...data }),
    );

    const job = await createChannelPublishJob({
      userId: "user-1",
      channel: "SHOPIFY",
      targetIds: ["p1", "p1", "p2"],
    });

    expect(job).toMatchObject({ id: "job-1", totalCount: 2 });
    expect(prismaMock.channelPublishJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        channel: "SHOPIFY",
        totalCount: 2,
        items: {
          create: [
            expect.objectContaining({ targetId: "p1", sku: "SKU-1" }),
            expect.objectContaining({ targetId: "p2", sku: "SKU-2" }),
          ],
        },
      }),
      include: { items: true },
    });
  });

  it("Shopify 신규등록은 옵션 묶음을 한 작업으로 자동 구성하고 나머지만 단품으로 만든다", async () => {
    variationGroupsMock.mockResolvedValue([{
      key: "group-a",
      groupName: "IVE",
      albumName: "Album",
      versionName: "Ver",
      title: "IVE Album Ver",
      products: [
        { id: "p1", sku: "SKU-1", variationName: "A" },
        { id: "p2", sku: "SKU-2", variationName: "B" },
      ],
    }]);
    prismaMock.product.findMany.mockResolvedValueOnce([{ id: "p1", sku: "SKU-1" }, { id: "p3", sku: "SKU-3" }]).mockResolvedValue([{ id: "p3", sku: "SKU-3" }]);
    prismaMock.channelPublishJob.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "job-auto-options", ...data }),
    );

    const job = await createAutomaticProductPublishJob({
      userId: "user-1",
      channel: "SHOPIFY",
      productIds: ["p1", "p3"],
    });

    expect(job).toMatchObject({ channel: "SHOPIFY", totalCount: 2 });
    expect(prismaMock.channelPublishJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        items: { create: [
          expect.objectContaining({ targetType: "SHOPIFY_VARIATION_GROUP", targetId: "p1" }),
          expect.objectContaining({ targetType: "PRODUCT", targetId: "p3" }),
        ] },
      }),
      include: { items: true },
    });
  });

  it("eBay 자동등록은 active 상태의 미등록 상품도 단품 초안으로 만든다", async () => {
    prismaMock.product.findMany.mockResolvedValue([{ id: "p1", sku: "SKU-1" }]);
    prismaMock.listingDraft.findMany.mockResolvedValue([{
      id: "draft-1",
      sourceInventoryId: "p1",
      sku: "SKU-1",
    }]);
    prismaMock.channelPublishJob.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "job-ebay-single", ...data }),
    );

    const job = await createAutomaticProductPublishJob({
      userId: "user-1",
      channel: "EBAY",
      productIds: ["p1"],
    });

    expect(createDraftsFromInventoryMock).toHaveBeenCalledWith({
      userId: "user-1",
      productIds: ["p1"],
      allowAnyProductStatus: true,
      automaticPublish: true,
    });
    expect(job).toMatchObject({ channel: "EBAY", totalCount: 1 });
  });

  it("eBay 단품 초안 생성 실패 시 SKU와 상품 상태를 알려준다", async () => {
    prismaMock.listingDraft.findMany.mockResolvedValue([]);
    prismaMock.product.findMany.mockResolvedValue([{
      id: "p1",
      sku: "SKU-FAILED",
      status: "active",
    }]);

    await expect(createAutomaticProductPublishJob({
      userId: "user-1",
      channel: "EBAY",
      productIds: ["p1"],
    })).rejects.toThrow("SKU-FAILED(active)");
  });

  it("eBay 옵션 등록 실패 시 API 오류 코드와 원문을 작업에 저장한다", async () => {
    const job = { id: "job-ebay-error", userId: "user-1", channel: "EBAY", mode: "UPSERT", status: "QUEUED" };
    prismaMock.channelPublishJob.findUnique.mockResolvedValue(job);
    prismaMock.channelPublishJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishItem.findFirst
      .mockResolvedValueOnce({
        id: "item-ebay-error",
        jobId: job.id,
        targetType: "EBAY_VARIATION_GROUP",
        targetId: "p1",
        attempts: 0,
      })
      .mockResolvedValueOnce(null);
    prismaMock.channelPublishItem.updateMany.mockResolvedValue({ count: 1 });
    variationGroupsMock.mockResolvedValue([{
      key: "group-a",
      groupName: "IVE",
      albumName: "Album",
      versionName: "Ver",
      title: "IVE Album Ver",
      products: [{ id: "p1", sku: "276627", variationName: "A" }],
    }]);
    publishEbayVariationMock.mockRejectedValue(new EbayApiError(
      "eBay Inventory API request failed.",
      400,
      { errors: [{ errorId: 25709, message: "Invalid value for header Accept-Language." }] },
    ));
    prismaMock.channelPublishItem.update.mockResolvedValue({});
    prismaMock.channelPublishItem.groupBy.mockResolvedValue([
      { status: "FAILED", _count: { _all: 1 } },
    ]);
    prismaMock.channelPublishJob.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...job, ...data }),
    );

    await processChannelPublishJob(job.id);

    expect(prismaMock.channelPublishItem.update).toHaveBeenCalledWith({
      where: { id: "item-ebay-error" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "eBay 오류 25709: Invalid value for header Accept-Language.",
      }),
    });
  });

  it("Shopify 옵션 후보를 개별 상품으로 신규 등록하지 않는다", async () => {
    variationCandidateIdsMock.mockResolvedValue(new Set(["p1"]));
    prismaMock.product.findMany.mockResolvedValue([{ id: "p1", sku: "SKU-1" }]);

    await expect(createChannelPublishJob({
      userId: "user-1",
      channel: "SHOPIFY",
      targetIds: ["p1"],
    })).rejects.toThrow("옵션상품 후보");
    expect(prismaMock.channelPublishJob.create).not.toHaveBeenCalled();
  });

  it.each([1,3])("가격·수량 항목을 최대 %i개 선점하고 실제 처리 건수를 기록한다", async (limit) => {
    const job = { id: "job-1", userId: "user-1", channel: "SHOPIFY", mode: "PRICE_INVENTORY", status: "QUEUED" };
    prismaMock.channelPublishJob.findUnique.mockResolvedValue(job);
    prismaMock.channelPublishJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishItem.findFirst
      .mockResolvedValueOnce({ id: "item-1", jobId: "job-1", targetId: "p1", attempts: 0 })
      .mockResolvedValueOnce(null);
    prismaMock.channelPublishItem.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.product.findUnique.mockResolvedValue({
      id: "p1",
      shopifyProductId: "100",
      shopifyVariantId: "200",
      shopifyInventoryItemId: "300",
      // Price holds must work even when publication/image approval is pending.
      shopifyStatus: "publication_pending",
    });
    syncShopifyMock.mockResolvedValue({
      productId: "100",
      variantId: "200",
      inventoryItemId: "300",
      status: "active",
    });
    prismaMock.channelPublishItem.update.mockResolvedValue({});
    prismaMock.product.update.mockResolvedValue({});
    prismaMock.channelPublishItem.groupBy.mockResolvedValue([
      { status: "COMPLETED", _count: { _all: 1 } },
    ]);
    prismaMock.channelPublishJob.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...job, ...data }),
    );

    const result = await processChannelPublishJob("job-1", limit);

    expect(prismaMock.channelPublishItem.findFirst).toHaveBeenCalledTimes(limit === 1 ? 1 : 2);
    const lease = prismaMock.channelPublishJob.updateMany.mock.calls[0][0].data.workerLeaseExpiresAt;
    expect(lease.getTime() - Date.now()).toBeGreaterThan(350_000);

    expect(syncShopifyMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.channelPublishItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: expect.objectContaining({ status: "COMPLETED", externalId: "100" }),
    });
    expect(result).toMatchObject({
      shouldContinue: false,
      job: { status: "COMPLETED", processedCount: 1, successCount: 1 },
    });
  });

  it("이미지 모드는 가격·재고 대신 Shopify 이미지 교체만 실행한다", async () => {
    const job = { id: "job-2", userId: "user-1", channel: "SHOPIFY", mode: "IMAGES", status: "QUEUED" };
    prismaMock.channelPublishJob.findUnique.mockResolvedValue(job);
    prismaMock.channelPublishJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishItem.findFirst
      .mockResolvedValueOnce({ id: "item-2", jobId: "job-2", targetId: "p1", attempts: 0 })
      .mockResolvedValueOnce(null);
    prismaMock.channelPublishItem.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.product.findUnique.mockResolvedValue({
      id: "p1",
      shopifyProductId: "100",
      shopifyVariantId: "200",
      shopifyInventoryItemId: "300",
    });
    syncShopifyImagesMock.mockResolvedValue({
      productId: "100",
      variantId: "200",
      inventoryItemId: "300",
      status: "active",
    });
    prismaMock.channelPublishItem.update.mockResolvedValue({});
    prismaMock.product.update.mockResolvedValue({});
    prismaMock.channelPublishItem.groupBy.mockResolvedValue([
      { status: "COMPLETED", _count: { _all: 1 } },
    ]);
    prismaMock.channelPublishJob.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...job, ...data }),
    );

    await processChannelPublishJob("job-2");

    expect(syncShopifyImagesMock).toHaveBeenCalledTimes(1);
    expect(syncShopifyMock).not.toHaveBeenCalled();
    expect(recordImageSyncMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.product.update.mock.calls[0][0].data).not.toHaveProperty("shopifyStatus");
  });

  it("판매중단 모드는 Shopify 상품을 삭제하지 않고 보관 처리한다", async () => {
    const job = { id: "job-archive", userId: "user-1", channel: "SHOPIFY", mode: "ARCHIVE", status: "QUEUED" };
    prismaMock.channelPublishJob.findUnique.mockResolvedValue(job);
    prismaMock.channelPublishJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishItem.findFirst
      .mockResolvedValueOnce({ id: "item-archive", jobId: job.id, targetId: "p1", attempts: 0 })
      .mockResolvedValueOnce(null);
    prismaMock.channelPublishItem.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.product.findUnique.mockResolvedValue({
      id: "p1",
      shopifyProductId: "100",
      shopifyVariantId: "200",
      shopifyInventoryItemId: "300",
    });
    archiveShopifyMock.mockResolvedValue({
      productId: "100",
      variantId: "200",
      inventoryItemId: "300",
      status: "archived",
    });
    prismaMock.channelPublishItem.update.mockResolvedValue({});
    prismaMock.product.update.mockResolvedValue({});
    prismaMock.channelPublishItem.groupBy.mockResolvedValue([
      { status: "COMPLETED", _count: { _all: 1 } },
    ]);
    prismaMock.channelPublishJob.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...job, ...data }),
    );

    await processChannelPublishJob(job.id);

    expect(archiveShopifyMock).toHaveBeenCalledTimes(1);
    expect(syncShopifyMock).not.toHaveBeenCalled();
    expect(uploadShopifyMock).not.toHaveBeenCalled();
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: expect.objectContaining({ shopifyStatus: "archived" }),
    });
  });

  it("다른 옵션이 판매 가능하면 Shopify 부모 상품 대신 해당 옵션 재고만 0으로 만든다", async () => {
    const job = { id: "job-option-end", userId: "user-1", channel: "SHOPIFY", mode: "ARCHIVE", status: "QUEUED" };
    prismaMock.channelPublishJob.findUnique.mockResolvedValue(job);
    prismaMock.channelPublishJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishItem.findFirst
      .mockResolvedValueOnce({ id: "item-option-end", jobId: job.id, targetId: "p1", attempts: 0 })
      .mockResolvedValueOnce(null);
    prismaMock.channelPublishItem.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.product.findUnique.mockResolvedValue({
      id: "p1", stockQuantity: 0, pocamarketAvailableCount: 0,
      shopifyProductId: "100", shopifyVariantId: "200", shopifyInventoryItemId: "300",
    });
    prismaMock.product.findFirst.mockResolvedValue({ id: "sellable-sibling" });
    syncShopifyMock.mockResolvedValue({
      productId: "100", variantId: "200", inventoryItemId: "300", status: "active",
    });
    prismaMock.channelPublishItem.update.mockResolvedValue({});
    prismaMock.product.update.mockResolvedValue({});
    prismaMock.channelPublishItem.groupBy.mockResolvedValue([
      { status: "COMPLETED", _count: { _all: 1 } },
    ]);
    prismaMock.channelPublishJob.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...job, ...data }),
    );

    await processChannelPublishJob(job.id);

    expect(syncShopifyMock).toHaveBeenCalledTimes(1);
    expect(archiveShopifyMock).not.toHaveBeenCalled();
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: expect.objectContaining({ shopifyStatus: "OUT_OF_STOCK" }),
    });
  });

  it("이미 실행 중인 작업에는 두 번째 실행기가 항목을 선점하지 않는다", async () => {
    const job = { id: "job-3", userId: "user-1", channel: "SHOPIFY", mode: "IMAGES", status: "RUNNING" };
    prismaMock.channelPublishJob.findUnique.mockResolvedValue(job);
    prismaMock.channelPublishJob.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await processChannelPublishJob("job-3");

    expect(result).toMatchObject({ busy: true, shouldContinue: false });
    expect(prismaMock.channelPublishItem.findFirst).not.toHaveBeenCalled();
  });
});
