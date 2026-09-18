"use client";
/* eslint-disable @next/next/no-img-element */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useCardCorners } from "@/components/useCardCorners";
import { LocalAiStatusBadge } from "@/components/LocalAiStatusBadge";
import { fetchWithTimeout } from "@/lib/client-fetch-timeout";
import {
  distance,
  normalizeFourCorners,
  roundCanvasCorners,
  seamlessQuadrilateralCrop,
  type Point,
} from "@/lib/card-crop";

type Candidate = { url: string; score?: number; reason?: string };
let lensSearchWindow: Window | null = null;

function applyCanvasSharpness(canvas: HTMLCanvasElement, sharpness: number) {
  if (sharpness <= 0) return;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const blurred = document.createElement("canvas");
  blurred.width = canvas.width;
  blurred.height = canvas.height;
  const blurredContext = blurred.getContext("2d", { willReadFrequently: true });
  if (!blurredContext) return;
  blurredContext.filter = "blur(1px)";
  blurredContext.drawImage(canvas, 0, 0);
  const original = context.getImageData(0, 0, canvas.width, canvas.height);
  const soft = blurredContext.getImageData(0, 0, canvas.width, canvas.height);
  const amount = Math.min(0.9, sharpness / 34);
  for (let offset = 0; offset < original.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      original.data[offset + channel] = Math.max(0, Math.min(255, Math.round(original.data[offset + channel] + amount * (original.data[offset + channel] - soft.data[offset + channel]))));
    }
  }
  context.putImageData(original, 0, 0);
}

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("합성 이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

export function ProductImageWorkbench({
  productId,
  referenceUrl,
  imageSource,
  nextHref,
}: {
  productId: string;
  referenceUrl: string | null;
  imageSource?: string | null;
  nextHref?: string | null;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const pendingWatermarkRemovalRef = useRef(false);
  const watermarkStrengthRef = useRef(110);
  const localAiEnabledRef = useRef(false);
  const watermarkRemovalRunRef = useRef(0);
  const watermarkRemovingRef = useRef(false);
  const watermarkWorkerRef = useRef<Worker | null>(null);
  const waitingForLensClipboardRef = useRef(false);
  const clipboardBeforeLensRef = useRef("");
  const [result, setResult] = useState<string | null>(null);
  // 네 모서리를 고르는 방식은 AI 이미지 작업과 같은 것을 쓴다. 두 화면이 따로
  // 구현하면 손에 익은 조작이 화면마다 달라진다.
  const {
    points,
    pointHistory,
    undoPoints,
    clearPoints,
    resetPoints,
    autoDetect,
    autoDetecting,
    canvasHandlers,
  } = useCardCorners({
    canvasRef,
    imageRef,
    onChange: () => setResult(null),
    onMessage: (message) => setMessage(message),
  });
  const [candidateUrl, setCandidateUrl] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [selectedCandidateUrl, setSelectedCandidateUrl] = useState("");
  const [rawExtractedCard, setRawExtractedCard] = useState<string | null>(null);
  const [extractedCard, setExtractedCard] = useState<string | null>(null);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [cardScale, setCardScale] = useState(72);
  const [shadowX, setShadowX] = useState(12);
  const [shadowY, setShadowY] = useState(18);
  const [shadowBlur, setShadowBlur] = useState(24);
  const [shadowOpacity, setShadowOpacity] = useState(35);
  const [brightness, setBrightness] = useState(8);
  const [contrast, setContrast] = useState(3);
  const [saturation, setSaturation] = useState(5);
  const [sharpness, setSharpness] = useState(12);
  const [watermarkStrength, setWatermarkStrength] = useState(110);
  const [localAiEnabled, setLocalAiEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [watermarkRemoving, setWatermarkRemoving] = useState(false);
  const [watermarkRemoved, setWatermarkRemoved] = useState(false);

  useEffect(() => () => watermarkWorkerRef.current?.terminate(), []);

  useEffect(() => {
    void fetch("/api/products/image-workbench/settings")
      .then(async (response) => {
        if (!response.ok) throw new Error("설정을 불러오지 못했습니다.");
        return response.json() as Promise<{
          brightness: number;
          contrast: number;
          saturation: number;
          sharpness: number;
          watermarkStrength: number;
          localAiEnabled: boolean;
        }>;
      })
      .then((settings) => {
        setBrightness(settings.brightness);
        setContrast(settings.contrast);
        setSaturation(settings.saturation);
        setSharpness(settings.sharpness);
        setWatermarkStrength(settings.watermarkStrength);
        watermarkStrengthRef.current = settings.watermarkStrength;
        setLocalAiEnabled(settings.localAiEnabled);
        localAiEnabledRef.current = settings.localAiEnabled;
        setSettingsLoaded(true);
      })
      .catch(() => setSettingsLoaded(true));
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = window.setTimeout(async () => {
      setSettingsSaving(true);
      try {
        await fetch("/api/products/image-workbench/settings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            brightness,
            contrast,
            saturation,
            sharpness,
            watermarkStrength,
            localAiEnabled,
          }),
        });
      } finally {
        setSettingsSaving(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    brightness,
    contrast,
    saturation,
    sharpness,
    watermarkStrength,
    localAiEnabled,
    settingsLoaded,
  ]);

  useEffect(() => {
    if (nextHref) router.prefetch(nextHref);
  }, [nextHref, router]);

  useEffect(() => {
    if (!rawExtractedCard) return;
    let cancelled = false;
    void loadCanvasImage(rawExtractedCard)
      .then((card) => {
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        canvas.width = card.naturalWidth;
        canvas.height = card.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.filter = `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100}) saturate(${1 + saturation / 100})`;
        context.drawImage(card, 0, 0);
        applyCanvasSharpness(canvas, sharpness);
        roundCanvasCorners(canvas, Math.round(canvas.width * 0.045));
        setExtractedCard(canvas.toDataURL("image/png"));
      })
      .catch(() => setMessage("이미지 보정에 실패했습니다."));
    return () => {
      cancelled = true;
    };
  }, [rawExtractedCard, brightness, contrast, saturation, sharpness]);

  useEffect(() => {
    if (!extractedCard) return;
    let cancelled = false;
    const compose = async () => {
      try {
        if (!localAiEnabledRef.current) throw new Error("Local AI disabled");
        if (!backgroundImage) {
          const card = await loadCanvasImage(extractedCard);
          if (cancelled) return;
          const canvas = document.createElement("canvas");
          canvas.width = card.naturalWidth;
          canvas.height = card.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context) return;
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(card, 0, 0);
          setResult(canvas.toDataURL("image/jpeg", 0.88));
          return;
        }
        const [card, background] = await Promise.all([
          loadCanvasImage(extractedCard),
          loadCanvasImage(backgroundImage),
        ]);
        if (cancelled) return;
        const outputScale = Math.min(
          1,
          1600 / Math.max(background.naturalWidth, background.naturalHeight),
        );
        const width = Math.max(
          1,
          Math.round(background.naturalWidth * outputScale),
        );
        const height = Math.max(
          1,
          Math.round(background.naturalHeight * outputScale),
        );
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(background, 0, 0, width, height);
        const maxCardHeight = (height * cardScale) / 100;
        const maxCardWidth = width * 0.9;
        const scale = Math.min(
          maxCardHeight / card.naturalHeight,
          maxCardWidth / card.naturalWidth,
        );
        const cardWidth = card.naturalWidth * scale;
        const cardHeight = card.naturalHeight * scale;
        const x = (width - cardWidth) / 2;
        const y = (height - cardHeight) / 2;
        context.save();
        context.shadowColor = `rgba(0,0,0,${shadowOpacity / 100})`;
        context.shadowOffsetX = shadowX;
        context.shadowOffsetY = shadowY;
        context.shadowBlur = shadowBlur;
        context.drawImage(card, x, y, cardWidth, cardHeight);
        context.restore();
        if (!cancelled) setResult(canvas.toDataURL("image/jpeg", 0.88));
      } catch (error) {
        if (!cancelled)
          setMessage(
            error instanceof Error
              ? error.message
              : "배경 합성에 실패했습니다.",
          );
      }
    };
    void compose();
    return () => {
      cancelled = true;
    };
  }, [
    extractedCard,
    backgroundImage,
    cardScale,
    shadowX,
    shadowY,
    shadowBlur,
    shadowOpacity,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.font = "bold 14px sans-serif";
    context.strokeStyle = "#ef4444";
    context.lineWidth = 3;
    points.forEach((point, index) => {
      context.beginPath();
      context.arc(point.x, point.y, 11, 0, Math.PI * 2);
      context.fillStyle = "white";
      context.fill();
      context.lineWidth = 4;
      context.strokeStyle = "#ef4444";
      context.stroke();
      context.fillStyle = "#dc2626";
      context.fillText(String(index + 1), point.x + 10, point.y - 10);
    });
    if (points.length > 1) {
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      if (points.length === 4) context.closePath();
      context.stroke();
    }
  }, [points]);

  const loadCandidateUrl = (value: string, cacheBust = false) => {
    if (!/^https?:\/\//i.test(value)) {
      setMessage("http 또는 https 이미지 주소를 입력해 주세요.");
      return;
    }
    resetPoints();
    setRawExtractedCard(null);
    setExtractedCard(null);
    setWatermarkRemoved(false);
    setResult(null);
    setMessage(
      "왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래 순서로 네 점을 찍으세요.",
    );
    setSelectedCandidateUrl(value);
    setLoadedUrl(
      `/api/products/${productId}/image-workbench?url=${encodeURIComponent(value)}${cacheBust ? `&t=${Date.now()}` : ""}`,
    );
  };

  const loadCandidateFile = (file: File | undefined) => {
    if (!file) return;
    if (!/^(image\/jpeg|image\/png|image\/webp)$/i.test(file.type)) {
      setMessage("JPG, JPEG, PNG 또는 WebP 이미지 파일만 가져올 수 있습니다.");
      return;
    }
    if (file.size > 15_000_000) {
      setMessage("컴퓨터 이미지는 15MB 이하만 가져올 수 있습니다.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      pendingWatermarkRemovalRef.current = false;
      resetPoints();
      setRawExtractedCard(null);
      setExtractedCard(null);
      setWatermarkRemoved(false);
      setResult(null);
      setSelectedCandidateUrl("");
      setLoadedUrl(reader.result);
      setMessage(`${file.name} 파일을 불러왔습니다. 카드 영역을 드래그하세요.`);
    };
    reader.onerror = () => setMessage("컴퓨터 이미지 파일을 읽지 못했습니다.");
    reader.readAsDataURL(file);
  };

  const loadCandidate = () => {
    const value = candidateUrl.trim();
    if (!/^https?:\/\//i.test(value))
      return setMessage("http 또는 https 이미지 주소를 입력해 주세요.");
    setCandidates((current) =>
      current.some((item) => item.url === value)
        ? current
        : [...current, { url: value }],
    );
    loadCandidateUrl(value);
    setCandidateUrl("");
  };

  const importCandidateUrl = useCallback(
    (rawValue: string) => {
      const value = rawValue
        .trim()
        .split(/\s+/)
        .find((item) => /^https?:\/\//i.test(item));
      if (!value)
        return setMessage("복사한 내용에서 이미지 주소를 찾지 못했습니다.");
      setCandidates((current) =>
        current.some((item) => item.url === value)
          ? current
          : [...current, { url: value }],
      );
      setCandidateUrl("");
      loadCandidateUrl(value);
    },
    [productId],
  );

  const importFromClipboard = async () => {
    try {
      importCandidateUrl(await navigator.clipboard.readText());
    } catch {
      setMessage(
        "클립보드를 읽을 수 없습니다. 입력칸을 누르고 Ctrl+V로 붙여넣어 주세요.",
      );
    }
  };

  useEffect(() => {
    const importWhenReturningFromLens = async () => {
      if (!waitingForLensClipboardRef.current) return;
      waitingForLensClipboardRef.current = false;
      try {
        const value = (await navigator.clipboard.readText()).trim();
        if (
          value &&
          value !== clipboardBeforeLensRef.current &&
          /^https?:\/\//i.test(value)
        )
          importCandidateUrl(value);
      } catch {
        // Clipboard permission varies by browser; the explicit button remains available.
      }
    };
    window.addEventListener("focus", importWhenReturningFromLens);
    return () =>
      window.removeEventListener("focus", importWhenReturningFromLens);
  }, [importCandidateUrl]);

  const analyzeCandidates = async () => {
    if (!referenceUrl || !candidates.length) return;
    setMessage("AI가 후보를 비교하는 중입니다...");
    const response = await fetch(
      `/api/products/${productId}/image-workbench/analyze`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          referenceUrl,
          candidateUrls: candidates.map((item) => item.url),
        }),
      },
    );
    const data = (await response.json()) as {
      error?: string;
      results?: Candidate[];
    };
    if (!response.ok)
      return setMessage(data.error ?? "후보 분석에 실패했습니다.");
    const ranked = data.results ?? [];
    setCandidates(ranked);
    if (ranked[0]) loadCandidateUrl(ranked[0].url);
    setMessage(
      ranked[0]
        ? `자동 추천 1순위: ${ranked[0].reason ?? "품질 우수"}`
        : "분석 결과가 없습니다.",
    );
  };

  async function removePocamarketWatermark() {
    const image = imageRef.current;
    if (!image) return;
    watermarkWorkerRef.current?.terminate();
    const run = ++watermarkRemovalRunRef.current;
    watermarkRemovingRef.current = true;
    setWatermarkRemoving(true);
    setMessage("포카마켓 워터마크를 복원하는 중입니다…");
    try {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
      if (!sourceContext) throw new Error("이미지 처리 화면을 준비하지 못했습니다.");
      sourceContext.drawImage(image, 0, 0);

      // Only contact the local model when the user explicitly enabled it.
      // Otherwise this action must stay on the visible OpenCV engine.
      if (localAiEnabledRef.current) {
        try {
        const aiInput = document.createElement("canvas");
        aiInput.width = 540;
        aiInput.height = 860;
        aiInput.getContext("2d")?.drawImage(image, 0, 0, 540, 860);
        const response = await fetchWithTimeout("http://127.0.0.1:5177/__watermark-ai/infer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: aiInput.toDataURL("image/jpeg", 0.92) }),
        }, 45_000);
        const body = (await response.json().catch(() => ({}))) as {
          image?: string;
          error?: string;
        };
        if (!response.ok || !body.image)
          throw new Error(body.error || "로컬 AI 복원 결과가 없습니다.");
        if (run !== watermarkRemovalRunRef.current) return;
        setLoadedUrl(body.image);
        setWatermarkRemoved(true);
        resetPoints();
        setRawExtractedCard(null);
        setExtractedCard(null);
        setResult(null);
        setMessage("로컬 AI 학습 모델로 워터마크를 복원했습니다.");
        return;
        } catch {
          // localhost can be unavailable; preserve the existing manual fallback.
        }
      }

      const maskImage = await loadCanvasImage("/pocamarket-watermark-mask-v4.png");
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = maskImage.naturalWidth;
      maskCanvas.height = maskImage.naturalHeight;
      const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
      if (!sourceContext || !maskContext) throw new Error("이미지 처리 화면을 준비하지 못했습니다.");
      maskContext.drawImage(maskImage, 0, 0);
      const worker = new Worker("/opencv-card-worker.js?v=20260728-17-rollback");
      watermarkWorkerRef.current = worker;
      const result = await new Promise<ImageData>((resolve, reject) => {
        const timer = window.setTimeout(() => { worker.terminate(); reject(new Error("워터마크 제거 시간이 초과되었습니다.")); }, 35_000);
        worker.onmessage = (event: MessageEvent<{ ok: boolean; imageData?: ImageData; error?: string }>) => {
          window.clearTimeout(timer);
          worker.terminate();
          if (!event.data.ok || !event.data.imageData) reject(new Error(event.data.error ?? "워터마크 제거에 실패했습니다."));
          else resolve(event.data.imageData);
        };
        worker.onerror = () => { window.clearTimeout(timer); worker.terminate(); reject(new Error("워터마크 제거 엔진을 불러오지 못했습니다.")); };
        const sourceData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        const maskData = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        worker.postMessage({ task: "removeWatermark", imageData: sourceData, maskData, strength: watermarkStrengthRef.current }, [sourceData.data.buffer, maskData.data.buffer]);
      });
      if (run !== watermarkRemovalRunRef.current) return;
      const output = document.createElement("canvas");
      output.width = result.width;
      output.height = result.height;
      output.getContext("2d")?.putImageData(result, 0, 0);
      setLoadedUrl(output.toDataURL("image/jpeg", .92));
      setWatermarkRemoved(true);
      resetPoints();
      setRawExtractedCard(null);
      setExtractedCard(null);
      setResult(null);
      setMessage("워터마크 제거 결과를 확인한 뒤 카드 영역을 드래그하세요.");
    } catch (error) {
      if (run !== watermarkRemovalRunRef.current) return;
      setMessage(error instanceof Error ? error.message : "워터마크 제거에 실패했습니다.");
    } finally {
      if (run === watermarkRemovalRunRef.current) {
        watermarkWorkerRef.current = null;
        watermarkRemovingRef.current = false;
        setWatermarkRemoving(false);
      }
    }
  }

  const crop = () => {
    const image = imageRef.current;
    const sourceCanvas = canvasRef.current;
    if (!image || !sourceCanvas || points.length !== 4) return;
    const orderedPoints = normalizeFourCorners(
      points,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    if (!orderedPoints) {
      setMessage(
        "네 모서리가 겹쳐 있습니다. 네 개의 서로 다른 점으로 사각형을 만들어 주세요.",
      );
      return;
    }
    const scaleX = image.naturalWidth / sourceCanvas.width;
    const scaleY = image.naturalHeight / sourceCanvas.height;
    const source = orderedPoints.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })) as [Point, Point, Point, Point];
    const measuredHeight = Math.max(
      distance(source[0], source[3]),
      distance(source[1], source[2]),
    );
    // Standard photocard dimensions are 54 × 86 mm. The four selected points
    // define perspective only; output dimensions stay fixed to the real card
    // ratio so a slightly wide selection cannot stretch the final image.
    const cardRatio = 54 / 86;
    const height = Math.max(860, Math.min(1720, Math.round(measuredHeight)));
    const width = Math.round(height * cardRatio);
    const output = seamlessQuadrilateralCrop(image, source, width, height);
    if (!output) return;
    roundCanvasCorners(output, Math.round(width * 0.045));
    const transparentCardDataUrl = output.toDataURL("image/png");
    setRawExtractedCard(transparentCardDataUrl);
    setMessage("추출 결과를 확인한 뒤 승인 저장하세요.");
  };

  const loadBackground = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/"))
      return setMessage("배경은 이미지 파일만 선택할 수 있습니다.");
    if (file.size > 15_000_000)
      return setMessage("배경 이미지는 15MB 이하로 선택해 주세요.");
    const reader = new FileReader();
    reader.onload = () => setBackgroundImage(String(reader.result));
    reader.onerror = () => setMessage("배경 이미지를 읽지 못했습니다.");
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/products/${productId}/image-workbench`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            image: result,
            ...(selectedCandidateUrl ? { sourceUrl: selectedCandidateUrl } : {}),
          }),
        },
      );
      const body = (await response.json()) as { error?: string; url?: string };
      if (!response.ok) throw new Error(body.error || "저장에 실패했습니다.");
      setMessage(`승인 저장 완료: ${body.url}`);
      if (nextHref) router.replace(nextHref, { scroll: false });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "저장에 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };

  const lensUrl = referenceUrl
    ? `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(referenceUrl)}`
    : null;

  const openLens = () => {
    if (!lensUrl) return;
    waitingForLensClipboardRef.current = true;
    void navigator.clipboard
      .readText()
      .then((value) => {
        clipboardBeforeLensRef.current = value.trim();
      })
      .catch(() => {
        clipboardBeforeLensRef.current = "";
      });
    if (!lensSearchWindow || lensSearchWindow.closed)
      lensSearchWindow = window.open(lensUrl, "photocard-google-lens");
    else {
      try {
        lensSearchWindow.location.href = lensUrl;
      } catch {
        lensSearchWindow = window.open(lensUrl, "photocard-google-lens");
      }
    }
    lensSearchWindow?.focus();
  };

  const tryStoredPocamarketImage = () => {
    if (!referenceUrl) return;
    watermarkRemovalRunRef.current += 1;
    watermarkWorkerRef.current?.terminate();
    watermarkWorkerRef.current = null;
    watermarkRemovingRef.current = false;
    setWatermarkRemoving(false);
    pendingWatermarkRemovalRef.current = true;
    setCandidates((current) => current.some((item) => item.url === referenceUrl) ? current : [{ url: referenceUrl }, ...current]);
    loadCandidateUrl(referenceUrl, true);
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex justify-end">
        <LocalAiStatusBadge
          onEnabledChange={(enabled) => {
            localAiEnabledRef.current = enabled;
            setLocalAiEnabled(enabled);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            포토카드 이미지 작업
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Lens 후보를 선택하고 네 모서리를 찍어 카드 이미지를 추출합니다.
          </p>
          <p className="mt-1 text-xs font-semibold text-zinc-600">
            상태:{" "}
            {imageSource === "lens_workbench"
              ? "Lens 작업 완료"
              : imageSource === "r2_user_uploaded"
                ? "직접 촬영 완료"
                : "이미지 작업 전"}
          </p>
        </div>
        {lensUrl ? <div className="flex flex-wrap gap-2"><button type="button" onClick={tryStoredPocamarketImage} disabled={watermarkRemoving} className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:bg-zinc-300">{watermarkRemoving ? "워터마크 복원 중…" : "포카마켓 이미지 먼저 복원"}</button><button type="button" onClick={openLens} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Google Lens 후보 검색</button></div> : null}
      </div>
      {lensUrl ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"><div className="flex flex-wrap items-center gap-3"><label className="min-w-64 flex-1 text-xs font-semibold text-amber-950">워터마크 제거 강도 {watermarkStrength}%<input type="range" min="70" max="140" step="5" value={watermarkStrength} onChange={(event) => { const value = Number(event.target.value); watermarkStrengthRef.current = value; setWatermarkStrength(value); }} onPointerUp={tryStoredPocamarketImage} onKeyUp={tryStoredPocamarketImage} className="mt-1 block w-full" /></label><span className="text-[11px] text-amber-800">흰 흔적이 남으면 높이고 검은 자국이 생기면 낮추세요. 슬라이더를 놓으면 원본으로 자동 재복원됩니다.</span></div></div> : null}
      <div
        className="mt-4 flex gap-2"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (file) {
            loadCandidateFile(file);
            return;
          }
          importCandidateUrl(
            event.dataTransfer.getData("text/uri-list") ||
              event.dataTransfer.getData("text/plain"),
          );
        }}
      >
        <input
          value={candidateUrl}
          onChange={(event) => setCandidateUrl(event.target.value)}
          onPaste={(event) => {
            const value = event.clipboardData.getData("text");
            if (/^https?:\/\//i.test(value.trim())) {
              event.preventDefault();
              importCandidateUrl(value);
            }
          }}
          placeholder="주소를 붙여넣으면 바로 가져옵니다 · 이미지 드래그 가능"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={importFromClipboard}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700"
        >
          클립보드
        </button>
        <button
          type="button"
          onClick={loadCandidate}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
        >
          후보 가져오기
        </button>
        <label className="cursor-pointer whitespace-nowrap rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">
          컴퓨터 이미지 선택
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              loadCandidateFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {candidates.length ? (
        <div className="mt-3 rounded-md border bg-zinc-50 p-3">
          <strong className="mb-2 block text-sm">후보 이미지 {candidates.length}장</strong>
          <div className="flex gap-2 overflow-x-auto">
            {candidates.map((item, index) => (
              <button
                type="button"
                key={item.url}
                onClick={() => loadCandidateUrl(item.url)}
                className="w-40 shrink-0 rounded border bg-white p-2 text-left text-xs"
              >
                <img
                  src={`/api/products/${productId}/image-workbench?url=${encodeURIComponent(item.url)}`}
                  alt={`후보 ${index + 1}`}
                  className="mb-2 h-40 w-full rounded bg-zinc-100 object-contain"
                />
                <span className="block font-semibold">
                  후보 {index + 1}
                  {item.score !== undefined
                    ? ` · ${Math.round(item.score * 100)}점`
                    : ""}
                </span>
                <span className="mt-1 block line-clamp-2 text-zinc-500">
                  {item.reason ?? item.url}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="mt-3 break-all text-sm text-zinc-600">{message}</p>
      ) : null}
      {loadedUrl ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <strong>후보 이미지 · 대각선으로 드래그해 사각형 만들기</strong>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={undoPoints}
                  disabled={!pointHistory.length}
                  className="font-semibold text-violet-700 underline disabled:opacity-30"
                >
                  되돌리기 (Ctrl+Z)
                </button>
                <button
                  type="button"
                  onClick={clearPoints}
                  className="text-zinc-600 underline"
                >
                  점 초기화
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={removePocamarketWatermark}
              disabled={watermarkRemoving || watermarkRemoved || autoDetecting}
              className="mb-2 mr-3 rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-zinc-300"
            >
              {watermarkRemoving ? "워터마크 제거 중…" : watermarkRemoved ? "워터마크 제거 적용됨" : "포카마켓 워터마크 제거"}
            </button>
            <button
              type="button"
              onClick={autoDetect}
              className={`mb-2 mr-3 rounded px-3 py-1.5 text-xs font-semibold text-white ${autoDetecting ? "bg-red-600" : "bg-violet-700"}`}
            >
              {autoDetecting ? "자동 탐지 취소" : "OpenCV 자동 모서리 탐지"}
            </button>
            <div className="mx-auto flex h-[clamp(440px,58vw,680px)] w-full items-center justify-center overflow-auto rounded-md bg-zinc-100 xl:h-[620px]">
              <canvas
                ref={canvasRef}
                {...canvasHandlers}
                style={{ touchAction: "none" }}
                className="block h-auto max-h-full max-w-full cursor-crosshair rounded-md border"
              />
            </div>
            <button
              type="button"
              onClick={crop}
              disabled={points.length !== 4}
              className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              네 점 기준 카드 추출
            </button>
          </div>
          <div>
            <strong className="mb-2 block text-sm">추출 결과</strong>
            <div className="mb-2 flex h-[30px] items-center text-xs text-zinc-500">
              왼쪽 네 점을 조정한 뒤 카드 추출을 누르면 바로 비교됩니다.
            </div>
            <div className="mb-3 flex h-[clamp(440px,58vw,680px)] items-center justify-center rounded-md border bg-zinc-100 p-3 xl:h-[620px]">
              {result ? (
                <img
                  src={result}
                  alt="추출 결과"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-sm text-zinc-400">
                  네 점을 모두 찍고 추출하세요.
                </span>
              )}
            </div>
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-sm text-zinc-900">
                  자동 사진 보정
                </strong>
                <span className="text-[11px] font-medium text-emerald-700">
                  {settingsSaving ? "설정 저장 중…" : "계정에 자동 저장"}
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <label className="text-xs font-medium text-zinc-700">
                  밝기 {brightness > 0 ? "+" : ""}
                  {brightness}%
                  <input
                    type="range"
                    min="-20"
                    max="30"
                    value={brightness}
                    onChange={(event) =>
                      setBrightness(Number(event.target.value))
                    }
                    className="mt-1 block w-full"
                  />
                </label>
                <label className="text-xs font-medium text-zinc-700">
                  대비 {contrast > 0 ? "+" : ""}
                  {contrast}%
                  <input
                    type="range"
                    min="-30"
                    max="30"
                    value={contrast}
                    onChange={(event) =>
                      setContrast(Number(event.target.value))
                    }
                    className="mt-1 block w-full"
                  />
                </label>
                <label className="text-xs font-medium text-zinc-700">
                  채도 {saturation > 0 ? "+" : ""}
                  {saturation}%
                  <input
                    type="range"
                    min="-30"
                    max="40"
                    value={saturation}
                    onChange={(event) =>
                      setSaturation(Number(event.target.value))
                    }
                    className="mt-1 block w-full"
                  />
                </label>
                <label className="text-xs font-medium text-zinc-700">
                  선명도 +{sharpness}%
                  <input type="range" min="0" max="30" value={sharpness} onChange={(event) => setSharpness(Number(event.target.value))} className="mt-1 block w-full" />
                </label>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBrightness(8);
                  setContrast(3);
                  setSaturation(5);
                  setSharpness(12);
                }}
                className="mt-2 text-xs font-semibold text-amber-900 underline"
              >
                권장값으로 초기화
              </button>
            </div>
            <div className="mb-3 rounded-md border bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
                  배경 이미지 선택
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) =>
                      loadBackground(event.target.files?.[0])
                    }
                  />
                </label>
                {backgroundImage ? (
                  <button
                    type="button"
                    onClick={() => setBackgroundImage(null)}
                    className="rounded border px-3 py-1.5 text-xs font-semibold text-zinc-700"
                  >
                    배경 제거
                  </button>
                ) : (
                  <span className="text-xs text-zinc-500">
                    배경 없이 카드만 저장됩니다.
                  </span>
                )}
              </div>
              {backgroundImage ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-zinc-700">
                    카드 크기 {cardScale}%
                    <input
                      type="range"
                      min="30"
                      max="95"
                      value={cardScale}
                      onChange={(event) =>
                        setCardScale(Number(event.target.value))
                      }
                      className="mt-1 block w-full"
                    />
                  </label>
                  <label className="text-xs font-medium text-zinc-700">
                    그림자 농도 {shadowOpacity}%
                    <input
                      type="range"
                      min="0"
                      max="80"
                      value={shadowOpacity}
                      onChange={(event) =>
                        setShadowOpacity(Number(event.target.value))
                      }
                      className="mt-1 block w-full"
                    />
                  </label>
                  <label className="text-xs font-medium text-zinc-700">
                    그림자 가로 {shadowX}px
                    <input
                      type="range"
                      min="-60"
                      max="60"
                      value={shadowX}
                      onChange={(event) =>
                        setShadowX(Number(event.target.value))
                      }
                      className="mt-1 block w-full"
                    />
                  </label>
                  <label className="text-xs font-medium text-zinc-700">
                    그림자 세로 {shadowY}px
                    <input
                      type="range"
                      min="-60"
                      max="60"
                      value={shadowY}
                      onChange={(event) =>
                        setShadowY(Number(event.target.value))
                      }
                      className="mt-1 block w-full"
                    />
                  </label>
                  <label className="text-xs font-medium text-zinc-700 sm:col-span-2">
                    그림자 흐림 {shadowBlur}px
                    <input
                      type="range"
                      min="0"
                      max="80"
                      value={shadowBlur}
                      onChange={(event) =>
                        setShadowBlur(Number(event.target.value))
                      }
                      className="mt-1 block w-full"
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={save}
              disabled={!result || saving}
              className="mt-3 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {saving
                ? "저장 중..."
                : nextHref
                  ? "승인 저장 후 다음 상품"
                  : "승인하고 eBay 이미지로 저장"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
