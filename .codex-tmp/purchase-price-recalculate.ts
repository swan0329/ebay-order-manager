import { calculateRecommendedPrice } from '../src/lib/pricing';
import fs from 'node:fs';
const s=JSON.parse(fs.readFileSync('.codex-tmp/purchase-price-settings.json','utf8')).settings;
const rows=[{sku:'182895',old:15000,actual:39000,listed:32.9},{sku:'191896',old:14000,actual:20000,listed:31.4}].map(p=>({sku:p.sku,storedPriceKrw:p.old,purchasedPriceKrw:p.actual,listedUsd:p.listed,recalculatedUsd:calculateRecommendedPrice({...s,pocaPriceKrw:p.actual}).recommendedPriceUsd.toString()}));fs.writeFileSync('.codex-tmp/purchase-price-recalculated.json',JSON.stringify(rows));console.log(JSON.stringify(rows));
