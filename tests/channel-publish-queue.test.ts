import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  listingDraft: { findMany: vi.fn(), findFirst: vi.fn() },
  product: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  pricingSettings: { findUnique: vi.fn() },
  channelPublishJob: {
    create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
    updateMany: vi.fn(), update: vi.fn(),
  },
  channelPublishItem: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
  $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/channel-image-changes", () => ({ getChannelImageChanges: vi.fn(), recordChannelImageSync: vi.fn() }));
vi.mock("@/lib/ebay-image-repair", () => ({ repairEbayImages: vi.fn() }));
vi.mock("@/lib/services/shopifyService", () => ({
  archiveShopifyProduct: vi.fn(), syncShopifyImages: vi.fn(), syncShopifyPriceAndInventory: vi.fn(),
  uploadProductToShopify: vi.fn(), uploadVariationGroupToShopify: vi.fn(), publishExistingShopifyProduct: vi.fn(),
}));
vi.mock("@/lib/services/ebayListingUploadService", () => ({ uploadDraft: vi.fn() }));
vi.mock("@/lib/services/listingDraftService", () => ({ createDraftsFromInventory: vi.fn() }));
vi.mock("@/lib/ebay-variation-publish", () => ({ publishEbayVariationGroup: vi.fn() }));
vi.mock("@/lib/ebay-active-report-task", () => ({ requestEbayActiveReport: vi.fn() }));
vi.mock("@/lib/procurement-refresh", () => ({ refreshProcurementProduct: vi.fn() }));
vi.mock("@/lib/variation-listing-products", () => ({
  getVariationCandidateProductIds: vi.fn(() => Promise.resolve(new Set<string>())),
  getEbayVariationMembershipByProductId: vi.fn(() => Promise.resolve(new Map())),
  getVariationListingGroups: vi.fn(() => Promise.resolve([])),
}));

import { Prisma } from "@/generated/prisma";
import { createChannelPublishJob, processChannelPublishJob } from "@/lib/channel-publish-jobs";
import { WAITING_STATUS } from "@/lib/channel-publish-constants";

const conflict = () =>
  new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6" });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.channelPublishJob.findMany.mockResolvedValue([]);
  prismaMock.product.findMany.mockResolvedValue([
    { id: "p1", sku: "SKU-1", shopifyProductId: "100" },
    { id: "p2", sku: "SKU-2", shopifyProductId: "200" },
  ]);
});

describe("진행 중 작업이 있을 때", () => {
  it("다른 대상 요청을 거절하지 않고 줄을 세운다", async () => {
    // 첫 create는 activeKey 충돌로 거부되고, 진행 중 작업은 다른 대상을 들고 있다.
    prismaMock.channelPublishJob.create
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce({ id: "queued-1", status: WAITING_STATUS, activeKey: null, items: [] });
    prismaMock.channelPublishJob.findUnique.mockResolvedValue({
      id: "running-1", status: "RUNNING", channel: "SHOPIFY", mode: "PRICE_INVENTORY",
      items: [{ targetType: "PRODUCT", targetId: "other", status: "QUEUED" }],
    });

    const job = await createChannelPublishJob({
      userId: "user-1", channel: "SHOPIFY", mode: "PRICE_INVENTORY", targetIds: ["p1", "p2"],
    });

    expect(job.status).toBe(WAITING_STATUS);
    // 줄 선 작업은 실행 권리를 쥐지 않는다. 그래야 동시에 돌지 않는다.
    expect(prismaMock.channelPublishJob.create.mock.calls[1][0].data.activeKey).toBeNull();
  });

  it("같은 대상이 이미 줄을 서 있으면 또 세우지 않는다", async () => {
    prismaMock.channelPublishJob.create.mockRejectedValueOnce(conflict());
    prismaMock.channelPublishJob.findUnique.mockResolvedValue({
      id: "running-1", status: "RUNNING", channel: "SHOPIFY", mode: "PRICE_INVENTORY",
      items: [{ targetType: "PRODUCT", targetId: "other", status: "QUEUED" }],
    });
    prismaMock.channelPublishJob.findMany.mockResolvedValue([
      { id: "queued-1", status: WAITING_STATUS, items: [
        { targetType: "PRODUCT", targetId: "p1" }, { targetType: "PRODUCT", targetId: "p2" },
      ] },
    ]);

    const job = await createChannelPublishJob({
      userId: "user-1", channel: "SHOPIFY", mode: "PRICE_INVENTORY", targetIds: ["p1", "p2"],
    });

    expect(job.id).toBe("queued-1");
    expect(prismaMock.channelPublishJob.create).toHaveBeenCalledTimes(1);
  });

  it("줄이 한도를 넘으면 그때는 알려 준다", async () => {
    prismaMock.channelPublishJob.create.mockRejectedValueOnce(conflict());
    prismaMock.channelPublishJob.findUnique.mockResolvedValue({
      id: "running-1", status: "RUNNING", channel: "SHOPIFY", mode: "PRICE_INVENTORY",
      items: [{ targetType: "PRODUCT", targetId: "other", status: "QUEUED" }],
    });
    prismaMock.channelPublishJob.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({ id: `q${index}`, items: [{ targetType: "PRODUCT", targetId: `x${index}` }] })),
    );

    await expect(createChannelPublishJob({
      userId: "user-1", channel: "SHOPIFY", mode: "PRICE_INVENTORY", targetIds: ["p1", "p2"],
    })).rejects.toThrow("대기 중입니다");
  });
});

describe("차례가 오기 전에는 실행하지 않는다", () => {
  it("실행 권리를 못 잡으면 아무 항목도 처리하지 않는다", async () => {
    prismaMock.channelPublishJob.findUnique.mockResolvedValue({
      id: "queued-1", userId: "user-1", channel: "SHOPIFY", mode: "PRICE_INVENTORY",
      status: WAITING_STATUS, activeKey: null,
    });
    prismaMock.channelPublishJob.update.mockRejectedValueOnce(conflict());

    const result = await processChannelPublishJob("queued-1");

    expect(result.busy).toBe(true);
    expect(prismaMock.channelPublishItem.findFirst).not.toHaveBeenCalled();
  });

  it("앞 작업이 끝나 권리를 잡으면 실행 상태로 올라간다", async () => {
    prismaMock.channelPublishJob.findUnique
      .mockResolvedValueOnce({
        id: "queued-1", userId: "user-1", channel: "SHOPIFY", mode: "PRICE_INVENTORY",
        status: WAITING_STATUS, activeKey: null,
      })
      .mockResolvedValue({ status: "RUNNING" });
    prismaMock.channelPublishJob.update.mockResolvedValue({ id: "queued-1" });
    prismaMock.channelPublishJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.channelPublishItem.findFirst.mockResolvedValue(null);
    prismaMock.channelPublishItem.groupBy.mockResolvedValue([]);
    prismaMock.channelPublishJob.findFirst.mockResolvedValue(null);

    const result = await processChannelPublishJob("queued-1");

    expect(result.busy).toBe(false);
    expect(prismaMock.channelPublishJob.update).toHaveBeenCalledWith({
      where: { id: "queued-1" },
      data: { activeKey: "user-1:SHOPIFY:PRICE_INVENTORY", status: "QUEUED" },
    });
  });
});
