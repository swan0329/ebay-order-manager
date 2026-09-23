process.loadEnvFile('.vercel/.env.production.local');
async function main(){
 const {prisma}=await import('../src/lib/prisma');
 try{
 const jobs=await prisma.ebayFeedJob.findMany({orderBy:{createdAt:'desc'},take:8});
 console.log(JSON.stringify(jobs.map(j=>({id:j.id,status:j.status,total:j.totalCount,success:j.successCount,failure:j.failureCount,errors:j.failuresJson,task:j.ebayTaskId,created:j.createdAt,targets:(j.targetsJson as any[]).filter(t=>['182221','182222','182226','182229','182232','182234','182291','18432'].includes(t.sku))}))));
 } finally{await prisma.$disconnect();}
}
main().catch(()=>{console.error('Production diagnostic failed');process.exitCode=1;});
