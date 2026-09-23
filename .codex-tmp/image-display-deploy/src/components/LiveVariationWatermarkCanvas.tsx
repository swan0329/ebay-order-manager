"use client";

import { useEffect, useRef, useState } from "react";
import { variationWatermarkPlacements } from "@/lib/variation-watermark-placement";

type Props = { baseUrl: string; tileUrl: string | null; repeatDistancePercent: number; alt: string };

function useImage(url: string | null) {
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!url) return;
    const next = new Image(); let active = true;
    next.onload = () => { if (active) setLoaded({ url, image: next }); };
    next.src = url;
    return () => { active = false; };
  }, [url]);
  return url && loaded?.url === url ? loaded.image : null;
}

/** Uses the exact Sharp-created tile used by the upload renderer. Only its
 * small PNG changes while a watermark slider is moving. */
export function LiveVariationWatermarkCanvas({ baseUrl, tileUrl, repeatDistancePercent, alt }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const base = useImage(baseUrl);
  const tile = useImage(tileUrl);
  useEffect(() => {
    if (!base || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = base.naturalWidth; canvas.height = base.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(base, 0, 0);
    if (!tile) return;
    const width = tile.naturalWidth; const height = tile.naturalHeight;
    for (const placement of variationWatermarkPlacements({
      canvasWidth: canvas.width, canvasHeight: canvas.height, headerHeight: 150,
      tileWidth: width, tileHeight: height, repeatDistancePercent,
    })) context.drawImage(
      tile,
      placement.sourceLeft,
      placement.sourceTop,
      placement.width,
      placement.height,
      placement.left,
      placement.top,
      placement.width,
      placement.height,
    );
  }, [base, repeatDistancePercent, tile]);
  return <canvas ref={canvasRef} role="img" aria-label={alt} className="max-h-[680px] w-full object-contain" />;
}
