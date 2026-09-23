const {loadEnvConfig}=require('@next/env');
const fs=require('fs');
loadEnvConfig(process.cwd());
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
(async()=>{
 const before=read('.codex-tmp/incident-description-images.json').data.products.nodes;
 const targets=before.filter(p=>p.status==='ACTIVE' && /^<p>\{"source":/.test(p.descriptionHtml) && p.descriptionHtml.includes('"importedRow":'));
 if(targets.length!==3) throw Error('Unexpected description target count');
 const e=process.env,domain=e.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//,'').replace(/\/+$/,'');
 const auth=await fetch(`https://${domain}/admin/oauth/access_token`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:e.SHOPIFY_CLIENT_ID,client_secret:e.SHOPIFY_CLIENT_SECRET,grant_type:'client_credentials'})});
 const token=(await auth.json()).access_token;if(!token)throw Error('Authentication failed');
 const request=async(query,variables)=>{const r=await fetch(`https://${domain}/admin/api/${e.SHOPIFY_API_VERSION||'2025-10'}/graphql.json`,{method:'POST',headers:{'content-type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables})});const j=await r.json();if(!r.ok||j.errors)throw Error('Shopify request failed');return j.data;};
 const results=[];
 for(const p of targets){
  const end=p.descriptionHtml.indexOf('</p>');
  const metadata=JSON.parse(p.descriptionHtml.slice(3,end).replace(/&amp;/g,'&'));
  if(!metadata.importedRow||!metadata.source)throw Error('Not an import record');
  const clean=p.descriptionHtml.slice(end+4);
  if(!clean.includes('<h3>Product Details</h3>')||/importedRow|infludeo|pocamarket|X-Amz-/i.test(clean))throw Error('Unexpected remaining description');
  const current=(await request('query($id:ID!){product(id:$id){id descriptionHtml}}',{id:p.id})).product;
  if(current.descriptionHtml===clean){results.push({id:p.id,alreadyClean:true});continue;}
  if(current.descriptionHtml!==p.descriptionHtml)throw Error('Description changed since backup');
  const result=(await request('mutation($input:ProductInput!){productUpdate(input:$input){product{id descriptionHtml} userErrors{field message}}}',{input:{id:p.id,descriptionHtml:clean}})).productUpdate;
  if(result.userErrors.length||/importedRow|infludeo|X-Amz-/i.test(result.product.descriptionHtml))throw Error('Description repair failed');
  results.push({id:p.id,repaired:true});
  fs.writeFileSync('.codex-tmp/incident-description-repair-results.json',JSON.stringify(results,null,2));
 }
 console.log(JSON.stringify(results));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
