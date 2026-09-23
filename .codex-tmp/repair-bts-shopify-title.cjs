const { loadEnvConfig } = require('@next/env');
const fs = require('node:fs');
loadEnvConfig(process.cwd());
async function main() {
  const e = process.env;
  const domain = e.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  let token = e.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) {
    const r = await fetch(`https://${domain}/admin/oauth/access_token`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:e.SHOPIFY_CLIENT_ID,client_secret:e.SHOPIFY_CLIENT_SECRET,grant_type:'client_credentials'})});
    token = (await r.json()).access_token;
    if (!token) throw new Error(`Authentication HTTP ${r.status}`);
  }
  async function gql(query, variables) {
    const r = await fetch(`https://${domain}/admin/api/${e.SHOPIFY_API_VERSION || '2025-10'}/graphql.json`, {method:'POST',headers:{'content-type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables})});
    const j = await r.json();
    if (!r.ok || j.errors) throw new Error(`Shopify request failed HTTP ${r.status}`);
    return j.data;
  }
  const id='gid://shopify/Product/15265031815536';
  const title='BTS Official MERCH BOX #10 Photocard Kpop';
  const query='query($id: ID!){product(id:$id){id title onlineStoreUrl variants(first:100){nodes{sku}}}}';
  const before=(await gql(query,{id})).product;
  if (!before || !['BTS MERCH BOX #10',title].includes(before.title)) throw new Error('Product title changed; not updating');
  const expected=['100284','97281','100283','100166'].sort();
  if(JSON.stringify(before.variants.nodes.map(v=>v.sku).sort())!==JSON.stringify(expected)) throw new Error('Variation membership changed');
  fs.writeFileSync('.codex-tmp/shopify-bts-title-before.json',JSON.stringify(before));
  const result=await gql('mutation($product:ProductUpdateInput!){productUpdate(product:$product){product{id title} userErrors{field message}}}',{product:{id,title}});
  if(result.productUpdate.userErrors.length) throw new Error(JSON.stringify(result.productUpdate.userErrors));
  const after=(await gql(query,{id})).product;
  if(after.title!==title) throw new Error('Title verification failed');
  fs.writeFileSync('.codex-tmp/shopify-bts-title-after.json',JSON.stringify(after));
  console.log(JSON.stringify(after));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
