const SAMPLES = 4;

const insideCrescent = (x, y, size) => {
  const r = size * 0.42;
  const c = size / 2;
  const inMoon = (x - c) ** 2 + (y - c) ** 2 <= r ** 2;
  const inShadow = (x - c - r * 0.55) ** 2 + (y - c + r * 0.35) ** 2 <= (r * 0.85) ** 2;
  return inMoon && !inShadow;
};

const coverage = (px, py, size) => {
  let hits = 0;
  for (let sx = 0; sx < SAMPLES; sx++) {
    for (let sy = 0; sy < SAMPLES; sy++) {
      if (insideCrescent(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES, size)) hits++;
    }
  }
  return hits / SAMPLES ** 2;
};

// Returns a BGRA bitmap, the format nativeImage.createFromBitmap expects.
const moonBitmap = (size, [red, green, blue]) => {
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
      buffer[offset + 3] = Math.round(coverage(x, y, size) * 255);
    }
  }
  return buffer;
};

module.exports = { moonBitmap };
