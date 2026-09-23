import {loadEnvConfig} from '@next/env';
import fs from 'node:fs';
import {fetchPocamarketProductState,loadPocamarketApiConfig} from '../src/lib/pocamarket-api-collector';
loadEnvConfig(process.cwd());
async function main(){
 const config=loadPocamarketApiConfig();
 const state=await fetchPocamarketProductState('82804',config);
 fs.writeFileSync('.codex-tmp/price-source-probe.json',JSON.stringify({sku:'82804',state,observedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify({sku:'82804',state}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
