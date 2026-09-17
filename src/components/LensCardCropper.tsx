"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  detectCardBounds,
  normalizeFourCorners,
  roundCanvasCorners,
  seamlessQuadrilateralCrop,
  type Point,
} from "@/lib/card-crop";

const CANVAS_WIDTH = 720;

/**
 * 구글렌즈에서 찾은 사진에는 배경과 다른 물건이 함께 들어 있다. 카드 네 모서리를
 * 찍어 카드만 뽑아내야 상품 이미지로 쓸 수 있다. 이미지 작업대와 같은 계산을 쓴다.
 */
export function LensCardCropper({
  productId,
  imageUrl,
  local = false,
  onCancel,
  onCropped,
}: {
  productId: string;
  imageUrl: string;
  /** 붙여넣은 이미지처럼 이미 우리 쪽에 있는 그림이면 프록시를 거치지 않는다. */
  local?: boolean;
  onCancel: () => void;
  onCropped: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [status, setStatus] = useState("이미지를 불러오는 중입니다…");
  const [ready, setReady] = useState(false);

  const draw = useCallback((corners: Point[]) => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (corners.length) {
      context.strokeStyle = "#7c3aed";
      context.lineWidth = 2;
      context.beginPath();
      corners.forEach((point, index) =>
        index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y),
      );
      if (corners.length === 4) context.closePath();
      context.stroke();
      corners.forEach((point, index) => {
        context.fillStyle = "#7c3aed";
        context.beginPath();
        context.arc(point.x, point.y, 7, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#ffffff";
        context.font = "bold 11px sans-serif";
        context.fillText(String(index + 1), point.x - 3, point.y + 4);
      });
    }
  }, []);

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
      const detected = detectCardBounds(canvas) ?? [];
      const context = canvas.getContext("2d");
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const guess = detected.length === 4 ? detected : [];
      setPoints(guess);
      draw(guess);
      setStatus(
        guess.length
          ? "자동으로 잡은 네 모서리입니다. 점을 눌러 옮기거나 다시 찍어 주세요."
          : "카드의 네 모서리를 차례로 눌러 주세요.",
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
  }, [productId, imageUrl, local, draw]);

  const addPoint = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
    setPoints((current) => {
      // 네 점을 다 찍었으면 가장 가까운 점을 옮긴다.
      if (current.length >= 4) {
        let nearest = 0;
        current.forEach((item, index) => {
          if (
            Math.hypot(item.x - point.x, item.y - point.y) <
            Math.hypot(current[nearest].x - point.x, current[nearest].y - point.y)
          )
            nearest = index;
        });
        const moved = current.map((item, index) => (index === nearest ? point : item));
        draw(moved);
        return moved;
      }
      const next = [...current, point];
      draw(next);
      return next;
    });
  };

  const crop = () => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const ordered = normalizeFourCorners(points, canvas.width, canvas.height);
    if (!ordered) {
      setStatus("서로 떨어진 네 점으로 사각형을 만들어 주세요.");
      return;
    }
    const scaleX = image.naturalWidth / canvas.width;
    const scaleY = image.naturalHeight / canvas.height;
    const source = ordered.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })) as [Point, Point, Point, Point];
    const measured = Math.max(
      Math.hypot(source[0].x - source[3].x, source[0].y - source[3].y),
      Math.hypot(source[1].x - source[2].x, source[1].y - source[2].y),
    );
    // 실제 포토카드 비율(54×86mm)로 고정한다. 선택이 조금 비뚤어도 늘어나지 않는다.
    const height = Math.max(860, Math.min(1720, Math.round(measured)));
    const width = Math.round(height * (54 / 86));
    const output = seamlessQuadrilateralCrop(image, source, width, height);
    if (!output) {
      setStatus("카드를 잘라내지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    roundCanvasCorners(output, Math.round(width * 0.045));
    onCropped(output.toDataURL("image/png"));
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
          <strong>구글렌즈 후보에서 카드 잘라내기</strong>
          <span className="text-sm text-zinc-500">{status}</span>
          <span className="ml-auto text-sm font-semibold text-violet-800">
            찍은 점 {Math.min(points.length, 4)}/4
          </span>
        </div>
        <canvas
          ref={canvasRef}
          onClick={addPoint}
          className="mt-3 w-full cursor-crosshair rounded border bg-zinc-100"
        />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPoints([]);
              draw([]);
              setStatus("카드의 네 모서리를 차례로 눌러 주세요.");
            }}
            className="cursor-pointer rounded border px-4 py-2 font-semibold hover:bg-zinc-50"
          >
            다시 찍기
          </button>
          <button
            type="button"
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const detected = detectCardBounds(canvas) ?? [];
              setPoints(detected);
              draw(detected);
              setStatus(
                detected.length === 4
                  ? "자동으로 네 모서리를 다시 잡았습니다."
                  : "자동으로 찾지 못했습니다. 직접 눌러 주세요.",
              );
            }}
            className="cursor-pointer rounded border px-4 py-2 font-semibold hover:bg-zinc-50"
          >
            자동 모서리 찾기
          </button>
          <button
            type="button"
            disabled={points.length !== 4}
            onClick={crop}
            className="cursor-pointer rounded bg-violet-700 px-5 py-2 font-bold text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            이 영역으로 교체
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
