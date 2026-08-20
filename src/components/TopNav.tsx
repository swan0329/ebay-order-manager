"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EbayApiUsageBadge } from "@/components/EbayApiUsageBadge";
import { useEffect, useRef, useState } from "react";
import {
  Camera, ChevronRight, Images, Menu, Package, PackageOpen, PlugZap,
  Calculator, CircleDollarSign, RefreshCw, Settings, Sparkles, Truck, Users, X,
} from "lucide-react";
import { LogoutButton } from "@/components/LogoutButton";

type NavItem = { href:string; label:string; icon:typeof Package; matchPrefixes:string[]; excludePrefixes?:string[] };
type NavSection = { label:string; items:NavItem[] };

const sections:NavSection[]=[
  {label:"업무 관리",items:[
    {href:"/orders",label:"주문",icon:Package,matchPrefixes:["/orders"]},
    {href:"/products",label:"재고관리",icon:PackageOpen,matchPrefixes:["/products","/inventory","/inventory/movements"],excludePrefixes:["/inventory/photo-card-match","/products/image-workbench","/products/ai-image-work"]},
    {href:"/shipping",label:"배송처리",icon:Truck,matchPrefixes:["/shipping"]},
  ]},
  {label:"포토카드 이미지",items:[
    {href:"/inventory/photo-card-match",label:"촬영본 연결",icon:Camera,matchPrefixes:["/inventory/photo-card-match"]},
    {href:"/products/image-workbench",label:"이미지 작업",icon:Images,matchPrefixes:["/products/image-workbench"]},
    {href:"/products/ai-image-work",label:"AI 이미지 작업",icon:Sparkles,matchPrefixes:["/products/ai-image-work"]},
    {href:"/image-workers",label:"이미지 작업자 관리",icon:Users,matchPrefixes:["/image-workers"]},
  ]},
  {label:"eBay 판매",items:[
    {href:"/pricing",label:"가격 관리",icon:Calculator,matchPrefixes:["/pricing"]},
    {href:"/listing-upload/variation-groups",label:"옵션상품 구성",icon:Images,matchPrefixes:["/listing-upload/variation-groups"]},
    {href:"/pocamarket-sync",label:"포카마켓 최신화",icon:RefreshCw,matchPrefixes:["/pocamarket-sync"]},
    {href:"/connect",label:"eBay 연결",icon:PlugZap,matchPrefixes:["/connect"]},
    {href:"/automation",label:"자동화 규칙",icon:Settings,matchPrefixes:["/automation"]},
    {href:"/settlements",label:"정산 대조",icon:CircleDollarSign,matchPrefixes:["/settlements"]},
  ]},
];

function isActive(pathname:string,item:NavItem){
  if(item.excludePrefixes?.some(prefix=>pathname===prefix||pathname.startsWith(`${prefix}/`)))return false;
  return item.matchPrefixes.some(prefix=>pathname===prefix||pathname.startsWith(`${prefix}/`));
}

type NavCounts={imagePendingCount:number;reviewCount:number};

function navBadge(item:NavItem,counts?:NavCounts|null){
  if(!counts)return null;
  if(item.href==="/products/ai-image-work")return {count:counts.imagePendingCount,inactive:"bg-sky-100 text-sky-700"};
  if(item.href==="/pocamarket-sync")return {count:counts.reviewCount,inactive:"bg-amber-100 text-amber-800"};
  return null;
}

