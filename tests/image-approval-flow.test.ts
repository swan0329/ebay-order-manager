import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: { id: "worker-1", role: "WORKER" as "WORKER" | "ADMIN" },
  productFind: vi.fn(),
  productUpdate: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  upload: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: mocks.productFind,
      update: mocks.productUpdate,
    },
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/r2", () => ({
  uploadBufferToR2: mocks.upload,
  getObjectFromR2: mocks.getObject,
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => mocks.currentUser),
  requireApiUser: vi.fn(async () => ({ id: "admin-1", role: "ADMIN" })),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/image-work-assignments", () => ({
  workerCanAccessProduct: vi.fn(async () => true),
  ensureImageWorkAssignments: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser.id = "worker-1";
  mocks.currentUser.role = "WORKER";
  mocks.productFind.mockResolvedValue({
    id: "product-1",
    sku: "SKU-1",
    ebayImageUrls: ["https://images.example/original.jpg"],
  });
  mocks.queryRaw.mockResolvedValue([{ id: "assignment-1" }]);
  mocks.executeRaw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (work: unknown) => {
    if (Array.isArray(work)) return Promise.all(work);
    throw new Error("unexpected interactive transaction");
  });
  mocks.upload.mockResolvedValue({
    key: "image-work-reviews/SKU-1/result.jpg",
    url: "https://images.example/review.jpg",
  });
});

describe("작업자 이미지 제출", () => {
  it("사람 승인 전에는 상품 이미지를 변경하지 않고 검수 결과만 저장한다", async () => {
    const jpeg = await sharp({
      create: {
        width: 32,
        height: 48,
        channels: 3,
        background: "white",
      },
    })
      .jpeg()
      .toBuffer();
    const { POST } = await import(
      "@/app/api/products/[id]/image-workbench/route"
    );
    const response = await POST(
      new Request("http://localhost/api/products/product-1/image-workbench", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
        }),
      }),
      { params: Promise.resolve({ id: "product-1" }) },
    );
    const body = (await response.json()) as { previewOnly?: boolean };

    expect(response.status).toBe(200);
    expect(body.previewOnly).toBe(true);
    expect(mocks.upload.mock.calls[0][0].key).toContain(
      "image-work-reviews/",
    );
    expect(mocks.productUpdate).not.toHaveBeenCalled();
  });
});

describe("관리자 이미지 검수", () => {
  it("승인 요청에서만 최종 상품 이미지를 변경한다", async () => {
    mocks.queryRaw.mockResolvedValue([
      {
        id: "assignment-1",
        productId: "product-1",
        status: "submitted",
        resultUrl: "https://images.example/review.jpg",
        resultKey: "image-work-reviews/SKU-1/result.jpg",
        sku: "SKU-1",
        imageUrl: "https://images.example/original.jpg",
        urls: ["https://images.example/original.jpg"],
      },
    ]);
    mocks.getObject.mockResolvedValue({
      buffer: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    });
    mocks.upload.mockResolvedValue({
      key: "products/SKU-1/final.jpg",
      url: "https://images.example/final.jpg",
    });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ status: "submitted" }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      product: { update: vi.fn().mockResolvedValue({}) },
    };
    mocks.transaction.mockImplementation(async (work: unknown) => {
      if (typeof work !== "function") throw new Error("expected callback");
      return (work as (client: typeof tx) => unknown)(tx);
    });
    const { POST } = await import("@/app/api/image-reviews/route");
    const response = await POST(
      new Request("http://localhost/api/image-reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignmentId: "assignment-1",
          action: "approve",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(tx.product.update).toHaveBeenCalledOnce();
    expect(tx.product.update.mock.calls[0][0].data.imageUrl).toBe(
      "https://images.example/final.jpg",
    );
    expect(mocks.upload.mock.calls[0][0].key).toContain("products/SKU-1/");
  });

  it("반려는 상품 이미지와 최종 R2 객체를 변경하지 않는다", async () => {
    mocks.queryRaw.mockResolvedValue([
      {
        id: "assignment-1",
        productId: "product-1",
        status: "submitted",
        resultUrl: "https://images.example/review.jpg",
        resultKey: "image-work-reviews/SKU-1/result.jpg",
        sku: "SKU-1",
        imageUrl: "https://images.example/original.jpg",
        urls: ["https://images.example/original.jpg"],
      },
    ]);
    const { POST } = await import("@/app/api/image-reviews/route");
    const response = await POST(
      new Request("http://localhost/api/image-reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignmentId: "assignment-1",
          action: "reject",
          rejectionCode: "border_damage",
          reason: "오른쪽 테두리가 번졌습니다.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.productUpdate).not.toHaveBeenCalled();
  });

  it("이미 승인된 요청을 재시도해도 다시 업로드하거나 변경하지 않는다", async () => {
    mocks.queryRaw.mockResolvedValue([
      {
        id: "assignment-1",
        productId: "product-1",
        status: "approved",
        resultUrl: "https://images.example/review.jpg",
        resultKey: "image-work-reviews/SKU-1/result.jpg",
        sku: "SKU-1",
        imageUrl: "https://images.example/final.jpg",
        urls: ["https://images.example/final.jpg"],
      },
    ]);
    const { POST } = await import("@/app/api/image-reviews/route");
    const response = await POST(
      new Request("http://localhost/api/image-reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignmentId: "assignment-1",
          action: "approve",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.productUpdate).not.toHaveBeenCalled();
  });
});
