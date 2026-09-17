/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

export function OrderCardImage({ sources, title, className = "h-24 w-20" }: {
  sources: string[]; title: string; className?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find(url => !failed.includes(url));
  return <div className={`${className} flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-white`} title={title}>
    {src ? <img src={src} alt={title} loading="lazy" className="h-full w-full object-contain" onError={() => setFailed(current => [...current, src])} />
      : <span className="flex flex-col items-center gap-1 text-[10px] text-zinc-400"><ImageOff className="h-5 w-5" />사진 없음</span>}
  </div>;
}
