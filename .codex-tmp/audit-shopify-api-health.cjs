const { loadEnvConfig } = require('@next/env');
const fs = require('node:fs');
loadEnvConfig(process.cwd());
async function main() {
  const e = process.env;
  const domain = e.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  let token = e.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) {
    const r = await fetch(`https://${domain}/admin/oauth/access_token`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:e.SHOPIFY_CLIENT_ID,client_secret:e.SHOPIFY_CLIENT_SECRET,grant_type:'client_credentials'})});
    const j = await r.json(); token=j.access_token;
    if (!token) throw new Error(`Authentication HTTP ${r.status}`);
  }

  const r=await fetch('https://'+domain+'/admin/api/'+(e.SHOPIFY_API_VERSION||'2025-10')+'/deprecated_api_calls.json',{headers:{'X-Shopify-Access-Token':token}});
  const body=await r.json();
  console.log(JSON.stringify({httpStatus:r.status,apiVersion:r.headers.get('x-shopify-api-version'),report:body}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
