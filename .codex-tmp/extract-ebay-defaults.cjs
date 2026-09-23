const fs = require('fs');
const p = 'src/lib/services/listingDraftService.ts';
let s = fs.readFileSync(p,'utf8');
const start = s.indexOf('    await syncPolicies(input.userId);', s.indexOf('export async function createDraftsFromInventory'));
const end = s.indexOf('\n  }\n  const existingDrafts', start);
if(start<0||end<0) throw new Error('Expected default resolution block missing');
let body = s.slice(start,end).replaceAll('input.userId','userId')
 .replace('    pricingSettings = settings;','')
 .replace('    activeLocationKeys = new Set(', '    const activeLocationKeys = new Set(')
 .replace('    automaticDefaults = {','    const automaticDefaults: ListingUploadDraft = {');
const helper = `export async function resolveAutomaticListingDefaults(\n  userId: string,\n  templateDefaults: ListingUploadDraft | null,\n) {\n${body}\n  return { automaticDefaults, activeLocationKeys, pricingSettings: settings };\n}\n\n`;
s = s.slice(0,start) + '    ({ automaticDefaults, activeLocationKeys, pricingSettings } =\n      await resolveAutomaticListingDefaults(input.userId, templateDefaults));' + s.slice(end);
s = s.replace('export async function createDraftsFromInventory', helper+'export async function createDraftsFromInventory');
fs.writeFileSync(p,s);
