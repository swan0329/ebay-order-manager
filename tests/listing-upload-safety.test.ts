import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/env",()=>({requiredEnv:()=>"test-secret"}));
vi.mock("@/lib/prisma",()=>({prisma:{}}));
vi.mock("@/lib/services/listingDraftService",()=>({validateDrafts:vi.fn()}));
const {issueListingPreviewToken,verifyListingPreviewToken}=await import("@/lib/services/listingUploadSafety");
describe("listing upload preview token",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("binds confirmation to the selected ids",()=>{const token=issueListingPreviewToken(["b","a"],1000);expect(verifyListingPreviewToken(token,["a","b"],1500)).toBe(true);expect(verifyListingPreviewToken(token,["a"],1500)).toBe(false)});
  it("expires after fifteen minutes",()=>{const token=issueListingPreviewToken(["a"],1000);expect(verifyListingPreviewToken(token,["a"],1000+16*60*1000)).toBe(false)});
});
