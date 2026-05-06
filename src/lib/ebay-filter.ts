export type OrderSyncFilters = {
  creationDateFrom?: string;
  creationDateTo?: string;
  modifiedDateFrom?: string;
  modifiedDateTo?: string;
  fulfillmentStatus?: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED" | "OPEN";
};

export function buildOrderFilter(filters: OrderSyncFilters) {
  const criteria: string[] = [];

  if (filters.creationDateFrom || filters.creationDateTo) {
    criteria.push(
      `creationdate:[${filters.creationDateFrom ?? ""}..${filters.creationDateTo ?? ""}]`,
    );
  } else if (filters.modifiedDateFrom || filters.modifiedDateTo) {
    criteria.push(
      `lastmodifieddate:[${filters.modifiedDateFrom ?? ""}..${filters.modifiedDateTo ?? ""}]`,
    );
  }

  if (filters.fulfillmentStatus && filters.fulfillmentStatus !== "OPEN") {
    criteria.push(`orderfulfillmentstatus:{${filters.fulfillmentStatus}}`);
  }

  if (filters.fulfillmentStatus === "OPEN") {
    criteria.push("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}");
  }

  return criteria.join(",");
}
