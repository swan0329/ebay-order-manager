const fs=require('fs');const p='src/components/EbayAutomaticOperations.tsx';let s=fs.readFileSync(p,'utf8');let a=s.indexOf('  const jobs = [');let b=s.indexOf('\n\n  return (',a);s=s.slice(0,a)+s.slice(b);a=s.indexOf('      {Object.entries(imageJobs).map');b=s.lastIndexOf('\n    </div>');s=s.slice(0,a)+`      {(["EBAY", "SHOPIFY"] as const).map(kind => {
        const entries = [
          { label: operation === "end" ? "판매중단" : "가격·수량", job: kind === "EBAY" ? ebayJob : shopifyJob },
          { label: "이미지", job: imageJobs[kind] },
        ].filter((entry): entry is { label: string; job: AutomaticJob } => Boolean(entry.job));
        if (!entries.length) return null;
        const running = entries.some(({job}) => !terminal.has(job.status));
        const failed = entries.some(({job}) => job.failureCount > 0 || job.status === "FAILED");
        return <div key={kind} className={\`rounded-md border p-3 text-sm \${statusClass(running ? "RUNNING" : failed ? "FAILED" : "COMPLETED")}\`} role="status">
          <strong>{kind === "EBAY" ? "eBay" : "Shopify"} 변동처리</strong>
          {entries.map(({label, job}) => {
            const processed = job.processedCount ?? job.successCount + job.failureCount;
            const status = ({ COMPLETED: "완료", COMPLETED_WITH_ERROR: "일부 실패", FAILED: "실패", CANCELLED: "중단", CANCELED: "중단", QUEUED: "대기", RUNNING: "진행 중" } as Record<string,string>)[job.status] ?? "결과 확인 중";
            const failures = job.failures ?? job.items?.filter(i => i.status === "FAILED").map(i => ({sku:i.sku,itemId:i.id,message:i.error ?? "처리 실패"})) ?? [];
            return <div key={job.id} className="mt-2 border-t border-current/10 pt-2">
              <p className="font-semibold">{label} · {status}</p>
              <p>대상 {job.totalCount} · 처리 {processed} · 성공 {job.successCount} · 실패 {job.failureCount}{label === "이미지" ? \` · 변경 없음 \${Math.max(0, processed-job.successCount-job.failureCount)} · 미처리 \${Math.max(0,job.totalCount-processed)}\` : ""}</p>
              {job.error ? <p className="text-rose-700">{job.error}</p> : null}
              {failures.length ? <details><summary className="cursor-pointer">실패 상세</summary>{failures.map(f => <p key={f.itemId}>{f.sku} · {f.message}</p>)}</details> : null}
            </div>;
          })}
        </div>;
      })}`+s.slice(b);a=s.indexOf('  function stopPolling(');b=s.indexOf('  const poll =',a);s=s.slice(0,a)+s.slice(b);fs.writeFileSync(p,s);
