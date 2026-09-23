import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  ebayApiRequest: vi.fn(),
  getActiveEbayInventoryAccount: vi.fn(),
  syncPolicies: vi.fn(),
}));

vi.mock("@/lib/services/ebayApiService", () => ({
  ebayApiRequest: mocks.ebayApiRequest,
  getActiveEbayInventoryAccount: mocks.getActiveEbayInventoryAccount,
}));
vi.mock("@/lib/services/ebayAccountService", () => ({
  syncPolicies: mocks.syncPolicies,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { ebayInventoryLocationCache: { findMany: vi.fn() } },
}));

import {
  ensureKoreaEbayInventoryLocation,
  isUsableCachedEbayInventoryLocation,
  repairKoreaEbayInventoryLocation,
} from "@/lib/ebay-inventory-location";

const address = {
  postalCode: "06236",
  city: "Seoul",
  stateOrProvince: "Seoul",
};

describe("eBay inventory location setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveEbayInventoryAccount.mockResolvedValue({ id: "account" });
  });

  it("creates an enabled Korean warehouse with the confirmed postal code", async () => {
    mocks.ebayApiRequest
      .mockResolvedValueOnce({ body: { locations: [] } })
      .mockResolvedValueOnce({ body: null, status: 204 });
    mocks.syncPolicies.mockResolvedValue({
      inventoryLocations: [{
        id: "kr-main-06236-full",
        status: "ENABLED",
        country: "KR",
        city: "Seoul",
        stateOrProvince: "Seoul",
      }],
    });

    await expect(ensureKoreaEbayInventoryLocation("user", address)).resolves.toEqual({
      merchantLocationKey: "kr-main-06236-full",
      created: true,
    });
    expect(mocks.ebayApiRequest).toHaveBeenNthCalledWith(
      2,
      { id: "account" },
      expect.objectContaining({
        method: "POST",
        path: "/sell/inventory/v1/location/kr-main-06236-full",
        body: expect.objectContaining({
          location: { address: { ...address, country: "KR" } },
          locationTypes: ["WAREHOUSE"],
        }),
      }),
    );
  });

  it("reuses an existing enabled location without creating another one", async () => {
    mocks.ebayApiRequest
      .mockResolvedValueOnce({
        body: {
          locations: [{
            merchantLocationKey: "existing",
            merchantLocationStatus: "ENABLED",
            locationTypes: ["WAREHOUSE"],
            location: { address: { ...address, country: "KR" } },
          }],
        },
      })
      .mockResolvedValueOnce({ body: null, status: 204 });
    mocks.syncPolicies.mockResolvedValue({ inventoryLocations: [] });

    await expect(ensureKoreaEbayInventoryLocation("user", address)).resolves.toEqual({
      merchantLocationKey: "existing",
      created: false,
    });
    expect(mocks.ebayApiRequest).toHaveBeenNthCalledWith(
      2,
      { id: "account" },
      expect.objectContaining({
        path: "/sell/inventory/v1/location/existing/update_location_details",
        body: expect.objectContaining({
          location: { address: { ...address, country: "KR" } },
        }),
      }),
    );
  });

  it("treats an enabled cached location without a physical address as unusable", () => {
    expect(isUsableCachedEbayInventoryLocation({
      addressSummary: "ENABLED",
      rawJson: { id: "missing-address", status: "ENABLED" },
    })).toBe(false);
    expect(isUsableCachedEbayInventoryLocation({
      addressSummary: "ENABLED",
      rawJson: { id: "ready", status: "ENABLED", postalCode: "06236", country: "KR" },
    })).toBe(false);
    expect(isUsableCachedEbayInventoryLocation({
      addressSummary: "ENABLED",
      rawJson: {
        id: "ready",
        status: "ENABLED",
        postalCode: "06236",
        country: "KR",
        city: "Seoul",
        stateOrProvince: "Seoul",
      },
    })).toBe(true);
  });

  it("does not retry an incomplete warehouse using only a postcode inferred from its key", async () => {
    await expect(repairKoreaEbayInventoryLocation(
      { id: "account" } as never,
      "kr-main-06236",
    )).resolves.toBe(false);
    expect(mocks.ebayApiRequest).not.toHaveBeenCalled();
  });

  it("does not guess an address for an unrelated location key", async () => {
    await expect(repairKoreaEbayInventoryLocation(
      { id: "account" } as never,
      "warehouse",
    )).resolves.toBe(false);
    expect(mocks.ebayApiRequest).not.toHaveBeenCalled();
  });
});
