const fs=require('fs');
const path=require('path');
const root=path.resolve('outputs/image-review-2026-09-11');fs.mkdirSync(root,{recursive:true});
const snapshot=JSON.parse(fs.readFileSync('.codex-tmp/bulk-images-shopify-before.json'));
async function dataUrl(url){const r=await fetch(url);if(!r.ok)throw Error('Image HTTP '+r.status);return 'data:image/jpeg;base64,'+Buffer.from(await r.arrayBuffer()).toString('base64');}
(async()=>{const samples=[];
for(const [sku,label] of [['15131','첨부 사진 · J-Hope'],['12764','첨부 사진 · Jimin'],['12294','길쭉한 카드'],['101214','일반 세로 카드'],['4625','짧고 넓은 카드'],['13236','가로형 카드']]){
const product=snapshot.products.find(p=>p.variants.nodes.some(v=>v.sku===sku)),v=product.variants.nodes.find(v=>v.sku===sku);v.image ||= product.media.nodes.find(m=>m.image)?.image;const next=JSON.parse(fs.readFileSync('.codex-tmp/compare-'+sku+'.json'));
samples.push({sku,label,title:product.title,before:await dataUrl(v.image.url),after:await dataUrl(next.imageUrls[0]),size:`${v.image.width} × ${v.image.height}`,newSize:'960 × 1200'});
}
const group=snapshot.products.find(p=>p.variants.nodes.some(v=>v.sku==='13236'));
const next=JSON.parse(fs.readFileSync('.codex-tmp/compare-wings.json'));
if(!next.dataUrl)throw Error(next.error||'No group preview');
samples.push({sku:'WINGS · 6장',label:'묶음 대표 썸네일',title:group.title,before:await dataUrl(group.media.nodes[0].image.url),after:next.dataUrl,size:`${group.media.nodes[0].image.width} × ${group.media.nodes[0].image.height}`,newSize:'1000 × 1000'});
const sharp=require('sharp');
const decode=s=>Buffer.from(s.split(',')[1],'base64');
const oldPair=await Promise.all(samples.slice(0,2).map(s=>sharp(decode(s.before)).resize({width:600}).png().toBuffer()));
const oldMeta=await Promise.all(oldPair.map(b=>sharp(b).metadata()));
const beforePair=await sharp({create:{width:1200,height:Math.max(...oldMeta.map(m=>m.height)),channels:3,background:'white'}}).composite(oldPair.map((input,i)=>({input,left:i*600,top:0}))).jpeg().toBuffer();
const newPair=await Promise.all(samples.slice(0,2).map(s=>sharp(decode(s.after)).resize({height:600}).png().toBuffer()));
const afterPair=await sharp({create:{width:976,height:600,channels:3,background:'white'}}).composite(newPair.map((input,i)=>({input,left:i*496,top:0}))).jpeg().toBuffer();
fs.writeFileSync(path.join(root,'attached-pair-portrait.jpg'),afterPair);
samples.unshift({sku:'15131 / 12764',label:'첨부한 두 상품 나란히',title:'같은 높이·같은 여백 / 카드 비율 유지',before:'data:image/jpeg;base64,'+beforePair.toString('base64'),after:'data:image/jpeg;base64,'+afterPair.toString('base64'),size:'기존 이미지 폭을 동일하게 맞춘 비교',newSize:'두 이미지 모두 960 × 1200'});
const template=fs.readFileSync('.codex-tmp/image-review-template.html','utf8');fs.writeFileSync(path.join(root,'index.html'),template.replace('/*SAMPLES*/[]',JSON.stringify(samples).replace(/</g,'\\u003c')));
fs.writeFileSync(path.join(root,'wings-preview.jpg'),Buffer.from(next.dataUrl.split(',')[1],'base64'));
console.log({file:path.join(root,'index.html'),samples:samples.length});})().catch(e=>{console.error(e.message);process.exitCode=1});
