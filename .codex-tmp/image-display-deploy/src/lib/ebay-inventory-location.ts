import "server-only";

import type { EbayAccount } from "@/generated/prisma";
import { EbayApiError } from "@/lib/ebay";
import {
  ebayApiRequest,
  getActiveEbayInventoryAccount,
} from "@/lib/services/ebayApiService";
import { syncPolicies } from "@/lib/services/ebayAccountService";
import { prisma } from "@/lib/prisma";

type LocationRecord = {
  merchantLocationKey?: string;
  merchantLocationStatus?: string;
  locationTypes?: string[];
  location?: {
    address?: {
      postalCode?: string;
      country?: string;
      city?: string;
      stateOrProvince?: string;
    };
  };
};

type CachedLocationRecord = {
  addressSummary?: string | null;
  rawJson?: unknown;
};

function locationsFromBody(body: unknown) {
  if (!body || typeof body !== "object") return [];
  const locations = (body as { locations?: unknown }).locations;
  return Array.isArray(locations) ? locations as LocationRecord[] : [];
}

export async function hasCachedActiveEbayInventoryLocation(userId: string) {
  const locations = await prisma.ebayInventoryLocationCache.findMany({
    where: { userId },
    select: { addressSummary: true, rawJson: true },
  });
  return locations.some(isUsableCachedEbayInventoryLocation);
}

export function isUsableCachedEbayInventoryLocation(location: CachedLocationRecord) {
  if (String(location.addressSummary ?? "ENABLED").toUpperCase() === "DISABLED") return false;
  if (!location.rawJson || typeof location.rawJson !== "object" || Array.isArray(location.rawJson)) {
    return false;
  }
  const raw = location.rawJson as Record<string, unknown>;
  const country = String(raw.country ?? "").trim();
  const city = String(raw.city ?? "").trim();
  const stateOrProvince = String(raw.stateOrProvince ?? "").trim();
  return Boolean(country && city && stateOrProvince);
}

async function updateKoreaWarehouseAddress(
  account: EbayAccount,
  merchantLocationKey: string,
  address: {
    postalCode: string;
    city: string;
    stateOrProvince: string;
  },
) {
  await ebayApiRequest(account, {
    method: "POST",
    path: `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}/update_location_details`,
    body: {
      name: "Korea Main Warehouse",
      locationTypes: ["WAREHOUSE"],
      location: {
        address: { ...address, country: "KR" },
      },
    },
  });
}

export async function ensureKoreaEbayInventoryLocation(
  userId: string,
  address: {
    postalCode: string;
    city: string;
    stateOrProvince: string;
  },
) {
  const account = await getActiveEbayInventoryAccount(userId);
  const current = await ebayApiRequest(account, {
    path: "/sell/inventory/v1/location",
  });
  const locations = locationsFromBody(current.body);
  const active = locations.find((location) =>
    String(location.merchantLocationStatus ?? "ENABLED").toUpperCase() === "ENABLED" &&
    (!location.locationTypes?.length || location.locationTypes.includes("WAREHOUSE")) &&
    String(location.location?.address?.country ?? "").toUpperCase() === "KR" &&
    String(location.location?.address?.postalCode ?? "").trim() === address.postalCode &&
    Boolean(String(location.location?.address?.city ?? "").trim()) &&
    Boolean(String(location.location?.address?.stateOrProvince ?? "").trim()),
  );
  if (active?.merchantLocationKey) {
    await updateKoreaWarehouseAddress(account, active.merchantLocationKey, address);
    await syncPolicies(userId);
    return { merchantLocationKey: active.merchantLocationKey, created: false };
  }

  // Older locations created with only country + postalCode can be returned as
  // enabled by eBay but still fail publishOffer with error 25012. Use a fresh
  // deterministic key so eBay creates a new physical location record with the
  // city and province present from the beginning.
  const merchantLocationKey = `kr-main-${address.postalCode}-full`;
  const existing = locations.find((location) =>
    location.merchantLocationKey === merchantLocationKey,
  );
  if (existing) {
    await ebayApiRequest(account, {
      method: "POST",
      path: `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}/enable`,
    });
    await updateKoreaWarehouseAddress(account, merchantLocationKey, address);
  } else {
    try {
      await ebayApiRequest(account, {
        method: "POST",
        path: `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`,
        body: {
          name: "Korea Main Warehouse",
          merchantLocationStatus: "ENABLED",
          locationTypes: ["WAREHOUSE"],
          location: {
            address: { ...address, country: "KR" },
          },
        },
      });
    } catch (error) {
      // 생성 성공 뒤 응답만 유실된 재시도라면 같은 키를 활성화해 복구한다.
      if (!(error instanceof EbayApiError) || error.status !== 409) throw error;
      await ebayApiRequest(account, {
        method: "POST",
        path: `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}/enable`,
      });
    }
  }

  const policies = await syncPolicies(userId);
  const confirmed = policies.inventoryLocations.find((location) =>
    location.id === merchantLocationKey &&
    String(location.status ?? "ENABLED").toUpperCase() !== "DISABLED" &&
    Boolean(location.country && location.city && location.stateOrProvince),
  );
  if (!confirmed) {
    throw new Error("eBay 재고 위치를 만들었지만 활성 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  return { merchantLocationKey, created: !existing };
}

export async function repairKoreaEbayInventoryLocation(
  account: EbayAccount,
  merchantLocationKey: string,
) {
  // A postcode alone cannot reconstruct the city/province that eBay uses as
  // Item.Location for international sellers. Do not repeat a publish request
  // after the old incomplete-location repair; the administrator must confirm
  // the complete warehouse region and create the replacement location first.
  void account;
  void merchantLocationKey;
  return false;
}
