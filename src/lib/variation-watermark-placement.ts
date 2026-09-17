export type WatermarkPlacement = {
  left: number;
  top: number;
  sourceLeft: number;
  sourceTop: number;
  width: number;
  height: number;
};

/** Shared by the browser preview and the Sharp upload renderer. */
export function variationWatermarkPlacements(input: {
  canvasWidth: number;
  canvasHeight: number;
  headerHeight: number;
  tileWidth: number;
  tileHeight: number;
  repeatDistancePercent: number;
}): WatermarkPlacement[] {
  const { canvasWidth, canvasHeight, headerHeight, tileWidth, tileHeight, repeatDistancePercent } = input;
  const contentHeight = canvasHeight - headerHeight;
  const repeatStep = Math.max(10, Math.round(Math.min(canvasWidth, contentHeight) * repeatDistancePercent / 100));
  const centerX = Math.round(canvasWidth / 2);
  const centerY = headerHeight + Math.round(contentHeight / 2);
  const output: WatermarkPlacement[] = [];
  // Tile centres are independent from tile size. Resizing changes only each
  // logo around its own centre; only repeat distance moves the grid.
  for (let rowIndex = -Math.ceil(contentHeight / repeatStep); ; rowIndex += 1) {
    const y = centerY + rowIndex * repeatStep - Math.round(tileHeight / 2);
    if (y >= canvasHeight) break;
    const stagger = Math.abs(rowIndex % 2) === 1 ? Math.round(repeatStep / 2) : 0;
    for (let columnIndex = -Math.ceil((centerX + stagger) / repeatStep); ; columnIndex += 1) {
      const x = centerX + stagger + columnIndex * repeatStep - Math.round(tileWidth / 2);
      if (x >= canvasWidth) break;
      const left = Math.max(0, x);
      const top = Math.max(headerHeight, y);
      const right = Math.min(canvasWidth, x + tileWidth);
      const bottom = Math.min(canvasHeight, y + tileHeight);
      if (right > left && bottom > top) output.push({
        left,
        top,
        sourceLeft: left - x,
        sourceTop: top - y,
        width: right - left,
        height: bottom - top,
      });
    }
  }
  return output;
}
