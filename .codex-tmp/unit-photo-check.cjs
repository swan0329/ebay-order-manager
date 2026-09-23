const fs=require('fs'),http=require('http'),assert=require('assert/strict'),esbuild=require('esbuild');
const {chromium}=require('./unit-ui-check/node_modules/playwright');
(async()=>{
 const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{UnitMembersClient}from'./src/components/UnitMembersClient';createRoot(document.getElementById('root')).render(<UnitMembersClient items={[{id:'a',sku:'A',brand:'BTS',productName:'Card A',category:null,imageUrl:'/photo.svg',searchImageUrl:'https://example.com/card.jpg'}]}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic'});
 const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text)}if(req.url==='/photo.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="purple"/></svg>')}if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end('{"members":["Jin"]}')}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><style>[aria-label^="카드 확대 사진"]{height:650px;width:800px;overflow:auto}</style><div id="root"></div><script src="/bundle.js"></script></html>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{const page=await browser.newPage({viewport:{width:1400,height:1200}});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth===200);
 const img=page.locator('img');await page.getByRole('button',{name:'사진 오른쪽으로 회전',exact:true}).click();await page.waitForFunction(()=>document.querySelector('img').style.transform.includes('90deg'));const rect=await img.boundingBox();assert.ok(rect.width>rect.height);assert.ok(rect.width<=801&&rect.height<=651);
 await page.getByRole('button',{name:'사진 확대',exact:true}).click();await page.waitForTimeout(100);const box=page.getByRole('generic',{name:'카드 확대 사진, 확대 후 드래그 또는 스크롤로 이동'});await page.locator('[aria-label^="카드 확대 사진"]').scrollIntoViewIfNeeded();const area=await page.locator('[aria-label^="카드 확대 사진"]').boundingBox();console.log(area,await page.locator('[aria-label^="카드 확대 사진"]').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,cursor:e.style.cursor})));await page.mouse.move(area.x+400,area.y+300);await page.mouse.down();await page.mouse.move(area.x+100,area.y+200);await page.mouse.up();assert.ok(await page.locator('[aria-label^="카드 확대 사진"]').evaluate(e=>e.scrollLeft>0));
 await page.getByRole('button',{name:'사진 크기와 회전 초기화',exact:true}).click();assert.ok((await img.getAttribute('style')).includes('rotate(0deg)'));
 assert.equal(await page.getByRole('link',{name:'구글 사진으로 검색'}).getAttribute('href'),'https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fexample.com%2Fcard.jpg');
 console.log(JSON.stringify({passed:true,checks:['90 degree fit','zoom drag pan','reset rotation','public Google Lens URL']}));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});




