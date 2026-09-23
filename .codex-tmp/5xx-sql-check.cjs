const fs = require('node:fs');
const { PGlite } = require('./sql-check/node_modules/@electric-sql/pglite');
(async()=>{
const db = new PGlite();
await db.exec(`CREATE TABLE products (id text, stock_quantity int, user_front_image_url text, image_source text, ebay_item_id text, shopify_product_id text, listing_status text, shopify_status text, option_name text, featured_members text, sale_price numeric, final_listing_price_usd numeric, pocamarket_available_count int, pocamarket_synced_at timestamptz);
CREATE TABLE variation_listing_states (ebay_item_id text, included_product_ids jsonb);
INSERT INTO products SELECT 'p'||n, n%3, CASE WHEN n%5=0 THEN 'photo' END, CASE WHEN n%2=0 THEN 'lens_workbench' ELSE 'pocamarket' END, CASE WHEN n%7=0 THEN 'item'||n END, CASE WHEN n%11=0 THEN 'shop'||n END, CASE WHEN n%13=0 THEN 'OUT_OF_STOCK' WHEN n%17=0 THEN 'ENDED' ELSE 'ACTIVE' END, CASE WHEN n%19=0 THEN 'ARCHIVED' ELSE 'ACTIVE' END, CASE WHEN n%8=0 THEN 'unit' ELSE 'member' END, CASE WHEN n%9=0 THEN 'a,b' END, CASE WHEN n%4=0 THEN 10000 END, CASE WHEN n%6=0 THEN 10 END, n%4, CASE WHEN n%10<>0 THEN now() END FROM generate_series(1,3000) n;
INSERT INTO variation_listing_states SELECT 'variation'||g,jsonb_agg('p'||n) FROM generate_series(1,100) g CROSS JOIN LATERAL generate_series(g*20,g*20+19) n GROUP BY g;
INSERT INTO variation_listing_states VALUES (NULL,'["p2999"]'),('','["p2998"]'),('duplicate','["p20","p20",null]'),('empty','[]'),('null',null);`);
const ops=fs.readFileSync('src/lib/product-operations.ts','utf8');
const extract=(name)=>ops.match(new RegExp('export const '+name+' = `([\\s\\S]*?)`;'))[1];
const oldRegistered=`((COALESCE("ebay_item_id", '') <> '' AND UPPER(COALESCE("listing_status", 'ACTIVE')) NOT IN ('ENDED','INACTIVE','FAILED','OUT_OF_STOCK')) OR (UPPER(COALESCE("listing_status", '')) <> 'OUT_OF_STOCK' AND EXISTS (SELECT 1 FROM "variation_listing_states" variation_state WHERE COALESCE(variation_state."ebay_item_id", '') <> '' AND variation_state."included_product_ids"::jsonb ? "products"."id")))`;
const tpl=fs.readFileSync('src/lib/product-stats.ts','utf8').match(/const \[row\] = await prisma\.\$queryRaw<ProductStats\[\]>`([\s\S]*?)`;/)[1];
let report=[];
for(const channel of ['EBAY','SHOPIFY']){
 const vars={imageReady:extract('imageReadySql'),registrationCondition:extract(channel==='EBAY'?'registeredSql':'shopifyRegisteredSql'),registered:'"isRegistered"',channelProductId:channel==='EBAY'?'"ebay_item_id"':'"shopify_product_id"',priceMissing:extract('priceMissingSql'),supply:'("stock_quantity" > 0 OR COALESCE("pocamarket_available_count", 0) > 0)'};
 const expand=(sql,v)=>sql.replace(/\$\{(\w+)\}/g,(_,key)=>v[key]);
 const original=tpl.slice(tpl.indexOf('    SELECT\n      COUNT')).replace('FROM stats_products','FROM "products"');
 let start=performance.now();let before=await db.query(expand(original,{...vars,registered:channel==='EBAY'?oldRegistered:vars.registrationCondition}));let oldMs=performance.now()-start;
 start=performance.now();let after=await db.query(expand(tpl,vars));let newMs=performance.now()-start;
 if(JSON.stringify(before.rows)!==JSON.stringify(after.rows))throw new Error(channel+' count mismatch');
 report.push({channel,products:3000,allCountsEqual:true,oldMs:Math.round(oldMs),newMs:Math.round(newMs)});
}
await db.close();fs.writeFileSync('.codex-tmp/5xx-sql-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exit(1)});
