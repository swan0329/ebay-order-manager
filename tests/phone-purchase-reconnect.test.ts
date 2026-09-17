import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
it("prepares only one remaining unit using saved progress, then waits for human confirmation", async()=>{
 const code=readFileSync("scripts/pocamarket-bridge.mjs","utf8");
 const processCode=code.slice(code.indexOf("async function processJob("),code.indexOf("const randomDelay"));
 const purchase=vi.fn().mockResolvedValue(undefined);
 const processJob=new Function("purchaseOne",processCode+";return processJob;")(purchase);
 await processJob("device",{requestedQuantity:3,purchasedQuantity:2});
 expect(purchase).toHaveBeenCalledTimes(1);expect(purchase.mock.calls[0][2]).toBe(2);
 await processJob("device",{requestedQuantity:3,purchasedQuantity:3});expect(purchase).toHaveBeenCalledTimes(1);
});
