const { loadEnvConfig } = require('@next/env');
const fs = require('node:fs');
loadEnvConfig(process.cwd());
async function main() {
  const e = process.env;
  const domain = e.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  let token;
  if (!token) {
    const r = await fetch(`https://${domain}/admin/oauth/access_token`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:e.SHOPIFY_CLIENT_ID,client_secret:e.SHOPIFY_CLIENT_SECRET,grant_type:'client_credentials'})});
    const j = await r.json(); token=j.access_token;
    if (!token) throw new Error(`Authentication HTTP ${r.status}`);
  }
  const r = await fetch(`https://${domain}/admin/api/${e.SHOPIFY_API_VERSION || '2025-10'}/graphql.json`, {method:'POST',headers:{'content-type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query:'query { products(first:250) { pageInfo { hasNextPage endCursor } nodes { id title descriptionHtml status handle publishedAt variants(first:100) { nodes { id sku image { url } } } media(first:100) { nodes { id status ... on MediaImage { image { url } } } } } } }'})});
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(JSON.stringify(j.errors));
  console.log(JSON.stringify(j));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});








