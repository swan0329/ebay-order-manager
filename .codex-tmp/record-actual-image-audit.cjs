const fs=require('fs'),{execFileSync}=require('child_process');
const url='https://ebay-order-manager-lake.vercel.app/api/channel-publishing/image-audit';
const call=(file)=>JSON.parse(execFileSync('curl.exe',['-sS','--fail-with-body','--max-time','150','-H','@.codex-tmp/bts-request-headers.txt',...(file?['-H','Content-Type: application/json','--data-binary','@'+file]:[]),url],{encoding:'utf8',maxBuffer:30*1024*1024}));
const fresh=call();const results=[];
for(const channel of ['SHOPIFY','EBAY']){
 const data=JSON.parse(fs.readFileSync('.codex-tmp/actual-'+channel.toLowerCase()+'-findings.json'));
 const skipped=data.findings.filter(x=>x.alreadyPending&&!fresh.pending[channel].some(t=>t.parent===x.parent));
 const targets=data.findings.filter(x=>!skipped.includes(x));
 if(targets.some(x=>x.skus.includes('101214')))throw Error('Excluded product present');
 let flagged=0;
 for(let i=0;i<targets.length;i+=30){const entries=targets.slice(i,i+30).map(({parent,reason,observedUrls})=>({parent,reason,observedUrls}));const path='.codex-tmp/actual-flag-'+channel+'-'+i+'.json';fs.writeFileSync(path,JSON.stringify({channel,entries}));const r=call(path);flagged+=r.flagged;console.log({channel,flagged,total:targets.length});}
 results.push({channel,checked:data.checked,excluded:data.excluded,flagged,skippedAfterNewSync:skipped.map(x=>x.parent),unknown:data.unknown,targets});
}
const final=call();for(const r of results)for(const t of r.targets)if(!final.pending[r.channel].some(x=>x.parent===t.parent))throw Error('Flag did not enter pending list '+t.parent);
fs.writeFileSync('.codex-tmp/actual-audit-recorded.json',JSON.stringify({at:new Date(),results,pendingCounts:{EBAY:final.pending.EBAY.length,SHOPIFY:final.pending.SHOPIFY.length}},null,2));
fs.mkdirSync('outputs',{recursive:true});
let md='# 판매 이미지 대조 점검 — 변동 대상 기록\n\n101214는 제외했습니다. 외부 판매 이미지·가격·재고를 변경하지 않았습니다. 실제 채널의 갤러리·옵션 이미지 URL 및 Shopify 이미지 크기를 현재 승인 원본과 제작 설정의 식별값에 대조했습니다. 모든 카드 내용을 사람처럼 육안 판독했다는 뜻은 아닙니다.\n';
for(const r of results){md+=`\n## ${r.channel}\n\n점검 ${r.checked}개 판매상품 / 변동 대상으로 기록 ${r.flagged}개 / 연결·대조 확인 필요 ${r.unknown.length}개.\n\n| 판매상품 ID | 상품번호 | 사유 |\n|---|---|---|\n`;for(const t of r.targets)md+=`| ${t.parent} | ${t.skus.join(', ')} | ${t.reason.replaceAll('|','/')} |\n`;if(r.unknown.length)md+='\n추가 확인 필요:\n\n'+r.unknown.map(x=>`- ${x.parent}: ${x.reason}`).join('\n')+'\n';}
fs.writeFileSync('outputs/actual-image-audit-2026-09-11.md',md);
console.log('Verified all recorded targets are pending.');
