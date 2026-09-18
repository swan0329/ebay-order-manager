"use client";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { detectCardBounds, distance, normalizeFourCorners, type Point } from "@/lib/card-crop";

/** 손잡이를 잡았다고 볼 거리. 화면 배율에 맞춰 환산한다. */
const HANDLE_RADIUS = 64;
const AUTO_DETECT_TIMEOUT = 15_000;

function clampCanvasPoint(point: Point, canvas: HTMLCanvasElement): Point {
  return {
    x: Math.max(0, Math.min(canvas.width - 1, point.x)),
    y: Math.max(0, Math.min(canvas.height - 1, point.y)),
  };
}

/**
 * 카드 네 모서리를 고르는 방식. 이미지 작업대와 AI 이미지 작업이 같은 조작을 쓰도록
 * 한곳에 모아 둔다. 두 화면이 따로 구현하면 손에 익은 방식이 화면마다 달라진다.
 *
 * - 빈 곳에서 대각선으로 끌면 네 모서리가 한 번에 만들어진다.
 * - 모서리 손잡이를 끌면 그 점만 움직인다.
 * - 네 점이 있을 때 누르면 가장 가까운 점이 그 자리로 온다.
 * - OpenCV가 외곽선을 찾아 주고, 실패하면 기본 경계를 놓아 준다.
 * - 되돌리기(Ctrl+Z)로 직전 점 배치로 돌아간다.
 */
