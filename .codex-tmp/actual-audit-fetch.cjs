const fs=require('fs'),{execFileSync}=require('child_process');
const base='https://ebay-order-manager-lake.vercel.app/api/channel-publishing/image-audit';
const read=url=>JSON.parse(execFileSync('curl.exe',['-sS','--fail-with-body','--max-time','150','-H','@.codex-tmp/bts-request-headers.txt',url],{encoding:'utf8',maxBuffer:40*1024*1024}));
const local=read(base);fs.writeFileSync('.codex-tmp/actual-local-audit.json',JSON.stringify(local));
const list=read(base+'?channel=EBAY');fs.writeFileSync('.codex-tmp/actual-ebay-list.json',JSON.stringify(list));
console.log({local:local.local.length,ebay:list.items.length,pendingEbay:local.pending.EBAY.length,pendingShopify:local.pending.SHOPIFY.length});
const out=[];
for(let i=0;i<list.items.length;i+=10){
 const ids=list.items.slice(i,i+10).map(p=>p.ItemID);
 try{const d=read(base+'?channel=EBAY&items='+ids.join(','));out.push(...d.items);}
 catch{for(const id of ids){try{out.push(...read(base+'?channel=EBAY&items='+id).items);}catch{out.push({ItemID:id,auditError:'GetItem 조회 실패'});}}}
 fs.writeFileSync('.codex-tmp/actual-ebay-details.json',JSON.stringify({items:out}));
 console.log('eBay details',out.length,'/',list.items.length);
}
