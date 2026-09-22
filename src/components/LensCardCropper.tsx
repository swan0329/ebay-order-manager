"use client";
import { useEffect, useRef, useState } from "react";
import {
  distance,
  normalizeFourCorners,
  roundCanvasCorners,
  seamlessQuadrilateralCrop,
  type Point,
} from "@/lib/card-crop";
import { useCardCorners } from "@/components/useCardCorners";

const CANVAS_WIDTH = 720;

/**
 * 구글렌즈에서 찾은 사진에는 배경과 다른 물건이 함께 들어 있다. 카드 네 모서리를
 * 찍어 카드만 뽑아내야 상품 이미지로 쓸 수 있다. 고르는 방식과 잘라내는 계산은
 * 이미지 작업대와 같은 것을 쓴다(`useCardCorners`, `card-crop`).
 */
export function LensCardCropper({
  productId,
  imageUrl,
  local = false,
  onCancel,
  onCropped,
  initialCorners,
}: {
  productId: string;
  imageUrl: string;
  /** 붙여넣은 이미지처럼 이미 우리 쪽에 있는 그림이면 프록시를 거치지 않는다. */
  local?: boolean;
  onCancel: () => void;
  /**
   * 잘라낸 결과와 함께 원본·네 점을 돌려준다. 이것을 저장해 두어야 나중에 원본에서
   * 영역을 다시 잡을 수 있다.
   */
  onCropped: (
    dataUrl: string,
    source: { sourceImage: string; corners: Point[] },
  ) => void;
  /** 전에 찍었던 네 점(원본 대비 0~1 비율). 다시 잡을 때 그대로 띄운다. */
  initialCorners?: Point[] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [status, setStatus] = useState("이미지를 불러오는 중입니다…");
  const [ready, setReady] = useState(false);
  const {
    points,
    setPoints,
    pointHistory,
    undoPoints,
    clearPoints,
    autoDetect,
    autoDetecting,
    canvasHandlers,
  } = useCardCorners({ canvasRef, imageRef, onMessage: setStatus });

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    // 다른 도메인 이미지는 캔버스를 오염시켜 잘라낼 수 없다. 서버를 거쳐 받아온다.
    image.src = local
      ? imageUrl
      : `/api/products/${productId}/image-workbench?url=${encodeURIComponent(imageUrl)}`;
    image.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = CANVAS_WIDTH;
      canvas.height = Math.max(
        120,
        Math.round((image.naturalHeight / image.naturalWidth) * CANVAS_WIDTH),
      );
      imageRef.current = image;
      setReady(true);
      // 전에 찍은 점이 있으면 그대로 띄운다. 처음부터 다시 찍지 않아도 된다.
      const restored = (initialCorners ?? []).length === 4
        ? initialCorners!.map((point) => ({
            x: point.x * canvas.width,
            y: point.y * canvas.height,
          }))
        : [];
      setPoints(restored);
      setStatus(
        restored.length
          ? "전에 잡았던 영역입니다. 손잡이를 끌어 고친 뒤 다시 추출하세요."
          : "카드 영역을 대각선으로 끌어 사각형을 만드세요. 손잡이로 모서리를 맞춥니다.",
      );
    };
    image.onerror = () => {
      if (!cancelled)
        setStatus(
          "이미지를 불러오지 못했습니다. 붙여넣은 값이 이미지 주소가 아닐 수 있습니다. 렌즈 결과 사진에서 마우스 오른쪽 → '이미지 복사' 후 이 화면에서 Ctrl+V 해보세요.",
        );
    };
    return () => {
      cancelled = true;
    };
  }, [productId, imageUrl, local, setPoints, initialCorners]);

  // 점이 바뀔 때마다 다시 그린다. 이미지 작업대와 같은 모양의 손잡이를 쓴다.
  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
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
  }, [points, ready]);

  const crop = () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || points.length !== 4) return;
    const ordered = normalizeFourCorners(points, canvas.width, canvas.height);
    if (!ordered) {
      setStatus("네 모서리가 겹쳐 있습니다. 네 개의 서로 다른 점으로 사각형을 만들어 주세요.");
      return;
    }
    const scaleX = image.naturalWidth / canvas.width;
    const scaleY = image.naturalHeight / canvas.height;
    const source = ordered.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })) as [Point, Point, Point, Point];
    const measured = Math.max(distance(source[0], source[3]), distance(source[1], source[2]));
    // 실제 포토카드 비율(54×86mm)로 고정한다. 선택이 조금 비뚤어도 늘어나지 않는다.
    const height = Math.max(860, Math.min(1720, Math.round(measured)));
    const width = Math.round(height * (54 / 86));
    const output = seamlessQuadrilateralCrop(image, source, width, height);
    if (!output) {
      setStatus("카드를 잘라내지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    roundCanvasCorners(output, Math.round(width * 0.045));
    // 원본을 그대로 한 장 만들어 함께 넘긴다. 렌즈 주소는 나중에 사라질 수 있어
    // 주소만 적어 두면 다시 잡을 때 그림을 못 찾는다.
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    sourceCanvas.getContext("2d")?.drawImage(image, 0, 0);
    onCropped(output.toDataURL("image/png"), {
      sourceImage: sourceCanvas.toDataURL("image/jpeg", 0.92),
      corners: ordered.map((point) => ({
        x: point.x / canvas.width,
        y: point.y / canvas.height,
      })),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        className="max-h-full w-full max-w-4xl overflow-auto rounded-2xl bg-white p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2">
          <strong>구글렌즈 후보 · 대각선으로 드래그해 사각형 만들기</strong>
          <span className="ml-auto flex gap-3 text-sm">
            <button
              type="button"
              onClick={undoPoints}
              disabled={!pointHistory.length}
              className="cursor-pointer font-semibold text-violet-700 underline disabled:cursor-not-allowed disabled:opacity-30"
            >
              되돌리기 (Ctrl+Z)
            </button>
            <button
              type="button"
              onClick={clearPoints}
              className="cursor-pointer text-zinc-600 underline"
            >
              점 초기화
            </button>
          </span>
        </div>
        <p className="mt-1 break-all text-sm text-zinc-600">{status}</p>
        <button
          type="button"
          onClick={autoDetect}
          disabled={!ready}
          className={`mt-2 mb-2 cursor-pointer rounded px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 ${
            autoDetecting ? "bg-red-600" : "bg-violet-700"
          }`}
        >
          {autoDetecting ? "자동 탐지 취소" : "OpenCV 자동 모서리 탐지"}
        </button>
        {/*
          높이 한도를 캔버스에 직접 건다. 바깥 상자에 max-height만 주면 안쪽 canvas의
          max-h-full이 기준 높이를 찾지 못해 줄어들지 않는다. 그러면 세로로 긴 사진은
          원래 크기로 그려진 뒤 가운데만 남고 위아래가 잘려 확대된 것처럼 보이며,
          가운데 정렬 때문에 위쪽은 스크롤로도 닿지 않는다. vh는 언제나 기준이 있으므로
          사진 전체가 화면 안에 들어온다.
        */}
        <div className="mx-auto flex w-full justify-center rounded-md bg-zinc-100 p-1">
          <canvas
            ref={canvasRef}
            {...canvasHandlers}
            style={{ touchAction: "none" }}
            className="block h-auto max-h-[70vh] w-auto max-w-full cursor-crosshair rounded-md border"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={points.length !== 4}
            onClick={crop}
            className="cursor-pointer rounded bg-emerald-600 px-5 py-2 font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            네 점 기준 카드 추출
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 font-semibold text-white"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
