"use client";

import { useEffect, useRef, useState } from "react";
import { LISTING_IMAGE_SIZE, LISTING_IMAGE_WIDTH, listingImageBox, portraitRotation, listingImageCornerRadius } from "@/lib/listing-image-layout";

export type LiveListingImageCanvasSettings = {
  logoUrl: string | null;
  watermarkEnabled: boolean;
  watermarkOpacity: number;
  watermarkLogoSize: number;
  watermarkGap: number;
  imageExposure: number;
  imageContrast: number;
  imageSaturation: number;
  imageRotation: number;
  imageZoom: number;
  imageFlipHorizontal: boolean;
  backgroundEnabled: boolean;
  backgroundUrl: string | null;
  backgroundColor: string;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
};

type Props = {
  sourceUrl: string;
  backgroundEligible: boolean;
  settings: LiveListingImageCanvasSettings;
  alt: string;
};

function useLoadedImage(url: string | null) {
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!url) return;
    const next = new Image();
    let active = true;
    next.onload = () => { if (active) setLoaded({ url, image: next }); };
    next.src = url;
    return () => { active = false; };
  }, [url]);
  return loaded?.url === url ? loaded.image : null;
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

export function LiveListingImageCanvas({ sourceUrl, backgroundEligible, settings, alt }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const source = useLoadedImage(sourceUrl);
  const logo = useLoadedImage(settings.watermarkEnabled ? settings.logoUrl : null);
  const background = useLoadedImage(backgroundEligible ? settings.backgroundUrl : null);
  const signature = JSON.stringify({ sourceUrl, backgroundEligible, ...settings });

  useEffect(() => {
    if (!source) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = LISTING_IMAGE_WIDTH, height = LISTING_IMAGE_SIZE;
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = backgroundEligible ? settings.backgroundColor || "#ffffff" : "#ffffff";
    context.fillRect(0, 0, width, height);
    if (backgroundEligible && background) drawCover(context, background, width, height);
    const box = listingImageBox(settings, backgroundEligible);
    const angle = (portraitRotation(source.naturalWidth, source.naturalHeight) + settings.imageRotation) * Math.PI / 180;
    const rotatedWidth = Math.abs(source.naturalWidth * Math.cos(angle)) + Math.abs(source.naturalHeight * Math.sin(angle));
    const rotatedHeight = Math.abs(source.naturalWidth * Math.sin(angle)) + Math.abs(source.naturalHeight * Math.cos(angle));
    const scale = Math.min(box.width / rotatedWidth, box.height / rotatedHeight);
    context.save();
    context.translate(box.left + box.width / 2, box.top + box.height / 2);
    context.rotate(angle);
    context.scale(settings.imageFlipHorizontal ? -1 : 1, 1);
    context.beginPath();
    context.roundRect(-source.naturalWidth * scale / 2, -source.naturalHeight * scale / 2, source.naturalWidth * scale, source.naturalHeight * scale, listingImageCornerRadius(source.naturalWidth, source.naturalHeight) * scale);
    context.clip();
    context.filter = `brightness(${settings.imageExposure}) contrast(${settings.imageContrast}) saturate(${settings.imageSaturation})`;
    context.drawImage(source, -source.naturalWidth * scale / 2, -source.naturalHeight * scale / 2, source.naturalWidth * scale, source.naturalHeight * scale);
    context.restore();

    if (settings.watermarkEnabled && logo) {
      const reference = Math.min(width, height);
      const logoSize = Math.max(1, Math.round(settings.watermarkLogoSize * Math.max(0.2, Math.min(4, reference / 1000))));
      const gap = Math.round(settings.watermarkGap * Math.max(0.2, Math.min(4, reference / 1000)));
      const logoScale = Math.min(logoSize / logo.naturalWidth, logoSize / logo.naturalHeight);
      const logoWidth = Math.max(1, Math.round(logo.naturalWidth * logoScale));
      const logoHeight = Math.max(1, Math.round(logo.naturalHeight * logoScale));
      const angle = 18 * Math.PI / 180;
      const tileWidth = Math.ceil(Math.abs(logoWidth * Math.cos(angle)) + Math.abs(logoHeight * Math.sin(angle)));
      const tileHeight = Math.ceil(Math.abs(logoWidth * Math.sin(angle)) + Math.abs(logoHeight * Math.cos(angle)));
      const tile = document.createElement("canvas");
      tile.width = tileWidth;
      tile.height = tileHeight;
      const tileContext = tile.getContext("2d");
      if (tileContext) {
        tileContext.translate(tileWidth / 2, tileHeight / 2);
        tileContext.rotate(-18 * Math.PI / 180);
        tileContext.filter = "grayscale(1)";
        tileContext.globalAlpha = settings.watermarkOpacity;
        tileContext.drawImage(logo, -logoWidth / 2, -logoHeight / 2, logoWidth, logoHeight);
        const horizontalStep = Math.max(10, tileWidth + gap);
        const verticalStep = Math.max(10, tileHeight + gap);
        const centerX = Math.round(width / 2);
        const centerY = Math.round(height / 2);
        for (let rowIndex = -Math.ceil(centerY / verticalStep); ; rowIndex += 1) {
          const y = centerY + rowIndex * verticalStep - Math.round(tileHeight / 2);
          if (y >= height) break;
          const stagger = Math.abs(rowIndex % 2) === 1 ? Math.round(horizontalStep / 2) : 0;
          for (let columnIndex = -Math.ceil((centerX + stagger) / horizontalStep); ; columnIndex += 1) {
            const x = centerX + stagger + columnIndex * horizontalStep - Math.round(tileWidth / 2);
            if (x >= width) break;
            if (x + tileWidth > 0 && y + tileHeight > 0) context.drawImage(tile, x, y);
          }
        }
      }
    }
  }, [background, backgroundEligible, logo, settings, source]);

  return <canvas ref={canvasRef} role="img" aria-label={alt} data-preview-signature={signature} className="max-h-[680px] w-full object-contain" />;
}
