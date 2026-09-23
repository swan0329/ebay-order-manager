"""Small local test GUI for the reusable Real-ESRGAN engine."""

from __future__ import annotations

import logging
import queue
import threading
import traceback
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, X, Canvas, IntVar, StringVar, Tk, filedialog, messagebox
from tkinter import ttk

from PIL import Image, ImageTk

from enhancer.engine import MODELS, SUPPORTED_EXTENSIONS, EnhancementError, enhance_image, get_gpu_status

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR, LOG_DIR = ROOT / "output", ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(
    filename=LOG_DIR / "enhancer.log", level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8"
)


class EnhancerApp:
    def __init__(self, root: Tk) -> None:
        self.root, self.events = root, queue.Queue()
        self.input_path: Path | None = None
        self.input_folder: Path | None = None
        self.model = StringVar(value="RealESRGAN_x2plus")
        self.scale = StringVar(value="2")
        self.strength = IntVar(value=55)
        self.strength_text = StringVar(value="55%")
        self.status = StringVar(value="이미지 또는 폴더를 선택하세요.")
        self.gpu_text = StringVar(value=str(get_gpu_status()["message"]))
        self.time_text = StringVar(value="처리 시간: -")
        self.output_text = StringVar(value=f"저장 위치: {OUTPUT_DIR}")
        self.progress_text = StringVar(value="완료: 0 / 0")
        self._original_photo = self._result_photo = None
        self._build()
        self._poll_events()

    def _build(self) -> None:
        self.root.title("Photo Card Real-ESRGAN - Local Test")
        self.root.minsize(920, 700)
        outer = ttk.Frame(self.root, padding=12); outer.pack(fill=BOTH, expand=True)
        controls = ttk.Frame(outer); controls.pack(fill=X)
        ttk.Button(controls, text="이미지 선택", command=self.select_image).pack(side=LEFT, padx=(0, 6))
        ttk.Button(controls, text="폴더 선택", command=self.select_folder).pack(side=LEFT, padx=6)
        ttk.Label(controls, text="모델").pack(side=LEFT, padx=(18, 5))
        model_box = ttk.Combobox(controls, textvariable=self.model, values=list(MODELS), state="readonly", width=23)
        model_box.pack(side=LEFT); model_box.bind("<<ComboboxSelected>>", self._model_changed)
        ttk.Label(controls, text="배율").pack(side=LEFT, padx=(14, 5))
        ttk.Combobox(controls, textvariable=self.scale, values=["2", "4"], state="readonly", width=4).pack(side=LEFT)
        ttk.Label(controls, text="AI 보정").pack(side=LEFT, padx=(14, 5))
        ttk.Scale(controls, from_=0, to=100, variable=self.strength, command=self._strength_changed, length=105).pack(side=LEFT)
        ttk.Label(controls, textvariable=self.strength_text, width=4).pack(side=LEFT, padx=(4, 0))
        self.run_button = ttk.Button(controls, text="실행", command=self.run); self.run_button.pack(side=RIGHT)
        ttk.Label(outer, textvariable=self.gpu_text).pack(anchor="w", pady=(8, 0))
        ttk.Label(outer, textvariable=self.status, foreground="#006400").pack(anchor="w", pady=(10, 2))
        ttk.Label(outer, textvariable=self.progress_text).pack(anchor="w")
        previews = ttk.Frame(outer); previews.pack(fill=BOTH, expand=True, pady=10)
        left = ttk.Labelframe(previews, text="원본"); left.pack(side=LEFT, fill=BOTH, expand=True, padx=(0, 5))
        right = ttk.Labelframe(previews, text="개선 결과"); right.pack(side=RIGHT, fill=BOTH, expand=True, padx=(5, 0))
        self.original_canvas = Canvas(left, background="#252525", highlightthickness=0); self.original_canvas.pack(fill=BOTH, expand=True)
        self.result_canvas = Canvas(right, background="#252525", highlightthickness=0); self.result_canvas.pack(fill=BOTH, expand=True)
        ttk.Label(outer, textvariable=self.time_text).pack(anchor="w")
        ttk.Label(outer, textvariable=self.output_text, wraplength=880).pack(anchor="w", pady=(2, 8))
        log_box = ttk.Labelframe(outer, text="로그 / 오류"); log_box.pack(fill=X)
        self.log = ttk.Entry(log_box); self.log.pack(fill=X, padx=6, pady=6)

    def _model_changed(self, _event=None) -> None:
        maximum = MODELS[self.model.get()]["scale"]
        if int(self.scale.get()) > maximum:
            self.scale.set(str(maximum))

    def _strength_changed(self, _value: str) -> None:
        self.strength_text.set(f"{self.strength.get()}%")

    def _set_log(self, text: str) -> None:
        self.log.delete(0, END); self.log.insert(0, text)
        logging.info(text)

    def select_image(self) -> None:
        choice = filedialog.askopenfilename(filetypes=[("Images", "*.png *.jpg *.jpeg *.webp")])
        if choice:
            self.input_path, self.input_folder = Path(choice), None
            self.status.set(f"선택: {self.input_path.name}")
            self._show(self.original_canvas, self.input_path, "original")
            self._set_log(f"이미지 선택: {self.input_path}")

    def select_folder(self) -> None:
        choice = filedialog.askdirectory()
        if choice:
            self.input_folder, self.input_path = Path(choice), None
            count = len(self._folder_images())
            self.status.set(f"폴더 선택: {self.input_folder} ({count}개 이미지)")
            self._set_log(f"폴더 선택: {self.input_folder}")

    def _folder_images(self) -> list[Path]:
        return sorted(p for p in self.input_folder.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS) if self.input_folder else []

    def run(self) -> None:
        files = [self.input_path] if self.input_path else self._folder_images()
        if not files:
            messagebox.showwarning("입력 필요", "처리할 이미지 또는 이미지가 들어 있는 폴더를 선택하세요.")
            return
        status = get_gpu_status()
        if not status["available"]:
            messagebox.showerror("CUDA 필요", str(status["message"]))
            self._set_log(str(status["message"]))
            return
        self.run_button.configure(state="disabled")
        self.progress_text.set(f"완료: 0 / {len(files)}")
        threading.Thread(target=self._worker, args=(files,), daemon=True).start()

    def _worker(self, files: list[Path]) -> None:
        completed = 0
        try:
            for source in files:
                model, scale, strength = self.model.get(), int(self.scale.get()), self.strength.get()
                output = OUTPUT_DIR / source.parent.name / f"{source.stem}_{model}_{scale}x_s{strength}{source.suffix.lower()}"
                result = enhance_image(source, output, model, scale, {"models_dir": ROOT / "models", "strength": strength})
                completed += 1
                self.events.put(("done", result, completed, len(files)))
            self.events.put(("finished", completed, len(files)))
        except Exception as error:
            logging.error("Processing failed\n%s", traceback.format_exc())
            self.events.put(("error", str(error), completed, len(files)))

    def _poll_events(self) -> None:
        try:
            while True:
                event = self.events.get_nowait()
                kind = event[0]
                if kind == "done":
                    result, done, total = event[1:]
                    self.progress_text.set(f"완료: {done} / {total}")
                    self.time_text.set(f"처리 시간(최근 파일): {result.elapsed_seconds:.2f}초 | {result.input_size} → {result.output_size}")
                    self.output_text.set(f"저장 위치: {result.output_path}")
                    self._set_log(f"완료: {result.output_path.name} ({result.elapsed_seconds:.2f}초, AI 보정 {result.strength}%, tile={result.tile})")
                    if total == 1:
                        self._show(self.result_canvas, result.output_path, "result")
                elif kind == "finished":
                    done, total = event[1:]
                    self.status.set(f"처리 완료: {done} / {total}")
                    self.run_button.configure(state="normal")
                else:
                    detail, done, total = event[1:]
                    self.status.set(f"오류: {detail}"); self.progress_text.set(f"완료: {done} / {total}")
                    self._set_log(f"오류: {detail}"); self.run_button.configure(state="normal")
                    messagebox.showerror("처리 오류", detail)
        except queue.Empty:
            pass
        self.root.after(150, self._poll_events)

    def _show(self, canvas: Canvas, path: Path, target: str) -> None:
        try:
            with Image.open(path) as image:
                image.thumbnail((420, 520), Image.Resampling.LANCZOS)
                photo = ImageTk.PhotoImage(image.copy())
            canvas.delete("all")
            canvas.create_image(210, 260, image=photo)
            if target == "original": self._original_photo = photo
            else: self._result_photo = photo
        except Exception as error:
            self._set_log(f"미리보기 오류: {error}")


if __name__ == "__main__":
    window = Tk()
    EnhancerApp(window)
    window.mainloop()
