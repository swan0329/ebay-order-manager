"""Real-ESRGAN image enhancement engine, deliberately independent of the GUI."""

from __future__ import annotations

import gc
import shutil
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MODELS = {
    "RealESRGAN_x2plus": {
        "scale": 2,
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
    },
    "RealESRGAN_x4plus": {
        "scale": 4,
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
    },
    # Add 4x-UltraSharp.pth to models/ manually to make this option available.
    "4x-UltraSharp": {"scale": 4, "url": None},
}


class EnhancementError(RuntimeError):
    """A recoverable, user-facing enhancement error."""


@dataclass(frozen=True)
class EnhancementResult:
    input_path: Path
    output_path: Path
    model_name: str
    scale: int
    input_size: tuple[int, int]
    output_size: tuple[int, int]
    elapsed_seconds: float
    tile: int
    strength: int


def get_gpu_status() -> dict[str, str | bool]:
    """Return display-friendly CUDA status without failing when torch is absent."""
    try:
        import torch
    except ImportError:
        return {"available": False, "message": "PyTorch가 설치되지 않았습니다."}
    if not torch.cuda.is_available():
        return {
            "available": False,
            "message": "CUDA GPU를 찾지 못했습니다. CUDA용 PyTorch 설치와 NVIDIA 드라이버를 확인하세요.",
        }
    device = torch.cuda.get_device_properties(0)
    memory_gb = device.total_memory / 1024**3
    return {"available": True, "message": f"CUDA 사용 가능: {device.name} ({memory_gb:.1f} GB VRAM)"}


def _model_path(model_name: str, models_dir: Path) -> Path:
    if model_name not in MODELS:
        raise EnhancementError(f"지원하지 않는 모델입니다: {model_name}")
    path = models_dir / f"{model_name}.pth"
    if path.exists():
        return path
    url = MODELS[model_name]["url"]
    if not url:
        raise EnhancementError(
            f"{path.name} 파일을 models 폴더에 넣어 주세요. 이 모델은 자동 다운로드하지 않습니다."
        )
    models_dir.mkdir(parents=True, exist_ok=True)
    try:
        urllib.request.urlretrieve(url, path)
    except Exception as error:
        path.unlink(missing_ok=True)
        raise EnhancementError(f"모델 가중치 다운로드 실패: {error}") from error
    return path


def _create_upsampler(model_name: str, models_dir: Path, tile: int, tile_pad: int):
    try:
        import torch
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer
    except ImportError as error:
        raise EnhancementError("필수 패키지가 없습니다. install.bat을 먼저 실행하세요.") from error

    status = get_gpu_status()
    if not status["available"]:
        raise EnhancementError(str(status["message"]))
    model_scale = int(MODELS[model_name]["scale"])
    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=model_scale)
    # half precision saves VRAM on RTX cards. Face restoration is intentionally never used.
    return RealESRGANer(
        scale=model_scale,
        model_path=str(_model_path(model_name, models_dir)),
        model=model,
        tile=tile,
        tile_pad=tile_pad,
        pre_pad=0,
        half=torch.cuda.is_available(),
        gpu_id=0,
    )


def enhance_image(
    input_path: str | Path,
    output_path: str | Path,
    model_name: str = "RealESRGAN_x2plus",
    scale: int = 2,
    settings: dict[str, Any] | None = None,
) -> EnhancementResult:
    """Enhance one local image and write a *new* output file.

    This function never changes the input. `settings` accepts `strength` (0-100,
    default 55), which blends the AI result with a high-quality resized original.
    Lower values are more conservative for faces. It also accepts `tile` (default
    0, automatic retry at 256 on CUDA OOM) and `tile_pad` (default 10).
    """
    settings = settings or {}
    input_file, output_file = Path(input_path), Path(output_path)
    if not input_file.is_file() or input_file.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise EnhancementError("지원하는 입력 이미지(PNG/JPG/JPEG/WebP)를 선택하세요.")
    if scale not in (2, 4):
        raise EnhancementError("배율은 2 또는 4만 사용할 수 있습니다.")
    model_scale = int(MODELS.get(model_name, {}).get("scale", 0))
    if scale > model_scale:
        raise EnhancementError(f"{model_name}은(는) {model_scale}배 모델입니다.")

    models_dir = Path(settings.get("models_dir", Path(__file__).resolve().parents[1] / "models"))
    tile, tile_pad = int(settings.get("tile", 0)), int(settings.get("tile_pad", 10))
    strength = int(settings.get("strength", 55))
    if not 0 <= strength <= 100:
        raise EnhancementError("AI 보정 강도는 0~100 사이여야 합니다.")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter()
    with Image.open(input_file) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        input_size = image.size
        array = np.asarray(image)[:, :, ::-1].copy()  # RGB PIL -> BGR OpenCV convention

    try:
        upsampler = _create_upsampler(model_name, models_dir, tile, tile_pad)
        enhanced, _ = upsampler.enhance(array, outscale=scale)
    except EnhancementError:
        raise
    except RuntimeError as error:
        message = str(error).lower()
        if ("out of memory" not in message and "cuda" not in message) or tile:
            raise EnhancementError(f"GPU 처리 실패: {error}") from error
        # A safe retry for large images. It avoids an application crash on VRAM pressure.
        gc.collect()
        try:
            import torch
            torch.cuda.empty_cache()
            upsampler = _create_upsampler(model_name, models_dir, 256, tile_pad)
            enhanced, _ = upsampler.enhance(array, outscale=scale)
            tile = 256
        except Exception as retry_error:
            raise EnhancementError(f"VRAM이 부족합니다. 타일 256 재시도도 실패했습니다: {retry_error}") from retry_error
    except Exception as error:
        raise EnhancementError(f"이미지 처리 실패: {error}") from error

    ai_image = Image.fromarray(enhanced[:, :, ::-1])
    # Blend against a faithful Lanczos enlargement rather than adding a separate
    # sharpen filter. This preserves facial structure at lower strengths.
    base_image = image.resize(ai_image.size, Image.Resampling.LANCZOS)
    result_image = Image.blend(base_image, ai_image, strength / 100)
    save_kwargs: dict[str, Any] = {}
    if output_file.suffix.lower() in {".jpg", ".jpeg"}:
        save_kwargs = {"quality": int(settings.get("jpeg_quality", 95)), "subsampling": 0}
    elif output_file.suffix.lower() == ".webp":
        save_kwargs = {"quality": int(settings.get("webp_quality", 95)), "method": 6}
    result_image.save(output_file, **save_kwargs)
    return EnhancementResult(
        input_file, output_file, model_name, scale, input_size, result_image.size,
        time.perf_counter() - start, tile, strength
    )


def copy_original(input_path: str | Path, output_path: str | Path) -> Path:
    """Copy an original for side-by-side comparison; it never moves or edits it."""
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    return Path(shutil.copy2(input_path, destination))
