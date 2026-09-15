// Deterministic color-palette reduction (S06): flatten an image's
// foreground pixels into a small, fixed-size set of colors. Pure,
// framework-agnostic functions operating on plain pixel buffers (as
// returned by `CanvasRenderingContext2D.getImageData`) plus the `Mask`
// arrays from `./mask.ts`, so they're unit-testable without a DOM/canvas.

import { FOREGROUND } from "./mask";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

// Bounds pixel-sampling cost for very large uploads (see format/SPEC.md's
// 8000px max dimension) — k-means only needs a representative sample, not
// every foreground pixel, to converge on essentially the same centroids.
const MAX_SAMPLES = 20_000;
const MAX_ITERATIONS = 12;

function squaredDistance(a: RgbColor, b: RgbColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function readColor(rgba: Uint8ClampedArray, pixelIndex: number): RgbColor {
  const o = pixelIndex * 4;
  return { r: rgba[o], g: rgba[o + 1], b: rgba[o + 2] };
}

/** Deterministically sample up to `MAX_SAMPLES` foreground-pixel colors. */
function sampleForegroundColors(rgba: Uint8ClampedArray, mask: Uint8ClampedArray): RgbColor[] {
  let foregroundCount = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === FOREGROUND) foregroundCount++;
  }
  if (foregroundCount === 0) return [];

  const step = Math.max(1, Math.floor(foregroundCount / MAX_SAMPLES));
  const samples: RgbColor[] = [];
  let seen = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== FOREGROUND) continue;
    if (seen % step === 0) samples.push(readColor(rgba, i));
    seen++;
  }
  return samples;
}

/**
 * Farthest-point (furthest-first traversal) seeding: repeatedly add the
 * sample color that maximizes its minimum distance to the colors already
 * chosen. This is what lets a small but visually distinct accent color
 * survive quantization on its own — an outlier is, by construction, far
 * from the dominant clusters a frequency-based pick would favor — while
 * still being fully deterministic (no randomness to make tests flaky).
 */
function seedFarthestPoint(samples: RgbColor[], existing: RgbColor[], count: number): RgbColor[] {
  const chosen: RgbColor[] = [];
  const reference = existing.length > 0 ? existing : [samples[0]];
  if (existing.length === 0) chosen.push(samples[0]);

  const minDistanceTo = (color: RgbColor, pool: RgbColor[]): number =>
    pool.reduce((min, c) => Math.min(min, squaredDistance(color, c)), Infinity);

  while (chosen.length < count) {
    const pool = [...reference, ...chosen];
    let best = samples[0];
    let bestDistance = -1;
    for (const sample of samples) {
      const distance = minDistanceTo(sample, pool);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = sample;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

export interface QuantizeOptions {
  /** Colors that must appear in the returned palette, taking up slots first. */
  lockedColors?: RgbColor[];
}

/**
 * K-means (Lloyd's algorithm) color quantization over foreground pixels
 * only — background/transparent pixels never contribute a sample and never
 * consume a palette slot. `lockedColors` seed fixed centroids that are
 * never recomputed during refinement, guaranteeing they survive in the
 * final palette exactly as given (an explicit, stronger version of the
 * accent-color retention `seedFarthestPoint` already helps with).
 */
export function quantizePalette(
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  paletteSize: number,
  options: QuantizeOptions = {},
): RgbColor[] {
  const lockedColors = (options.lockedColors ?? []).slice(0, paletteSize);
  const samples = sampleForegroundColors(rgba, mask);
  if (samples.length === 0) return lockedColors;

  const freeSlotCount = paletteSize - lockedColors.length;
  const freeCentroids =
    freeSlotCount > 0 ? seedFarthestPoint(samples, lockedColors, freeSlotCount) : [];
  const centroids = [...lockedColors, ...freeCentroids];
  const lockedCount = lockedColors.length;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));

    for (const sample of samples) {
      let nearest = 0;
      let nearestDistance = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const distance = squaredDistance(sample, centroids[c]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = c;
        }
      }
      sums[nearest].r += sample.r;
      sums[nearest].g += sample.g;
      sums[nearest].b += sample.b;
      sums[nearest].count += 1;
    }

    let moved = false;
    for (let c = lockedCount; c < centroids.length; c++) {
      const sum = sums[c];
      if (sum.count === 0) continue; // Keep an empty cluster's previous position.
      const next = { r: sum.r / sum.count, g: sum.g / sum.count, b: sum.b / sum.count };
      if (squaredDistance(next, centroids[c]) > 0.25) moved = true;
      centroids[c] = next;
    }
    if (!moved) break;
  }

  return centroids.map((c) => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) }));
}

/**
 * Recolor every foreground pixel to its nearest palette color; background
 * pixels are made fully transparent (never a palette color themselves).
 * Used both for the simplified preview and to re-render after a manual
 * palette-swatch edit, without re-running quantization. Returns a plain
 * RGBA buffer (not a DOM `ImageData`) so this stays testable without a
 * canvas — callers wrap it in `new ImageData(...)` to draw it.
 */
export function applyPalette(
  rgba: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  palette: RgbColor[],
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(mask.length * 4);
  if (palette.length === 0) return output;

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== FOREGROUND) continue; // Already transparent black from the typed array's zero-fill.

    const o = i * 4;
    const color = readColor(rgba, i);
    let nearest = palette[0];
    let nearestDistance = Infinity;
    for (const candidate of palette) {
      const distance = squaredDistance(color, candidate);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    }

    output[o] = nearest.r;
    output[o + 1] = nearest.g;
    output[o + 2] = nearest.b;
    output[o + 3] = 255;
  }

  return output;
}
