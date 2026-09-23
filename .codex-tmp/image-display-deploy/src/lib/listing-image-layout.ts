/** Shared by the browser preview and channel renderer. Never crop a card. */
export const LISTING_IMAGE_SIZE = 1200;
export const LISTING_IMAGE_WIDTH = 800;
export const listingImageCornerRadius = (width: number, height: number) => Math.max(1, Math.round(Math.min(width, height) * 0.045));
export const portraitRotation = (width: number, height: number) => width > height ? 90 : 0;
export function listingImageBox(settings: { imageZoom?: number; backgroundPadding?: number; paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number }, eligible: boolean, size = LISTING_IMAGE_SIZE) {
  // Source type controls background decoration, never the displayed card size.
  void eligible;
  const zoom = 1 + Math.max(0, Math.min(100, settings.imageZoom ?? 0)) / 100;
  const outputWidth = LISTING_IMAGE_WIDTH * size / LISTING_IMAGE_SIZE;
  const padding = (value: number | undefined, dimension: number) => Math.round(Math.max(20, Math.min(300, value ?? settings.backgroundPadding ?? 80)) / zoom * dimension / 1000);
  const left = padding(settings.paddingLeft, outputWidth), top = padding(settings.paddingTop, size);
  return { left, top, width: Math.max(1, Math.round(outputWidth) - left - padding(settings.paddingRight, outputWidth)), height: Math.max(1, size - top - padding(settings.paddingBottom, size)) };
}
