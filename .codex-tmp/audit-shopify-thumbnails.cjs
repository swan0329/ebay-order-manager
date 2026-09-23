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
  const r = await fetch(`https://${domain}/admin/api/${e.SHOPIFY_API_VERSION || '2025-10'}/graphql.json`, {method:'POST',headers:{'content-type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query:'query { products(first: 250, sortKey: CREATED_AT, reverse: true) { nodes { id title onlineStoreUrl createdAt featuredMedia { ... on MediaImage { image { url } } } variants(first: 2) { nodes { sku } } media(first: 3) { nodes { ... on MediaImage { image { url } } } } } } }'})});
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(`Product read failed HTTP ${r.status}`);
  fs.writeFileSync('.codex-tmp/shopify-thumbnail-audit.json', JSON.stringify(j.data.products.nodes,null,2));
  console.log(JSON.stringify(j.data.products.nodes.filter(p=>p.variants.nodes.length > 1).slice(0,12).map(p=>({id:p.id,title:p.title,url:p.onlineStoreUrl,image:p.featuredMedia?.image?.url,skus:p.variants.nodes.map(v=>v.sku)})),null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});



