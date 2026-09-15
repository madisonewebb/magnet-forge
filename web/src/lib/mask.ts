// Deterministic background-mask editing primitives (S05).
//
// A mask is a `width * height` Uint8ClampedArray, one byte per pixel:
// 255 = foreground (kept), 0 = background (removed). These functions are
// pure and operate on plain pixel buffers (as returned by
// `CanvasRenderingContext2D.getImageData`) so they can be unit-tested
// without a DOM/canvas — the React layer (`BackgroundEditor`) is the only
// caller that touches canvases.

export const FOREGROUND = 255;
export const BACKGROUND = 0;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function readPixel(rgba: Uint8ClampedArray, index: number): Rgba {
  const o = index * 4;
  return { r: rgba[o], g: rgba[o + 1], b: rgba[o + 2], a: rgba[o + 3] };
}

// Alpha, not perceptual luminance/hue, is the deciding signal — two pixels
// can be the same color (e.g. a black outline and a black background) and
// still need different mask values, which is exactly what an existing
// alpha channel already encodes correctly.
export function alphaToMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 1,
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = rgba[i * 4 + 3] >= alphaThreshold ? FOREGROUND : BACKGROUND;
  }
  return mask;
}

function channelDistance(a: Rgba, b: Rgba): number {
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
    Math.abs(a.a - b.a),
  );
}

/**
 * Magic-wand style region growing from a seed pixel, restricted to pixels
 * *contiguous* with the seed and within `tolerance` color distance of it.
 * Connectivity is what keeps this safe on artwork that reuses the same
 * color for the background and for internal details (e.g. black outlines
 * on a black background): an outline pixel is never touched unless a path
 * of similar-enough pixels connects it to the clicked seed.
 *
 * Returns a fresh selection mask (1 = selected, 0 = not) — the caller
 * decides how to merge it into the working foreground/background mask.
 */
export function floodFillSelect(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
): Uint8Array {
  const selected = new Uint8Array(width * height);
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return selected;

  const seedIndex = seedY * width + seedX;
  const seedColor = readPixel(rgba, seedIndex);

  const stack: number[] = [seedIndex];
  selected[seedIndex] = 1;

  while (stack.length > 0) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;

    const neighbors =
      x > 0 && x < width - 1 && y > 0 && y < height - 1
        ? [index - 1, index + 1, index - width, index + width]
        : [
            x > 0 ? index - 1 : -1,
            x < width - 1 ? index + 1 : -1,
            y > 0 ? index - width : -1,
            y < height - 1 ? index + width : -1,
          ];

    for (const n of neighbors) {
      if (n < 0 || selected[n]) continue;
      if (channelDistance(readPixel(rgba, n), seedColor) <= tolerance) {
        selected[n] = 1;
        stack.push(n);
      }
    }
  }

  return selected;
}

/** Paint a filled circle of `value` into `mask`, in place, clipped to bounds. */
export function applyBrushStroke(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  value: number,
): void {
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius));
  const radiusSq = radius * radius;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radiusSq) {
        mask[y * width + x] = value;
      }
    }
  }
}

/**
 * Stamp brush circles along the segment from `(x0,y0)` to `(x1,y1)` so a
 * fast pointer drag between two mousemove samples doesn't leave gaps.
 */
export function applyBrushLine(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  value: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const distance = Math.hypot(dx, dy);
  // Half-radius spacing keeps consecutive stamps overlapping.
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    applyBrushStroke(mask, width, height, x0 + dx * t, y0 + dy * t, radius, value);
  }
}
