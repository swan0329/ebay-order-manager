export type ListingUploadStatus =
  | "unlisted"
  | "draft"
  | "uploaded"
  | "failed"
  | "needs_update";

export function listingUploadStatusLabel(status: ListingUploadStatus) {
  switch (status) {
    case "draft":
      return "draft 있음";
    case "uploaded":
      return "업로드 성공";
    case "failed":
      return "실패";
    case "needs_update":
      return "수정 필요";
    default:
      return "미등록";
  }
}

export function resolveInventoryListingUploadStatus(product: {
  listingStatus?: string | null;
  ebayItemId?: string | null;
  uploadError?: string | null;
  updatedAt?: Date | string | null;
  lastUploadedAt?: Date | string | null;
  listingDrafts?: Array<{ status: string; updatedAt?: Date | string | null }>;
  listingLinks?: Array<{
    listingStatus?: string | null;
    ebayItemId?: string | null;
    offerId?: string | null;
    lastUploadedAt?: Date | string | null;
  }>;
}): ListingUploadStatus {
  const drafts = product.listingDrafts ?? [];
  const links = product.listingLinks ?? [];
  const hasFailed =
    Boolean(product.uploadError) ||
    product.listingStatus === "FAILED" ||
    drafts.some((draft) => draft.status === "failed");

  if (hasFailed) {
    return "failed";
  }

  const hasDraft = drafts.some((draft) =>
    ["draft", "validated", "uploading"].includes(draft.status),
  );

  if (hasDraft) {
    return "draft";
  }

  const uploadedAt = product.lastUploadedAt
    ? new Date(product.lastUploadedAt).getTime()
    : Math.max(
        0,
        ...links
          .map((link) =>
            link.lastUploadedAt ? new Date(link.lastUploadedAt).getTime() : 0,
          )
          .filter(Number.isFinite),
      );
  const updatedAt = product.updatedAt ? new Date(product.updatedAt).getTime() : 0;
  const hasUploaded =
    Boolean(product.ebayItemId) ||
    product.listingStatus === "ACTIVE" ||
    links.some((link) => Boolean(link.ebayItemId || link.offerId));

  if (hasUploaded && uploadedAt && updatedAt > uploadedAt) {
    return "needs_update";
  }

  if (hasUploaded) {
    return "uploaded";
  }

  return "unlisted";
}
