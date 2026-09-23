const fs=require('fs'),http=require('http'),assert=require('assert/strict'),esbuild=require('esbuild');
const {chromium}=require('./unit-ui-check/node_modules/playwright');
(async()=>{
 const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{UnitMembersClient}from'./src/components/UnitMembersClient';createRoot(document.getElementById('root')).render(<UnitMembersClient items={[{id:'a',sku:'A',brand:'BTS',productName:'Card A',category:null,imageUrl:'/photo.svg',searchImageUrl:'https://example.com/card.jpg'}]}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic'});
 const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].text)}if(req.url==='/photo.svg'){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="purple"/></svg>')}if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end('{"members":["Jin"]}')}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><style>::-webkit-scrollbar{width:17px;height:17px}[aria-label^="카드 확대 사진"]{height:650.5px;width:800px;overflow:auto}</style><div id="root"></div><script src="/bundle.js"></script></html>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{const page=await browser.newPage({viewport:{width:1400,height:1200}});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>document.querySelector('img')?.naturalWidth===200);
 const samples=await page.evaluate(async()=>{const sizes=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const e=document.querySelector('img');sizes.push(e.getBoundingClientRect().width)}return [...new Set(sizes)]});console.log({sizes:samples});assert.equal(samples.length,1,'image must remain stable on fractional viewport height'); }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});






