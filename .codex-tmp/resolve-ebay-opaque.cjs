const fs=require('fs'),sharp=require('sharp'),d=require('./actual-ebay-findings.json'),remote=require('./actual-ebay-details.json'),local=require('./actual-local-audit.json');
const list=x=>x===undefined?[]:Array.isArray(x)?x:[x];
(async()=>{const remaining=[];const candidates=d.unknown.filter(x=>x.reason.includes('변환 URL'));let done=0;
for(let offset=0;offset<candidates.length;offset+=5)await Promise.all(candidates.slice(offset,offset+5).map(async x=>{
 try{const p=remote.items.find(p=>p.ItemID===x.parent),url=list(p.PictureDetails?.PictureURL)[0];const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('fetch failed');const bytes=Buffer.from(await response.arrayBuffer());const m=await sharp(bytes).metadata();const product=local.local.find(p=>p.ebayItemId===x.parent);if(!product||!m.width||!m.height)throw Error('missing dimensions');
  if(Math.abs(m.width/m.height-0.8)>0.005){d.findings.push({channel:'EBAY',parent:x.parent,title:p.Title,skus:[product.sku],productId:product.id,reason:`실제 이미지 ${m.width}×${m.height}, 현재 개별 규격 960×1200과 비율 불일치`,observedUrls:[url],alreadyPending:local.pending.EBAY.some(t=>t.parent===x.parent)});}
  else remaining.push({...x,reason:`이미지 비율은 현재와 같으나 원본 URL이 없어 동일 제작본인지 확인 불가 (${m.width}×${m.height})`});
 }catch{remaining.push({...x,reason:'이미지 파일 조회 또는 연결 확인 실패'});}done++;console.log('eBay image dimensions',done,'/',candidates.length);
}));
d.unknown=[...d.unknown.filter(x=>!x.reason.includes('변환 URL')),...remaining];fs.writeFileSync('.codex-tmp/actual-ebay-findings.json',JSON.stringify(d,null,2));console.log({flagged:d.findings.length,unknown:d.unknown.length});})();
