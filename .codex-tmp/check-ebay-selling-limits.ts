import { loadEnvConfig } from '@next/env';
import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
loadEnvConfig(process.cwd());
Object.assign(process.env, parseEnv(readFileSync('.codex-tmp/vercel-production.env', 'utf8')));
async function main() {
  const { prisma } = await import('../src/lib/prisma');
  try {
    const accounts = await prisma.ebayAccount.findMany({ where: { environment: 'production' } });
    if (accounts.length !== 1) throw new Error(`Account selection required (${accounts.length})`);
    const { getValidAccessToken } = await import('../src/lib/ebay');
    const token = await getValidAccessToken(accounts[0]);
    const response = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type':'text/xml', 'X-EBAY-API-CALL-NAME':'GetMyeBaySelling', 'X-EBAY-API-SITEID':'0', 'X-EBAY-API-COMPATIBILITY-LEVEL':'1423', 'X-EBAY-API-IAF-TOKEN':token },
      body:'<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><SellingSummary><Include>true</Include></SellingSummary><ActiveList><Include>false</Include></ActiveList><SoldList><Include>false</Include></SoldList><UnsoldList><Include>false</Include></UnsoldList></GetMyeBaySellingRequest>',
    });
    const parsed = new XMLParser({ ignoreAttributes:false }).parse(await response.text()).GetMyeBaySellingResponse;
    console.log(JSON.stringify({httpStatus:response.status,ack:parsed?.Ack,summary:parsed?.Summary,errorCodes:[parsed?.Errors].flat().filter(Boolean).map(e=>({code:e.ErrorCode,message:e.ShortMessage}))},null,2));
  } finally { await prisma.$disconnect(); }
}
main().catch(e=>{ console.error(e.message); process.exitCode=1; });
