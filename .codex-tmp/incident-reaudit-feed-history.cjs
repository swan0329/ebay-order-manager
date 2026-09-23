const {call,save}=require('./incident-all-client.cjs');
(async()=>{const result=[];for(const sku of ['296333','284272','284806','287832']){
const j=await call('/api/ebay/operations?history=true&sku='+sku);
const rows=j.jobs.map(job=>({id:job.id,status:job.status,operation:job.operation,createdAt:job.createdAt,submittedAt:job.submittedAt,completedAt:job.completedAt,total:job.totalCount,success:job.successCount,failed:job.failureCount,targets:job.targets.filter(t=>t.sku===sku).map(t=>({sku:t.sku,itemId:t.itemId,price:t.price,quantity:t.quantity})),failures:job.failures?.filter(t=>t.sku===sku).map(t=>({sku:t.sku,message:t.message}))}));
result.push({sku,jobs:rows});save('reaudit-feed-history',result);console.log(JSON.stringify({sku,count:rows.length,jobs:rows}));
}})().catch(e=>{console.error(e.message);process.exitCode=1});
