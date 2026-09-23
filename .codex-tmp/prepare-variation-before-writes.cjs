const fs=require('fs');const p='src/lib/ebay-variation-publish.ts';let s=fs.readFileSync(p,'utf8');
const start=s.indexOf('  const prepared:'); const write=s.indexOf('    await ebayApiRequest(account, {\n      method: "PUT",',start);const end=s.indexOf('  const groupBody',write);
if(start<0||write<0||end<0) throw new Error('Missing preparation section');
const preparation=s.slice(start,write)+'  }\n\n';
const writes='  for (const { product, input } of prepared) {\n'+s.slice(write,end);
s=s.slice(0,start)+writes+s.slice(end);
s=s.replace('  const groupKey = variationParentSku(group.key);', preparation+'  const groupKey = variationParentSku(group.key);');
fs.writeFileSync(p,s);
