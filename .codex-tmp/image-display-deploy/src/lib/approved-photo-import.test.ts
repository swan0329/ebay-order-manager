import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),transaction:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{$transaction:mocks.transaction}}));
vi.mock("@/lib/r2",()=>({buildPublicR2Url:(key:string)=>`https://images.example/${key}`}));
import { approvedPhotoImportSchema, importApprovedPhotos } from "./approved-photo-import";
const sha256="a".repeat(64);
const url=`https://images.example/products/bts-approved-photos/${sha256}.jpg`;
const input={confirmed:true as const,dryRun:false,rows:[{sku:"123",sha256,fileName:"123.jpg",expectedImageUrl:"https://old.example/123.jpg"}]};
const product={id:"p1",sku:"123",imageUrl:input.rows[0].expectedImageUrl,imageSource:"pocamarket",sourceImageUrl:null,ebayImageUrls:[],stockQuantity:2};
describe("approved photo import",()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.transaction.mockImplementation(fn=>fn({$queryRaw:mocks.query,$executeRaw:mocks.execute}));mocks.query.mockResolvedValueOnce([product]).mockResolvedValue([]);});
 it("requires explicit approval and keeps literal composite SKUs",()=>{
  expect(approvedPhotoImportSchema.safeParse({...input,confirmed:false}).success).toBe(false);
  expect(approvedPhotoImportSchema.parse({...input,rows:[{...input.rows[0],sku:"123_456",fileName:"123_456.jpg"}]}).rows[0].sku).toBe("123_456");
 });
 it("does not write in preview",async()=>{
  expect(await importApprovedPhotos({...input,dryRun:true},"admin")).toMatchObject({updated:0,candidates:1});
  expect(mocks.execute).not.toHaveBeenCalled();
 });
 it("skips completed links without duplicate approval history",async()=>{
  mocks.query.mockReset().mockResolvedValue([{...product,imageUrl:url,imageSource:"lens_workbench",ebayImageUrls:[url]}]);
  expect(await importApprovedPhotos(input,"admin")).toMatchObject({updated:0,skipped:1});
  expect(mocks.execute).not.toHaveBeenCalled();
 });
 it("rejects a changed image before writing",async()=>{
  mocks.query.mockReset().mockResolvedValue([{...product,imageUrl:"https://new.example/123.jpg"}]);
  await expect(importApprovedPhotos(input,"admin")).rejects.toThrow("Image changed");
  expect(mocks.execute).not.toHaveBeenCalled();
 });
 it("does not race a processing AI job",async()=>{
  mocks.query.mockReset().mockResolvedValueOnce([product]).mockResolvedValueOnce([{id:"j",status:"processing"}]);
  await expect(importApprovedPhotos(input,"admin")).rejects.toThrow("still processing");
  expect(mocks.execute).not.toHaveBeenCalled();
 });
 it("atomically sets image completion and history without altering stock",async()=>{
  expect(await importApprovedPhotos(input,"admin")).toMatchObject({updated:1});
  const sql=mocks.execute.mock.calls.map(call=>call[0].join("?")).join("\n");
  expect(sql).toContain("'lens_workbench'");
  expect(sql).toContain('"product_image_history"');
  expect(sql).not.toContain('"stock_quantity"');
  expect(sql).not.toContain("inventory_movements");
  expect(mocks.transaction).toHaveBeenCalledOnce();
 });
});
