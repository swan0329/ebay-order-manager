import fs from 'node:fs';
import {loadEnvConfig} from '@next/env';
import {fetchPocamarketProductState,loadPocamarketApiConfig,PocamarketBlockingError} from '../src/lib/pocamarket-api-collector';
loadEnvConfig(process.cwd());
const path=(n:string)=>'.codex-tmp/incident-all-'+n+'.json';
const read=(n:string)=>fs.existsSync(path(n))?JSON.parse(fs.readFileSync(path(n),'utf8')):[];
const config=loadPocamarketApiConfig();
const done=new Set<string>(); const rows:any[]=[];let stop=false;
const save=()=>fs.writeFileSync(path('source'),JSON.stringify({rows,stopped:stop}));
async function worker(){while(!stop){const p=[...read('products'),...read('products-extra')].find((p:any)=>p.pocamarketId&&!done.has(p.id));
 if(!p){if(fs.existsSync(path('product-coverage'))&&fs.existsSync(path('extra-coverage')))return;await new Promise(r=>setTimeout(r,2000));continue;}
 done.add(p.id);
 try{const state=await fetchPocamarketProductState(p.pocamarketId,config);rows.push({id:p.id,sku:p.sku,pocamarketId:p.pocamarketId,...state,observedAt:new Date().toISOString()});}
 catch(e){rows.push({id:p.id,sku:p.sku,error:e instanceof Error?e.message:'read failed'});if(e instanceof PocamarketBlockingError)stop=true;}
 save();if(rows.length%50===0)console.log('source checked',rows.length);
 await new Promise(r=>setTimeout(r,Math.max(1000,config.minDelayMs)));
}}
Promise.all([worker(),worker()]).then(()=>{save();console.log('source finished',rows.length,'stopped',stop)}).catch(e=>{console.error(e.message);process.exitCode=1});
