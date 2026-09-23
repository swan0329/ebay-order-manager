import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rows: vi.fn(), receipts: vi.fn(), settings: vi.fn(), membership: vi.fn() }));
vi.mock("@/lib/variation-listing-products", () => ({ getEbayVariationMembershipByProductId: mocks.membership }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: mocks.rows, syncLog: { findMany: mocks.receipts } } }));
vi.mock("@/lib/variation-thumbnail-settings", () => ({ getListingImageSettings: mocks.settings }));
vi.mock("@/lib/ebay-watermarked-images", () => ({ listingWatermarkRenderVersion: "rounded-v13" }));
vi.mock("@/lib/variation-thumbnail", () => ({ variationThumbnailRenderVersion: "all-cards-v10" }));
import { channelImageFingerprint, getChannelImageChanges } from "./channel-image-changes";
const card = { id: "a", sku: "1", parent: "100", image: "approved.jpg", source: "lens_workbench", front: null, history: null, brand: "BTS", category: "WINGS", option: "Jin" };
beforeEach(() => { mocks.membership.mockResolvedValue(new Map()); mocks.rows.mockResolvedValue([card]); mocks.receipts.mockResolvedValue([]); mocks.settings.mockResolvedValue({ watermark: true }); });
it("includes historical listings without a delivery receipt even when prices did not change", async () => {
  expect(await getChannelImageChanges("u", "SHOPIFY")).toHaveLength(1);
});
it("excludes delivered images but requeues watermark or source changes", async () => {
  mocks.receipts.mockResolvedValue([{ rawJson: { parent: "100", fingerprint: channelImageFingerprint([card], { watermark: true }) } }]);
  expect(await getChannelImageChanges("u", "SHOPIFY")).toHaveLength(0);
  mocks.settings.mockResolvedValue({ watermark: false });
  expect(await getChannelImageChanges("u", "SHOPIFY")).toHaveLength(1);
  mocks.settings.mockResolvedValue({ watermark: true });
  mocks.rows.mockResolvedValue([{ ...card, image: "new-approved.jpg" }]);
  expect(await getChannelImageChanges("u", "SHOPIFY")).toHaveLength(1);
});
it("groups siblings once and notices a change to any member, independent of SQL ordering", async () => {
  const second = { ...card, id: "b", sku: "2" };
  expect(channelImageFingerprint([card, second], {})).toBe(channelImageFingerprint([second, card], {}));
  expect(channelImageFingerprint([card, second], {})).not.toBe(channelImageFingerprint([card, { ...second, image: "changed" }], {}));
  mocks.rows.mockResolvedValue([card, second]);
  expect(await getChannelImageChanges("u", "EBAY")).toHaveLength(1);
});
it("queues an audited mismatch despite an old matching receipt, and clears it after a later successful sync", async () => {
  const receipt={type:"CHANNEL_IMAGE_SYNC_SHOPIFY",rawJson:{parent:"100",fingerprint:channelImageFingerprint([card],{watermark:true})}};
  const review={type:"CHANNEL_IMAGE_REVIEW_SHOPIFY",rawJson:{parent:"100",reason:"wrong remote image"}};
  mocks.receipts.mockResolvedValue([review,receipt]);
  expect(await getChannelImageChanges("u","SHOPIFY")).toHaveLength(1);
  mocks.receipts.mockResolvedValue([receipt,review]);
  expect(await getChannelImageChanges("u","SHOPIFY")).toHaveLength(0);
});
it.each(['EBAY','SHOPIFY'] as const)('detects saved single and group watermark settings independently for %s',async(channel)=>{
 const base={watermarkEnabled:true,logoUrl:'logo-a.png',watermarkOpacity:0.04,watermarkLogoSize:290,watermarkGap:-33,variationWatermarkOpacity:0.04,variationWatermarkLogoSize:200,variationWatermarkGap:32};
 mocks.settings.mockResolvedValue(base);
 mocks.receipts.mockResolvedValue([{type:`CHANNEL_IMAGE_SYNC_${channel}`,rawJson:{parent:'100',fingerprint:channelImageFingerprint([card],base)}}]);
 expect(await getChannelImageChanges('u',channel)).toHaveLength(0);
 for(const patch of [{watermarkEnabled:false},{logoUrl:'logo-b.png'},{watermarkOpacity:0.1},{watermarkLogoSize:300},{watermarkGap:0},{variationWatermarkOpacity:0.1},{variationWatermarkLogoSize:220},{variationWatermarkGap:40}]){
  mocks.settings.mockResolvedValue({...base,...patch});
  expect(await getChannelImageChanges('u',channel)).toHaveLength(1);
 }
 mocks.settings.mockResolvedValue(base);
 expect(await getChannelImageChanges('u',channel)).toHaveLength(0);
});

it("uses the confirmed active variation parent instead of an obsolete single listing", async () => {
 mocks.membership.mockResolvedValue(new Map([["a", "active-group"], ["b", "active-group"]]));
 mocks.rows.mockResolvedValue([{ ...card, parent: "ended-single", eligible: false }, { ...card, id: "b", sku: "2", parent: "active-group" }]);
 expect(await getChannelImageChanges("u", "EBAY")).toEqual([expect.objectContaining({ parent: "active-group" })]);
 expect(await getChannelImageChanges("u", "EBAY", "ended-single")).toEqual([]);
});
