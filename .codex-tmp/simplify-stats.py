from pathlib import Path
p=Path('src/components/ProductStatsCards.tsx')
s=p.read_text(encoding='utf-8')
s=s.replace('  Camera,','  ImageIcon,').replace('  PackageSearch,\n','').replace('  ShoppingBag,\n','')
s=s.replace('  const channelName = channel === "SHOPIFY" ? "Shopify" : "eBay";\n','')
a=s.index('  const primary = ['); b=s.index('  const toneClass =',a)
s=s[:a]+'''  const primary = [
    { label: "전체 상품", count: currentStats.totalCount, description: "관리 중인 카드 SKU 수 · 카드 실물 장수나 판매페이지 수가 아닙니다", href: statsHref(currentParams, pageSize, channel), icon: PackageOpen, tone: "zinc" },
    { label: "내 재고 보유", count: currentStats.ownStockCount, description: "재고가 1장 이상 있는 SKU · 이미지 준비 여부와 무관", href: `${statsHref(currentParams, pageSize, channel)}&stock=in_stock`, icon: PackageCheck, tone: "blue" },
    { label: "내 재고 중 이미지 준비 완료", count: currentStats.inStockCount, description: "내 재고 보유 상품 중 판매 이미지가 준비된 SKU · 위 재고 수에 포함", href: statsHref(currentParams, pageSize, channel, "in_stock"), icon: PackageCheck, tone: "teal" },
  ] as const;

  const tasks = [
    { label: "판매 이미지 작업 필요", description: "내 재고 또는 포카 재고가 있지만 판매 이미지가 준비되지 않은 상품", count: currentStats.imagePendingCount, href: statsHref(currentParams, pageSize, channel, "image_pending"), icon: ImageIcon, priority: currentStats.imagePendingCount > 0 },
    { label: "판매가격 입력 필요", description: "공급·이미지는 준비됐지만 포카 가격과 직접 지정 USD 가격이 모두 없음 · 등록된 상품 포함", count: currentStats.priceMissingCount, href: statsHref(currentParams, pageSize, channel, "price_missing"), icon: DollarSign, priority: currentStats.priceMissingCount > 0 },
    { label: "포카 정보 확인 필요", description: "포카마켓 최신화 이력이 없어 공급 정보를 확인해야 하는 상품", count: currentStats.reviewCount, href: statsHref(currentParams, pageSize, channel, "review"), icon: AlertTriangle, priority: currentStats.reviewCount > 0 },
  ];

'''+s[b:]
s=s.replace('판매채널별 상품 현황','상품·재고 현황').replace('전체 카드 SKU 기준 · 옵션으로 묶인 판매페이지 수와 다릅니다. 실제 자동등록 후보는 아래 ‘채널별 작업 대상’에서 확인하세요.','전체 카드 SKU 기준 · 등록·변동·판매중단 대상은 아래 판매채널 자동 반영에서 확인하세요.')
a=s.index('        <div className="inline-flex rounded-lg');b=s.index('\n      </div>',a)
s=s[:a]+s[b:]
s=s.replace('sm:grid-cols-2 xl:grid-cols-4','sm:grid-cols-3')
s=s.replace('숫자를 누르면 해당 상품만 바로 조회합니다.','직접 확인하거나 준비할 작업입니다. 숫자를 누르면 같은 조건의 전체 상품을 조회합니다.')
s=s.replace('      </div>\n    </section>', '''        <div className="mt-3 border-t border-zinc-100 pt-3"><Link href="/products/unit-members" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-600 hover:text-zinc-950"><Users className="h-4 w-4" />유닛 멤버 지정</Link><span className="ml-2 text-xs text-zinc-500">멤버 정보 보완이 필요할 때 열기</span></div>
      </div>
    </section>''')
p.write_text(s,encoding='utf-8')
p=Path('src/components/ProductsControls.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('<select name="operation"', '''<label className="flex items-center gap-2 text-xs font-semibold text-zinc-500">목록 조회 채널<select aria-label="목록 조회 채널" value={statsChannel} onChange={event => { const next = new URLSearchParams(searchParams.toString()); next.set("channel", event.currentTarget.value); next.delete("page"); router.push(`/products?${next}`); }} className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900"><option value="EBAY">eBay</option><option value="SHOPIFY">Shopify</option></select></label>
              <select name="operation"''')
s=s.replace('{channelName}에 올릴 수 있음','{channelName} 등록 준비 후보')
s=s.replace('<option value="image_pending">', '<option value="selling">{channelName} 판매 연결·공급 가능</option><option value="own_photo_listable">촬영 완료·{channelName} 등록 전</option><option value="procurement_listable">포카 조달·{channelName} 등록 준비 후보</option><option value="price_missing">판매가격 입력 필요</option><option value="unit_no_members">유닛 멤버 미지정</option><option value="image_pending">')
p.write_text(s,encoding='utf-8')
p=Path('src/components/ChannelOperationCounts.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('<div className="space-y-1.5 border-t border-zinc-100 bg-zinc-50/60 px-3 py-3 text-xs leading-relaxed text-zinc-600">','<details className="space-y-1.5 border-t border-zinc-100 bg-zinc-50/60 px-3 py-3 text-xs leading-relaxed text-zinc-600">')
s=s.replace('<p className="font-semibold text-zinc-800">상단의 ‘등록 준비 후보’와 다른 이유</p>','<summary className="cursor-pointer font-semibold text-zinc-800">자동등록 후보 기준·제외 내역</summary>')
s=s.replace('모두 카드 SKU 수이며, 옵션으로 묶인 실제 판매페이지 수와 다릅니다.</p>\n      </div>', '모두 카드 SKU 수이며, 옵션으로 묶인 실제 판매페이지 수와 다릅니다.</p>\n      </details>')
p.write_text(s,encoding='utf-8')
