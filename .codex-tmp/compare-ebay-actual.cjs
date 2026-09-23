const fs=require('fs'),local=require('./actual-local-audit.json'),remote=require('./actual-ebay-details.json'),all=require('./actual-ebay-list.json');
const list=x=>x===undefined?[]:Array.isArray(x)?x:[x];
const urls=p=>[...list(p?.PictureURL),...list(p?.ExternalPictureURL),...list(p?.ExtendedPictureDetails).flatMap(x=>list(x.ExternalPictureURL))].filter(x=>typeof x==='string');
const out=[],unknown=[];let excluded=0,checked=0;
if(remote.items.length!==all.items.length||new Set(remote.items.map(p=>p.ItemID)).size!==all.items.length)throw Error('Incomplete eBay snapshot');
for(const p of remote.items){
 const variants=list(p.Variations?.Variation);
 if(p.SKU==='101214'||variants.some(v=>v.SKU==='101214')){excluded++;continue;}checked++;
 if(p.auditError){unknown.push({parent:p.ItemID,reason:p.auditError});continue;}
 const members=variants.length?variants.map(v=>local.local.find(x=>x.sku===v.SKU&&x.ebayItemId===p.ItemID)):[local.local.find(x=>x.ebayItemId===p.ItemID&&(!p.SKU||x.sku===p.SKU))];
 if(members.some(x=>!x?.expectedHash)){unknown.push({parent:p.ItemID,title:p.Title,skus:variants.length?variants.map(v=>v.SKU):[p.SKU],reason:'채널 연결 또는 승인 원본 확인 필요'});continue;}
 const reasons=new Set(),observed=[...urls(p.PictureDetails)];
 if(!observed.length)reasons.add('대표 이미지 없음');
 if(variants.length){
  const sets=list(p.Variations.Pictures);
  for(let i=0;i<variants.length;i++){
   const v=variants[i],specifics=list(v.VariationSpecifics?.NameValueList);
   const pic=sets.flatMap(s=>list(s.VariationSpecificPictureSet).filter(z=>specifics.some(n=>n.Name===s.VariationSpecificName&&list(n.Value).includes(z.VariationSpecificValue))));
   const u=pic.flatMap(urls);observed.push(...u);
   if(!u.length)reasons.add('옵션 이미지 연결 누락');
   else if(!u.some(url=>url.includes(members[i].expectedHash)))reasons.add('옵션 이미지가 현재 승인 원본·제작 설정과 불일치');
  }
 }else if(!observed.some(url=>url.includes(members[0].expectedHash)))reasons.add('단품 이미지가 현재 승인 원본·제작 설정과 불일치');
 if(reasons.size&&!observed.some(url=>!url.includes('ebayimg.com'))){unknown.push({parent:p.ItemID,title:p.Title,reason:'eBay 변환 URL만 있어 원본 대조 추가 확인 필요'});continue;}
 if(reasons.size)out.push({channel:'EBAY',parent:p.ItemID,title:p.Title,skus:members.map(m=>m.sku),productId:members[0].id,reason:[...reasons].join('; '),observedUrls:[...new Set(observed)].slice(0,250),alreadyPending:local.pending.EBAY.some(t=>t.parent===p.ItemID)});
}
fs.writeFileSync('.codex-tmp/actual-ebay-findings.json',JSON.stringify({checked,excluded,findings:out,unknown},null,2));console.log({checked,excluded,flagged:out.length,alreadyPending:out.filter(x=>x.alreadyPending).length,unknown});
