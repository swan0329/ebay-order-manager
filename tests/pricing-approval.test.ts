import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  transaction: vi.fn(),
  reviewItemFind: vi.fn(),
  draftFind: vi.fn(),
  draftUpdate: vi.fn(),
  itemUpdate: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireApiUser: vi.fn(async () => ({ id: "admin-1", role: "ADMIN" })),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    pricingReview: { updateMany: mocks.updateMany },
    $transaction: mocks.transaction,
  },
}));

import { POST as approve } from "@/app/api/pricing/reviews/[id]/approve/route";
import { POST as apply } from "@/app/api/pricing/reviews/items/[itemId]/apply/route";

describe("pricing recommendation approval boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback) => callback({
      pricingReviewItem: { findUnique: mocks.reviewItemFind, update: mocks.itemUpdate },
      listingDraft: { findFirst: mocks.draftFind, update: mocks.draftUpdate },
    }));
  });

  it("approval changes only review state and does not touch upload draft price", async () => {
    const response = await approve(
      new Request("http://local", { method: "POST", body: JSON.stringify({ confirmed: true }) }),
      { params: Promise.resolve({ id: "review-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "review-1", status: "DRAFT" },
    }));
    expect(mocks.draftUpdate).not.toHaveBeenCalled();
  });

  it("does not approve without explicit confirmation", async () => {
    const response = await approve(
      new Request("http://local", { method: "POST", body: JSON.stringify({ confirmed: false }) }),
      { params: Promise.resolve({ id: "review-1" }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not apply a calculated but unapproved recommendation", async () => {
    mocks.reviewItemFind.mockResolvedValue({ id: "item-1", productId: "product-1", review: { status: "DRAFT" } });
    const response = await apply(
      new Request("http://local", { method: "POST", body: JSON.stringify({ confirmed: true, draftId: "draft-1" }) }),
      { params: Promise.resolve({ itemId: "item-1" }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.draftUpdate).not.toHaveBeenCalled();
  });

  it("copies an approved snapshot only after an explicit apply action", async () => {
    mocks.reviewItemFind.mockResolvedValue({ id: "item-1", productId: "product-1", recommendedPriceUsd: "15.90", appliedDraftId: null, review: { status: "APPROVED" } });
    mocks.draftFind.mockResolvedValue({ id: "draft-1", fieldSourceJson: {}, sourceInventoryId: "product-1" });
    const response = await apply(
      new Request("http://local", { method: "POST", body: JSON.stringify({ confirmed: true, draftId: "draft-1" }) }),
      { params: Promise.resolve({ itemId: "item-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.draftUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "draft-1" },
      data: expect.objectContaining({ price: "15.90" }),
    }));
    expect(mocks.itemUpdate).toHaveBeenCalled();
  });
});
