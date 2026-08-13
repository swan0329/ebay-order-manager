import sharp from "sharp";

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function readPairs() {
  const pairs = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--pair") continue;
    const before = process.argv[index + 1];
    const after = process.argv[index + 2];
    if (!before || !after) throw new Error("--pair requires BEFORE and AFTER paths.");
    pairs.push([before, after]);
    index += 2;
  }
  return pairs;
}

function median(values) {
  values.sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

async function readRgb(file, width, height) {
  return (
    await sharp(file)
      .rotate()
      .resize(width, height, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  ).data;
}

async function main() {
  const referencePath = readOption("--reference-mask");
  const outputPath = readOption("--output");
  const pairs = readPairs();
  if (!referencePath || !outputPath || pairs.length < 5) {
    throw new Error(
      "Usage: node script --reference-mask MASK --output OUTPUT --pair BEFORE AFTER (repeat at least 5 times)",
    );
  }

  const reference = await sharp(referencePath)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = reference.info;
  const pairAlpha = [];

  for (const [beforePath, afterPath] of pairs) {
    const [before, after] = await Promise.all([
      readRgb(beforePath, width, height),
      readRgb(afterPath, width, height),
    ]);
    const alpha = new Float32Array(width * height);
    for (let pixel = 0; pixel < alpha.length; pixel += 1) {
      if (reference.data[pixel] === 0) continue;
      const channelAlpha = [];
      for (let channel = 0; channel < 3; channel += 1) {
        const offset = pixel * 3 + channel;
        const denominator = 255 - after[offset];
        if (denominator <= 12) continue;
        channelAlpha.push(
          Math.max(
            0,
            Math.min(0.44, (before[offset] - after[offset]) / denominator),
          ),
        );
      }
      alpha[pixel] = channelAlpha.length ? median(channelAlpha) : 0;
    }
    pairAlpha.push(alpha);
  }

  const output = Buffer.alloc(width * height);
  let activePixels = 0;
  let maximum = 0;
  for (let pixel = 0; pixel < output.length; pixel += 1) {
    if (reference.data[pixel] === 0) continue;
    const fitted = median(pairAlpha.map((sample) => sample[pixel]));
    const value = Math.max(0, Math.min(255, Math.round(fitted * 255)));
    output[pixel] = value;
    if (value > 0) activePixels += 1;
    maximum = Math.max(maximum, value);
  }

  await sharp(output, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  console.log(
    JSON.stringify(
      {
        pairs: pairs.length,
        width,
        height,
        activePixels,
        activeFraction: activePixels / (width * height),
        maximum,
        output: outputPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
