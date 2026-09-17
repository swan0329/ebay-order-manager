type ProductDisplayImage = {
  id: string;
  userImageRegistered: boolean;
  imageUpdatedAt?: string | null;
  imageSource: string | null;
  imageUrl: string | null;
  sourceImageUrl: string | null;
};

export function productDisplayImageUrl(product: ProductDisplayImage) {
  if (product.userImageRegistered) {
    const timestamp = product.imageUpdatedAt ? new Date(product.imageUpdatedAt).getTime() : NaN;
    const query = Number.isFinite(timestamp) ? `?t=${timestamp}` : "";
    return `/api/products/image-match/assets/${product.id}/front${query}`;
  }
  if (product.imageSource === "lens_workbench" && product.imageUrl?.trim()) {
    return product.imageUrl;
  }
  return product.sourceImageUrl || product.imageUrl;
}

export function productDisplayImageLabel(product: ProductDisplayImage) {
  if (product.userImageRegistered) return "직접 촬영";
  if (product.imageSource === "lens_workbench" && product.imageUrl?.trim()) return "Lens 작업";
  return "포카마켓";
}
