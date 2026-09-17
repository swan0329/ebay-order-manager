export const productDataChangedEvent = "ebay-manager:product-data-changed";

export function notifyProductDataChanged() {
  window.dispatchEvent(new Event(productDataChangedEvent));
}
