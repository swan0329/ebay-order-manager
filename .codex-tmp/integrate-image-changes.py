from pathlib import Path
p=Path('src/components/EbayAutomaticOperations.tsx')
s=p.read_text(encoding='utf-8')
s=s.replace('const [starting, setStarting]', 'const [imageJobs, setImageJobs] = useState<Record<string, AutomaticJob>>({});\n  const [starting, setStarting]')
start=s.index('  async function requestJob(')
end=s.index('\n  async function start()',start)
s=s[:start]+'''  useEffect(() => {
    let disposed = false;
    async function refreshImages() {
      for (const kind of ["EBAY", "SHOPIFY"]) {
        const id = window.localStorage.getItem(`active-change-images-${kind}`);
        if (!id) continue;
        try {
          const response = await fetch(`/api/channel-publish-jobs?jobId=${encodeURIComponent(id)}`, { cache: "no-store" });
          const body = await response.json();
          if (!response.ok || !body.job) throw new Error(body.error ?? "이미지 처리 상태 조회 실패");
          if (disposed) return;
          setImageJobs(prev => ({ ...prev, [kind]: body.job }));
          if (terminal.has(body.job.status)) {
            window.localStorage.removeItem(`active-change-images-${kind}`);
            notifyProductDataChanged();
          }
        } catch (error) { if (!disposed) setMessage(String(error)); }
      }
    }
    void refreshImages();
    const timer = window.setInterval(() => void refreshImages(), 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  async function requestJob(kind: "EBAY" | "SHOPIFY") {
    const endpoint = operation === "revise" ? "/api/channel-publishing/changes"
      : kind === "EBAY" ? "/api/ebay/operations" : "/api/shopify/operations";
    const response = await fetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(operation === "revise" ? { channel: kind } : { operation }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`${kind}: ${body.error ?? "자동 작업 시작 실패"}`);
    if (body.job) receiveJob(kind, body.job);
    if (body.imageJob) {
      setImageJobs(prev => ({ ...prev, [kind]: body.imageJob }));
      window.localStorage.setItem(`active-change-images-${kind}`, body.imageJob.id);
    }
    if (body.errors?.length) throw new Error(`${kind}: ${body.errors.join(" / ")}`);
    if (!body.job && !body.imageJob) return `${kind}: 반영할 변경 없음`;
    return "";
  }
''' +s[end:]
s=s.replace('setMessage(failures.join(" / "));', 'setMessage([...failures, ...results.flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : [])].join(" / "));')
s=s.replace('가격·수량·옵션 품절', '가격·재고·이미지 변경')
s=s.replace('const active = [ebayJob, shopifyJob]', 'const active = [ebayJob, shopifyJob, ...Object.values(imageJobs)]')
needle='      {jobs.map(({ kind, job }) => {'
s=s.replace(needle,'''      {Object.entries(imageJobs).map(([kind, job]) => (
        <div key={job.id} className={`rounded-md border p-3 text-sm ${statusClass(job.status)}`} role="status">
          <strong>{kind} 이미지 · {terminal.has(job.status) ? "처리 완료" : "반영 중"}</strong>
          <p>묶음 대표·옵션 포함 {job.totalCount}개 판매상품 · 처리 {job.processedCount ?? 0} · 성공 {job.successCount} · 실패 {job.failureCount}</p>
          {job.items?.filter(item => item.status === "FAILED").map(item => <p key={item.id}>{item.sku}: {item.error}</p>)}
        </div>
      ))}
''' +needle)
s=s.replace('옵션 품절은 가격·수량 작업에서 해당 옵션 재고만 0으로 반영합니다.', '이미지·워터마크·배경 변경은 묶음 대표와 옵션 이미지까지 반영합니다. 한 번에 채널별 가격·재고 최대 500개(Shopify), 이미지 최대 500개 판매상품을 처리합니다. 남은 대상은 다음 실행에 반영합니다.')
p.write_text(s,encoding='utf-8')
p=Path('src/lib/channel-publish-jobs.ts');s=p.read_text(encoding='utf-8').replace('shopifyStatus: job.mode === "IMAGES" ? product.shopifyStatus : localShopifyStatus ?? result.status,','...(job.mode === "IMAGES" ? {} : { shopifyStatus: localShopifyStatus ?? result.status }),').replace('status: "SKIPPED", error: "이미 등록 완료",','status: "SKIPPED", error: error.message,');p.write_text(s,encoding='utf-8')
p=Path('src/app/api/products/channel-operation-counts/route.ts');s=p.read_text(encoding='utf-8');s='import { getChannelImageChanges } from "@/lib/channel-image-changes";\n'+s;s=s.replace('return Response.json(await getChannelOperationCounts(user.id));','const [counts, ebayImages, shopifyImages] = await Promise.all([getChannelOperationCounts(user.id), getChannelImageChanges(user.id, "EBAY"), getChannelImageChanges(user.id, "SHOPIFY")]);\n    return Response.json({ ...counts, images: { ebay: ebayImages.length, shopify: shopifyImages.length } });');p.write_text(s,encoding='utf-8')
p=Path('src/components/ChannelOperationCounts.tsx');s=p.read_text(encoding='utf-8').replace('type Counts = {','type Counts = {\n  images?: { ebay: number; shopify: number };');s=s.replace('      {counts?.ebay.revise ? (','      {counts?.images ? <p className="border-t border-zinc-100 px-3 py-2 text-xs text-blue-700">이미지 변경: eBay {counts.images.ebay}개 · Shopify {counts.images.shopify}개 판매상품 (묶음은 대표·옵션 포함 1개). 변동처리에 함께 포함됩니다.</p> : null}\n      {counts?.ebay.revise ? (');p.write_text(s,encoding='utf-8')
