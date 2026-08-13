/* OpenCV runs in this worker so contour detection can never freeze the page. */
self.onmessage = async (event) => {
  const { imageData, maskData, task, strength = 110 } = event.data;
  const mats = [];
  try {
    if (!self.cv || !self.cv.Mat) {
      importScripts("https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js");
      const started = Date.now();
      while (!self.cv || !self.cv.Mat) {
        if (Date.now() - started > 12000) throw new Error("OpenCV 초기화 시간이 초과됐습니다.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const cv = self.cv;
    if (task === "removeWatermark") {
      if (!maskData) throw new Error("워터마크 마스크가 없습니다.");
      const src = cv.matFromImageData(imageData);
      const maskRgba = cv.matFromImageData(maskData);
      const mask = new cv.Mat(), resizedMask = new cv.Mat(), output = src.clone();
      mats.push(src, maskRgba, mask, resizedMask, output);
      cv.cvtColor(maskRgba, mask, cv.COLOR_RGBA2GRAY);
      cv.resize(mask, resizedMask, new cv.Size(src.cols, src.rows), 0, 0, cv.INTER_LINEAR);
      // The calibrated matte can contain a one-row sampling spike (the V3
      // source has one at y=14). Once enlarged, that spike becomes a dark,
      // dashed horizontal line in every finished card. Detect isolated rows
      // with implausibly broad coverage and reconstruct them from neighbours.
      for (let y = 1; y < resizedMask.rows - 1; y += 1) {
        let active = 0, previousActive = 0, nextActive = 0;
        const rowOffset = y * resizedMask.cols;
        const previousOffset = (y - 1) * resizedMask.cols;
        const nextOffset = (y + 1) * resizedMask.cols;
        for (let x = 0; x < resizedMask.cols; x += 1) {
          if (resizedMask.data[rowOffset + x] > 3) active += 1;
          if (resizedMask.data[previousOffset + x] > 3) previousActive += 1;
          if (resizedMask.data[nextOffset + x] > 3) nextActive += 1;
        }
        const coverage = active / resizedMask.cols;
        const neighbourCoverage = (previousActive + nextActive) / (resizedMask.cols * 2);
        if (coverage > 0.24 && coverage > neighbourCoverage * 2.4) {
          for (let x = 0; x < resizedMask.cols; x += 1) {
            resizedMask.data[rowOffset + x] = Math.round(
              (resizedMask.data[previousOffset + x] + resizedMask.data[nextOffset + x]) / 2,
            );
          }
        }
      }
      for (let pixel = 0; pixel < src.cols * src.rows; pixel += 1) {
        // 110 is the neutral point used by the original manual workbench.
        // This matte is calibrated from matching before/approved-after pairs.
        // Directly reversing the white overlay preserves image detail; the old
        // local inpaint/brightness estimator caused dark vertical stroke lines.
        const alpha = Math.min(0.44, (resizedMask.data[pixel] / 255) * Math.max(0.8, Math.min(1.2, strength / 110)));
        if (alpha <= 0.004) continue;
        const offset = pixel * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          output.data[offset + channel] = Math.max(0, Math.min(255, Math.round((src.data[offset + channel] - 255 * alpha) / (1 - alpha))));
        }
        output.data[offset + 3] = 255;
      }
      const result = new ImageData(new Uint8ClampedArray(output.data), output.cols, output.rows);
      self.postMessage({ ok: true, task, imageData: result }, [result.data.buffer]);
      return;
    }
    const src = cv.matFromImageData(imageData);
    const gray = new cv.Mat(), blur = new cv.Mat(), mask = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    mats.push(src, gray, blur, mask, kernel);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    let best = null;
    const modes = [
      () => cv.Canny(blur, mask, 30, 100),
      () => cv.Canny(blur, mask, 60, 180),
      () => cv.adaptiveThreshold(blur, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 41, 5),
    ];
    for (const makeMask of modes) {
      makeMask();
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
      const contours = new cv.MatVector(), hierarchy = new cv.Mat();
      try {
        cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < contours.size(); i += 1) {
          const contour = contours.get(i);
          try {
            const area = cv.contourArea(contour), areaRatio = area / (src.cols * src.rows);
            if (areaRatio < 0.04 || areaRatio > 0.98) continue;
            const rect = cv.minAreaRect(contour);
            let w = rect.size.width, h = rect.size.height;
            if (!w || !h) continue;
            if (w > h) [w, h] = [h, w];
            const ratioScore = Math.max(0, 1 - Math.abs(w / h - 54 / 86) / 0.35);
            const rectangularity = Math.min(1, area / (w * h));
            if (ratioScore < 0.35 || rectangularity < 0.45) continue;
            const score = ratioScore * 0.5 + rectangularity * 0.3 + Math.min(1, areaRatio / 0.45) * 0.2;
            if (!best || score > best.score) {
              best = { points: cv.RotatedRect.points(rect).map((p) => ({ x: p.x, y: p.y })), score };
            }
          } finally { contour.delete(); }
        }
      } finally { contours.delete(); hierarchy.delete(); }
    }
    if (!best) throw new Error("확실한 카드 외곽선을 찾지 못했습니다.");
    self.postMessage({ ok: true, points: best.points, confidence: best.score });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    mats.forEach((mat) => mat.delete());
  }
};
