const fs=require('fs');const local=require('./actual-local-audit.json');const remote=require('./bulk-images-shopify-actual-audit.json');
const result=[];const unknown=[];let excluded=0,checked=0;
for(const p of remote.products.filter(p=>p.status==='ACTIVE')){
 if(p.variants.nodes.some(v=>v.sku==='101214')){excluded++;continue;}checked++;
 const parent=p.id.split('/').pop(),reasons=new Set(),members=[];
 const media=p.media.nodes,group=p.variants.nodes.length>1;
 if(!media.length)reasons.add('판매 갤러리 이미지 없음');
 for(const v of p.variants.nodes){
  const product=local.local.find(x=>x.sku===v.sku&&x.shopifyProductId===parent&&x.shopifyVariantId===v.id.split('/').pop());
  if(!product?.expectedHash){unknown.push({channel:'SHOPIFY',parent,sku:v.sku,reason:'내부 연결 또는 승인 원본 확인 필요'});continue;}
  members.push(product);
  const img=group?v.image:media[0]?.image;
  if(!img)reasons.add('옵션 이미지 연결 누락');
  else{
   if(!img.url.includes(product.expectedHash))reasons.add('현재 승인 원본·제작 설정과 등록 이미지 파일 불일치');
   if(img.width!==960||img.height!==1200)reasons.add('개별 이미지 구형 규격(960×1200 아님)');
  }
 }
 if(group&&(!media[0]?.image||media[0].image.width!==1000||media[0].image.height!==1000))reasons.add('묶음 대표 썸네일 규격 불일치');
 if(!group&&media.length>1)reasons.add('단품 갤러리에 승인 기본 이미지 외 추가 이미지 잔존');
 if(reasons.size&&members.length===p.variants.nodes.length)result.push({channel:'SHOPIFY',parent,title:p.title,skus:members.map(p=>p.sku),productId:members[0].id,reason:[...reasons].join('; '),observedUrls:media.map(m=>m.image?.url).filter(Boolean),alreadyPending:local.pending.SHOPIFY.some(t=>t.parent===parent)});
 else if(reasons.size)unknown.push({channel:'SHOPIFY',parent,reason:'옵션 전체 연결 불일치로 자동 대상으로 지정하지 않음'});
}
fs.writeFileSync('.codex-tmp/actual-shopify-findings.json',JSON.stringify({checked,excluded,findings:result,unknown},null,2));
console.log({checked,excluded,flagged:result.length,alreadyPending:result.filter(x=>x.alreadyPending).length,unknown:unknown.length});
