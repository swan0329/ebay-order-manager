import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--base-mask", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--blend", type=float, default=0.05)
    args = parser.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    with Image.open(args.base_mask) as opened_mask:
        base_image = opened_mask.convert("L")
    size = base_image.size
    base_mask = np.asarray(base_image, dtype=np.float32)

    alpha_samples: list[np.ndarray] = []
    for pair in manifest.get("pairs", []):
        if not pair.get("valid") or pair.get("split") != "train":
            continue
        with Image.open(pair["before"]) as opened_source:
            source = np.asarray(
                ImageOps.exif_transpose(opened_source)
                .convert("RGB")
                .resize(size, Image.Resampling.LANCZOS),
                dtype=np.float32,
            )
        with Image.open(pair["after"]) as opened_target:
            target = np.asarray(
                ImageOps.exif_transpose(opened_target)
                .convert("RGB")
                .resize(size, Image.Resampling.LANCZOS),
                dtype=np.float32,
            )
        denominator = np.maximum(255.0 - target, 20.0)
        alpha = np.median((source - target) / denominator, axis=2)
        alpha_samples.append(np.clip(alpha, 0.0, 0.44))

    if len(alpha_samples) < 20:
        raise RuntimeError("At least 20 valid training pairs are required.")

    fitted_mask = np.median(np.stack(alpha_samples), axis=0) * 255.0
    # Only strengthen pixels for which the paired samples repeatedly show a
    # pale residual. Never weaken the already validated V4 core.
    strengthened = np.maximum(base_mask, fitted_mask)
    candidate = base_mask + (strengthened - base_mask) * args.blend
    output = Image.fromarray(
        np.clip(candidate, 0, 255).round().astype(np.uint8),
        "L",
    )
    output.save(args.output, optimize=True)
    print(
        json.dumps(
            {
                "trainingPairs": len(alpha_samples),
                "blend": args.blend,
                "changedFraction": float(np.mean(candidate > base_mask + 0.01)),
                "output": str(Path(args.output).resolve()),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
