import { fetchPocamarketProductState, loadPocamarketApiConfig } from '../src/lib/pocamarket-api-collector';
import fs from 'node:fs';
process.loadEnvFile('.env');
(async()=>{const results=[];for(const sku of ['182895','191896']){try{results.push({sku,observedAt:new Date().toISOString(),...await fetchPocamarketProductState(sku,loadPocamarketApiConfig())});}catch(e){results.push({sku,error:e instanceof Error?e.message:'failed'});} }fs.writeFileSync('.codex-tmp/purchase-price-market.json',JSON.stringify(results));console.log(JSON.stringify(results));})();