function Navigation({pathname,onNavigate,counts}:{pathname:string;onNavigate?:()=>void;counts?:NavCounts|null}){
  return <nav className="space-y-5 px-3 py-4">{sections.map(section=><section key={section.label}>
    <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[.12em] text-zinc-400">{section.label}</p>
    <div className="space-y-1">{section.items.map(item=>{const active=isActive(pathname,item);const badge=navBadge(item,counts);return <Link key={item.href} href={item.href} prefetch={false} onClick={onNavigate} aria-current={active?"page":undefined} className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${active?"bg-violet-600 text-white shadow-sm":"text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active?"bg-white/15":"bg-zinc-100 group-hover:bg-white"}`}><item.icon className="h-[18px] w-[18px]"/></span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge&&badge.count>0?<span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${active?"bg-white/20 text-white":badge.inactive}`}>{badge.count>999?"999+":badge.count}</span>:null}
      <ChevronRight className={`h-4 w-4 ${active?"opacity-80":"opacity-0 group-hover:opacity-40"}`}/>
    </Link>})}</div>
  </section>)}</nav>;
}

export function TopNav({loginId}:{loginId:string}){
  const pathname=usePathname();const [open,setOpen]=useState(false);
  const [counts,setCounts]=useState<NavCounts|null>(null);
  useEffect(()=>{let active=true;void fetch("/api/products/stats",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(active&&d)setCounts({imagePendingCount:d.imagePendingCount??0,reviewCount:d.reviewCount??0})}).catch(()=>{});return()=>{active=false}},[pathname]);
  const [syncProgress,setSyncProgress]=useState<{id:string;status:string;scannedCount:number;totalCount:number}|null>(null);
  const lastSyncKickAt=useRef(0);
  useEffect(()=>{let active=true;const check=async()=>{const response=await fetch("/api/pocamarket-sync/progress",{cache:"no-store"}).catch(()=>null);if(!active||!response?.ok)return;const body=await response.json() as {batch?:{id:string;status:string;scannedCount:number;totalCount:number}|null};const batch=body.batch??null;setSyncProgress(batch);if(batch&&["QUEUED","RUNNING"].includes(batch.status)&&Date.now()-lastSyncKickAt.current>=30_000){lastSyncKickAt.current=Date.now();void fetch(`/api/pocamarket-sync/batches/${batch.id}/process`,{method:"POST"})}};void check();const timer=window.setInterval(()=>void check(),5_000);return()=>{active=false;window.clearInterval(timer)}},[]);
  const syncActive=syncProgress&&["QUEUED","RUNNING"].includes(syncProgress.status);
  const syncPercent=syncProgress?.totalCount?Math.round(syncProgress.scannedCount/syncProgress.totalCount*100):0;
  return <>
    <aside data-app-sidebar className="fixed inset-y-0 left-0 z-50 hidden w-[272px] flex-col border-r border-zinc-200 bg-white md:flex">
      <div className="border-b border-zinc-100 px-5 py-5"><Link href="/orders" prefetch={false} className="block"><span className="block text-lg font-black tracking-tight text-zinc-950">eBay Manager</span><span className="mt-0.5 block text-xs text-zinc-400">포토카드 운영 시스템</span></Link></div>
      {syncActive&&<Link href="/pocamarket-sync" className="mx-3 mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900"><span className="flex items-center justify-between font-semibold"><span className="flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 animate-spin"/>포카 최신화 중</span><span>{syncProgress.scannedCount}/{syncProgress.totalCount}</span></span><span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-violet-100"><span className="block h-full bg-violet-600" style={{width:`${syncPercent}%`}}/></span></Link>}
      <div className="min-h-0 flex-1 overflow-y-auto"><Navigation pathname={pathname} counts={counts}/></div>
      <EbayApiUsageBadge/>
      <div className="border-t border-zinc-100 p-4"><div className="mb-3 flex items-center gap-3 rounded-xl bg-zinc-50 p-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">{loginId.slice(0,1).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-zinc-800">{loginId}</p><p className="text-[11px] text-zinc-400">관리자 계정</p></div></div><LogoutButton/></div>
    </aside>

    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/95 backdrop-blur md:hidden"><div className="flex h-14 items-center justify-between px-4"><Link href="/orders" prefetch={false} className="font-bold text-zinc-950">eBay Manager</Link>{syncActive&&<Link href="/pocamarket-sync" className="text-xs font-semibold text-violet-700">{syncProgress.scannedCount}/{syncProgress.totalCount} · {syncPercent}%</Link>}<button type="button" onClick={()=>setOpen(value=>!value)} aria-label={open?"메뉴 닫기":"메뉴 열기"} className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white">{open?<X className="h-5 w-5"/>:<Menu className="h-5 w-5"/>}</button></div></header>
    {open&&<div className="fixed inset-0 top-14 z-40 overflow-y-auto bg-white md:hidden"><Navigation pathname={pathname} onNavigate={()=>setOpen(false)} counts={counts}/><EbayApiUsageBadge/><div className="border-t p-4"><p className="mb-3 text-sm text-zinc-500">{loginId}</p><LogoutButton/></div></div>}
  </>;
}
