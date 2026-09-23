const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');
const esbuild = require('esbuild');
const {chromium} = require('./unit-ui-check/node_modules/playwright');
(async () => {
 const root = process.cwd();
 const bundle = await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChannelAutomaticOperations} from './src/components/EbayAutomaticOperations';import {ChannelRegistrationControls} from './src/components/ChannelRegistrationControls';import {ChannelOperationCounts} from './src/components/ChannelOperationCounts';createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl space-y-4 p-5"><h1 className="text-xl font-bold">판매채널 자동 반영</h1><ChannelOperationCounts/><ChannelAutomaticOperations/><ChannelRegistrationControls/></main>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},plugins:[{name:'router',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'const router={refresh(){}};export const useRouter=()=>router;'}));}}]});
 const css=fs.readdirSync('.next/static/css').filter(x=>x.endsWith('.css')).map(x=>fs.readFileSync('.next/static/css/'+x,'utf8')).join('\n');
 const writes=[];let previewIndex=0;let registrationJob=null;let imageJob=null;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
  if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  if(req.method!=='GET'){let data='';req.on('data',x=>data+=x);req.on('end',()=>{const body=JSON.parse(data||'{}');writes.push({path:url.pathname,body});if(url.pathname==='/api/products/publish'){registrationJob={id:'registration-test',channel:body.channel,status:'RUNNING',totalCount:2,processedCount:0,successCount:0,failureCount:0,items:[]};res.end(JSON.stringify({job:registrationJob,selectedProductCount:1}));}else if(url.pathname==='/api/channel-publishing/changes'){imageJob={id:'images-test',channel:body.channel,status:'RUNNING',totalCount:2,processedCount:0,successCount:0,failureCount:0,items:[]};res.end(JSON.stringify({imageJob}));}else res.end('{}');});return;}
  if(url.pathname==='/api/products/channel-operation-counts'){res.end(JSON.stringify({ebay:{register:164,revise:12,end:0,revisePrice:8,reviseQuantity:4,reviseUnverified:0},shopify:{register:168,revise:6,end:0},images:{ebay:214,shopify:210},imageJobs:[]}));return;}
  if(url.pathname==='/api/products/publish-preview'){if(url.searchParams.get('random')==='1')previewIndex++;const sku=String(10000+previewIndex);res.end(JSON.stringify({target:{productId:'id-'+sku,sku,title:'BTS Official Photocard · UI 검증용 상품',grouped:false,memberIds:['id-'+sku],members:[{id:'id-'+sku,sku,label:'Jin',imageUrl:null,ebayRegistered:false,shopifyRegistered:false}]}}));return;}
  if(url.pathname==='/api/channel-publish-jobs'){res.end(JSON.stringify(url.searchParams.has('jobId')?{job:registrationJob??imageJob}:{jobs:[]}));return;}
  if(url.pathname==='/api/ebay/inventory-location'){res.end('{"ready":true}');return;}
  if(url.pathname.startsWith('/api/')){res.end('{}');return;}
  res.setHeader('Content-Type','text/html');res.end('<html lang="ko"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',e.message)});page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:'+server.address().port);
  const registration=page.locator('details').filter({has:page.locator(':scope > summary').filter({hasText:'시험등록·신규등록'})}).first();
  await page.getByLabel('변동처리 상품번호').fill('101214, 15131\n101214 15369_15372');
  await page.getByText('현재 입력한 3개 상품만 변동처리합니다.',{exact:true}).waitFor();
  await page.locator('summary').filter({hasText:'기존 상품 변동처리'}).click();
  await page.locator('summary').filter({hasText:'기존 상품 변동처리'}).click();
  assert.equal(await page.getByLabel('변동처리 상품번호').inputValue(),'101214, 15131\n101214 15369_15372');
  await page.getByLabel('자동 반영 채널').selectOption('EBAY');await page.getByRole('button',{name:'변동처리 시작',exact:true}).click();
  await page.getByText('eBay 변동처리',{exact:true}).waitFor();
  assert.deepEqual(writes[0].body,{channel:'EBAY',skus:['101214','15131','15369_15372']});
  await page.locator('summary').filter({hasText:'기존 상품 변동처리'}).click();assert.equal(await page.getByText('eBay 변동처리',{exact:true}).isVisible(),true);
  await registration.locator(':scope > summary').click();
  await page.getByRole('button',{name:'여러 상품 신규등록',exact:true}).click();await page.getByLabel('등록 작업 수').fill('25');await registration.locator(':scope > summary').click();await registration.locator(':scope > summary').click();assert.equal(await page.getByLabel('등록 작업 수').inputValue(),'25');
  await page.getByRole('button',{name:'1개 시험등록',exact:true}).click();await page.getByLabel('상품 등록 채널').selectOption('EBAY');
  await page.getByRole('button',{name:'다른 상품 랜덤 선택',exact:true}).click();await page.getByText(/선택 SKU 10001/).waitFor();
  await page.getByRole('button',{name:'사진·옵션 펼치기',exact:true}).click();await page.getByText('Jin · 10001',{exact:true}).waitFor();
  await page.screenshot({path:'.codex-tmp/channel-ui-expanded.png',fullPage:true});
  await page.getByRole('button',{name:'이 대상으로 시험등록',exact:true}).click();await page.getByRole('button',{name:'등록 중단',exact:true}).waitFor();
  assert.deepEqual(writes[1].body,{channel:'EBAY',productIds:['id-10001'],expectedOptionProductIds:['id-10001'],confirmed:true});
  await registration.locator(':scope > summary').click();assert.equal(await page.getByRole('button',{name:'등록 중단',exact:true}).isVisible(),true);assert.equal(await page.getByLabel('eBay 등록 진행률').isVisible(),true);
  await page.screenshot({path:'.codex-tmp/channel-ui-collapsed.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.codex-tmp/channel-ui-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['SKU parsing and request preserved','collapse preserves input','image progress outside collapse','trial and bulk switching','random target matches submitted ID','preview expansion','registration progress and cancel remain visible','mobile no page overflow'],mockWrites:writes.length,externalWrites:0}));
 }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
