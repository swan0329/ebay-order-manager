"""Generate A/B/C comparison outputs for the first sample image (or a supplied file)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from enhancer.engine import copy_original, enhance_image


def main() -> None:
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="A/B/C Real-ESRGAN comparison")
    parser.add_argument("image", nargs="?", type=Path, default=root / "test_images" / "1.jpg")
    args = parser.parse_args()
    source = args.image.resolve()
    destination = root / "output" / "comparisons" / source.stem
    suffix = source.suffix.lower()
    original = copy_original(source, destination / f"A_original{suffix}")
    # A/B/C is an engine comparison, so retain the full model effect here.
    x2 = enhance_image(source, destination / f"B_RealESRGAN_x2plus{suffix}", "RealESRGAN_x2plus", 2, {"strength": 100})
    x4 = enhance_image(source, destination / f"C_RealESRGAN_x4plus{suffix}", "RealESRGAN_x4plus", 4, {"strength": 100})
    record = {
        "source": str(source),
        "A_original": {"path": str(original), "size": list(x2.input_size), "elapsed_seconds": 0},
        "B_RealESRGAN_x2plus": {"path": str(x2.output_path), "size": list(x2.output_size), "elapsed_seconds": round(x2.elapsed_seconds, 2)},
        "C_RealESRGAN_x4plus": {"path": str(x4.output_path), "size": list(x4.output_size), "elapsed_seconds": round(x4.elapsed_seconds, 2)},
    }
    (destination / "comparison.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
