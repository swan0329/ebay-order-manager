import fs from 'node:fs';
import {fetchPocamarketProductState,loadPocamarketApiConfig} from '../src/lib/pocamarket-api-collector';
process.loadEnvFile('.env');
(async()=>{const out=[];for(const sku of ['296333','284272','284806','287832']){try{out.push({sku,observedAt:new Date().toISOString(),...await fetchPocamarketProductState(sku,loadPocamarketApiConfig())})}catch(e){out.push({sku,error:e instanceof Error?e.message:'failed'})}}fs.writeFileSync('.codex-tmp/order-four-market.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out))})();
