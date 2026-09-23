import {loadEnvConfig} from '@next/env';
loadEnvConfig(process.cwd());
async function main(){
 const {prisma}=await import('../src/lib/prisma');
 const items=await prisma.channelPublishItem.findMany({where:{sku:'78719'},include:{job:{select:{id:true,userId:true,channel:true,status:true,createdAt:true}}},orderBy:{createdAt:'desc'},take:4});
 console.log(JSON.stringify(items));
 await prisma.$disconnect();
}
main();
