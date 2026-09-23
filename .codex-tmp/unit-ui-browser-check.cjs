const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');
const esbuild = require('esbuild');
const { chromium } = require('./unit-ui-check/node_modules/playwright');
(async()=>{
 const root=process.cwd();
 const bundle=await esbuild.build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {UnitMembersClient} from './src/components/UnitMembersClient'; createRoot(document.getElementById('root')).render(<UnitMembersClient items={[{id:'a',sku:'A',brand:'BTS',category:'Album',productName:'Card A',imageUrl:null},{id:'b',sku:'B',brand:'BTS',category:'Album',productName:'Card B',imageUrl:null}]}/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
 let saves=0,fail=true,documents=0;
 const server=http.createServer((req,res)=>{
  if(req.url==='/favicon.ico'){res.statusCode=204;res.end();return;}
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url.startsWith('/api/inventory/group-members')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({members:['RM','Jin','SUGA','J-Hope','Jimin','V','Jungkook']}));return;}
  if(req.url==='/api/inventory/featured-members'){let data='';req.on('data',s=>data+=s);req.on('end',()=>{saves++;setTimeout(()=>{res.setHeader('Content-Type','application/json');res.statusCode=fail?500:200;res.end(JSON.stringify(fail?{error:'Test save failure'}:{ok:true,featuredMembers:JSON.parse(data).members.join(', ')}));},250)});return;}
  documents++;res.setHeader('Content-Type','text/html');res.end('<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  page.on('pageerror',e=>console.log('pageError',e.message));
  page.setDefaultTimeout(10000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const jin=page.getByRole('button',{name:/2.*Jin/}); await jin.waitFor();
  await page.getByRole('button',{name:'전체 선택',exact:true}).click();await page.getByText(/Group OT7 Photocard/).waitFor();await page.getByRole('button',{name:'선택 해제',exact:true}).click();await jin.click(); await page.getByRole('button',{name:'다음에 지정',exact:true}).click();
  await page.getByRole('button',{name:'이전 카드',exact:true}).click();
  assert.equal(await jin.getAttribute('aria-pressed'),'true','draft must survive navigation');
  await page.getByRole('button',{name:'저장 후 다음 카드',exact:true}).click();
  await page.getByRole('alert').waitFor(); assert.equal(await jin.getAttribute('aria-pressed'),'true','failure must preserve selection');
  fail=false;
  await page.getByRole('button',{name:'저장 후 다음 카드',exact:true}).click();
  await page.getByRole('heading',{name:'Card B',exact:true}).waitFor();
  assert.equal(saves,2); assert.equal(documents,1,'save must not reload document');
  await page.getByRole('button',{name:'이번에 저장 (1)',exact:true}).click();
  await page.getByRole('heading',{name:'Card A',exact:true}).waitFor();
  assert.equal(await jin.getAttribute('aria-pressed'),'true','saved member must be available for correction');
  await page.getByRole('button',{name:'미지정 (1)',exact:true}).click();
  await page.getByRole('heading',{name:'Card B',exact:true}).waitFor();
  await page.keyboard.press('1');
  assert.equal(await page.getByRole('button',{name:/1.*RM/}).getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Control+Enter');
  await page.getByRole('heading',{name:'현재 목록의 유닛 멤버 지정이 완료됐습니다.',exact:true}).waitFor();
  assert.equal(saves,3);assert.equal(documents,1);
  console.log(JSON.stringify({passed:true,checks:['draft navigation','save failure preserves selection','save advances','no document reload','saved correction','keyboard selection/save','completion'],saveRequests:saves}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

