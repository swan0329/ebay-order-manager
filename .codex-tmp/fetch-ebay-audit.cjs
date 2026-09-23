const fs=require('fs'),{execFileSync}=require('child_process');const items=[];
const base='https://ebay-order-manager-au77xhmok-tngks2313-9711s-projects.vercel.app';
for(let page=1;page<=100;page++){
const s=execFileSync('curl.exe',['--silent','--show-error','--fail-with-body','--max-time','120','--header','@.codex-tmp/bts-request-headers.txt',base+'/api/admin/channel-price-audit?page='+page],{encoding:'utf8',maxBuffer:40*1024*1024});
const j=JSON.parse(s);if(!Array.isArray(j.items))throw Error('Missing items');items.push(...j.items);console.log(JSON.stringify({page,pagination:j.pagination,total:items.length}));
if(page>=Number(j.pagination?.TotalNumberOfPages||1)){fs.writeFileSync('.codex-tmp/channel-audit-ebay.json',JSON.stringify({observedAt:new Date().toISOString(),items},null,2));break;}if(page===100)throw Error('Truncated');}
