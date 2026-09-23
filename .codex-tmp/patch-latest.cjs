const fs=require('fs'),p='src/lib/channel-publish-jobs.ts';let s=fs.readFileSync(p,'utf8');let a=s.indexOf('export async function getLatestImagePublishJobs');let b=s.indexOf('export async function getActiveChannelPublishJobs',a);s=s.slice(0,a)+`export async function getLatestImagePublishJobs(userId: string) {
  const jobs = [];
  for (const channel of ["EBAY", "SHOPIFY"] as const) {
    const job = await prisma.channelPublishJob.findFirst({
      where: { userId, channel, mode: "IMAGES" }, orderBy: { createdAt: "desc" },
      include: { items: { where: { status: { in: ["FAILED", "PROCESSING", "SKIPPED"] } }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, sku: true, status: true, error: true } } },
    });
    jobs.push(job ? { ...job, error: job.error ? safeError(new Error(job.error)) : null, items: job.items.map(item => ({ ...item, error: item.error ? safeError(new Error(item.error)) : null })) } : null);
  }
  return jobs;
}

`+s.slice(b);fs.writeFileSync(p,s);