export function useCardCorners({
  canvasRef,
  imageRef,
  onChange,
  onMessage,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  /** 점이 바뀌면 알려 준다. 이전에 만든 결과를 지우는 데 쓴다. */
  onChange?: () => void;
  onMessage?: (message: string) => void;
}) {
  const [points, setPoints] = useState<Point[]>([]);
  const [pointHistory, setPointHistory] = useState<Point[][]>([]);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const draggingPointRef = useRef<number | null>(null);
  const rectangleStartRef = useRef<Point | null>(null);
  const rectangleHistoryRecordedRef = useRef(false);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const autoDetectAttemptRef = useRef(0);
  const autoDetectWorkerRef = useRef<Worker | null>(null);
  const changed = () => onChange?.();
  const say = (message: string) => onMessage?.(message);

  // 지금 점 배치를 기록해 둔다. 되돌리기는 여기에 쌓인 것을 하나씩 꺼낸다.
  const rememberPoints = () =>
    setPointHistory((history) => [...history.slice(-49), points.map((point) => ({ ...point }))]);

  const undoPoints = () => {
    setPointHistory((history) => {
      const previous = history[history.length - 1];
      if (previous) {
        setPoints(previous);
        changed();
      }
      return previous ? history.slice(0, -1) : history;
    });
  };

  /** 새 그림을 올릴 때처럼 기록까지 지우고 처음으로 돌린다. */
  const resetPoints = () => {
    setPoints([]);
    setPointHistory([]);
  };

  const clearPoints = () => {
    rememberPoints();
    setPoints([]);
    changed();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault();
      undoPoints();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // 되돌리기는 지금 화면의 기록을 쓴다. 다시 그릴 때마다 새로 건다.
  });

  useEffect(
    () => () => {
      autoDetectWorkerRef.current?.terminate();
      autoDetectWorkerRef.current = null;
    },
    [],
  );

  const pointerCanvasPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return clampCanvasPoint(
      {
        x: ((event.clientX - bounds.left) * event.currentTarget.width) / bounds.width,
        y: ((event.clientY - bounds.top) * event.currentTarget.height) / bounds.height,
      },
      event.currentTarget,
    );
  };

  const startPointDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pointerCanvasPoint(event);
    const bounds = event.currentTarget.getBoundingClientRect();
    let nearest = 0;
    for (let index = 1; index < points.length; index += 1)
      if (distance(points[index], point) < distance(points[nearest], point)) nearest = index;
    if (
      points.length &&
      distance(points[nearest], point) <=
        (HANDLE_RADIUS * event.currentTarget.width) / bounds.width
    ) {
      rememberPoints();
      draggingPointRef.current = nearest;
      rectangleStartRef.current = null;
      dragMovedRef.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.style.cursor = "grabbing";
      setPoints((current) => current.map((item, index) => (index === nearest ? point : item)));
      changed();
      event.preventDefault();
      return;
    }
    // 모서리에서 떨어진 곳에서 시작하면 사각형 만들기다. 대각선으로 끌면 네 모서리가
    // 한 번에 생기고, 그 뒤에 손잡이로 하나씩 맞추면 된다.
    rectangleStartRef.current = point;
    rectangleHistoryRecordedRef.current = false;
    dragMovedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePointDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    const index = draggingPointRef.current;
    const point = pointerCanvasPoint(event);
    const rectangleStart = rectangleStartRef.current;
    if (index === null && rectangleStart) {
      if (distance(rectangleStart, point) < 3) return;
      if (!rectangleHistoryRecordedRef.current) {
        rememberPoints();
        rectangleHistoryRecordedRef.current = true;
      }
      const left = Math.min(rectangleStart.x, point.x);
      const right = Math.max(rectangleStart.x, point.x);
      const top = Math.min(rectangleStart.y, point.y);
      const bottom = Math.max(rectangleStart.y, point.y);
      setPoints([
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ]);
      dragMovedRef.current = true;
      changed();
      return;
    }
    if (index === null) return;
    event.preventDefault();
    dragMovedRef.current = true;
    setPoints((current) => current.map((item, order) => (order === index ? point : item)));
    changed();
  };

  const stopPointDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    draggingPointRef.current = null;
    event.currentTarget.style.cursor = "crosshair";
    rectangleStartRef.current = null;
    rectangleHistoryRecordedRef.current = false;
    suppressClickRef.current = dragMovedRef.current;
  };

  const addPoint = (event: MouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // 누르는 것은 이미 있는 모서리를 옮기는 것뿐이다. 네 모서리를 만드는 것은
    // 빈 곳에서 끄는 동작으로만 한다.
    if (points.length !== 4) return;
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const point = clampCanvasPoint(
      {
        x: ((event.clientX - bounds.left) * canvas.width) / bounds.width,
        y: ((event.clientY - bounds.top) * canvas.height) / bounds.height,
      },
      canvas,
    );
    rememberPoints();
    setPoints((current) => {
      let nearest = 0;
      for (let index = 1; index < current.length; index += 1)
        if (distance(current[index], point) < distance(current[nearest], point)) nearest = index;
      return current.map((existing, index) => (index === nearest ? point : existing));
    });
    changed();
  };

  const autoDetect = () => {
    if (autoDetecting) {
      autoDetectAttemptRef.current += 1;
      autoDetectWorkerRef.current?.terminate();
      autoDetectWorkerRef.current = null;
      setAutoDetecting(false);
      say("자동 모서리 탐지를 취소했습니다.");
      return;
    }
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const attempt = ++autoDetectAttemptRef.current;
    setAutoDetecting(true);
    say("OpenCV가 카드 외곽선을 분석하는 중입니다...");
    const fail = (error: string) => {
      if (attempt !== autoDetectAttemptRef.current) return;
      rememberPoints();
      setPoints(normalizeFourCorners(detectCardBounds(canvas), canvas.width, canvas.height) ?? []);
      changed();
      say(`${error} 기본 경계를 표시했습니다. 손잡이를 직접 끌어 맞춰 주세요.`);
      setAutoDetecting(false);
      autoDetectWorkerRef.current?.terminate();
      autoDetectWorkerRef.current = null;
    };
    const detectionCanvas = document.createElement("canvas");
    detectionCanvas.width = canvas.width;
    detectionCanvas.height = canvas.height;
    const context = detectionCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) return fail("이미지를 분석할 수 없습니다.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const worker = new Worker("/opencv-card-worker.js");
    autoDetectWorkerRef.current = worker;
    const timeout = window.setTimeout(
      () => fail("자동 탐지 시간이 초과됐습니다."),
      AUTO_DETECT_TIMEOUT,
    );
    worker.onerror = () => {
      window.clearTimeout(timeout);
      fail("자동 탐지 모듈을 불러오지 못했습니다.");
    };
    worker.onmessage = (
      event: MessageEvent<{
        ok: boolean;
        points?: Point[];
        confidence?: number;
        error?: string;
      }>,
    ) => {
      window.clearTimeout(timeout);
      if (attempt !== autoDetectAttemptRef.current) return;
      if (!event.data.ok || !event.data.points)
        return fail(event.data.error ?? "자동 탐지에 실패했습니다.");
      const normalized = normalizeFourCorners(event.data.points, canvas.width, canvas.height);
      if (!normalized) return fail("올바른 네 모서리를 찾지 못했습니다.");
      rememberPoints();
      setPoints(normalized);
      changed();
      say(
        `OpenCV 자동 탐지 완료 · 신뢰도 ${Math.round(
          (event.data.confidence ?? 0) * 100,
        )}%. 손잡이를 끌어서 미세 조정하세요.`,
      );
      setAutoDetecting(false);
      worker.terminate();
      autoDetectWorkerRef.current = null;
    };
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    worker.postMessage({ imageData }, [imageData.data.buffer]);
    changed();
  };

  return {
    points,
    setPoints,
    pointHistory,
    rememberPoints,
    undoPoints,
    clearPoints,
    resetPoints,
    autoDetect,
    autoDetecting,
    canvasHandlers: {
      onClick: addPoint,
      onPointerDown: startPointDrag,
      onPointerMove: movePointDrag,
      onPointerUp: stopPointDrag,
      onPointerCancel: stopPointDrag,
    },
  };
}
