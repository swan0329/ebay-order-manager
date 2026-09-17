import { expect, it, vi } from "vitest";
const db=vi.hoisted(()=>({$queryRaw:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:db}));
vi.mock("@/lib/pocamarket-purchases",()=>({validBridgeToken:()=>true,ensurePocamarketPurchaseJobs:vi.fn()}));
import { GET } from "@/app/api/pocamarket-bridge/jobs/route";
it("only claims queued work when no payment is active and returns preserved progress",async()=>{
 db.$queryRaw.mockResolvedValue([{id:"one",purchasedQuantity:2,requestedQuantity:3}]);
 const response=await GET(new Request("http://local/api?device=phone"));
 expect((await response.json()).job.purchasedQuantity).toBe(2);
 const sql=db.$queryRaw.mock.calls[0][0].join("?");
 expect(sql).toContain('WHERE "status" = \'queued\'');
 expect(sql).toContain("NOT EXISTS");
 expect(sql).toContain("'running', 'purchasing', 'awaiting_confirmation'");
 expect(sql).toContain('j."purchased_quantity" AS "purchasedQuantity"');
});
