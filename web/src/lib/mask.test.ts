import { describe, expect, it } from "vitest";
import {
  BACKGROUND,
  FOREGROUND,
  alphaToMask,
  applyBrushLine,
  applyBrushStroke,
  floodFillSelect,
} from "./mask";

/** Build an RGBA buffer from a row-major list of [r,g,b,a] pixels. */
function makeRgba(pixels: [number, number, number, number][]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    rgba.set([r, g, b, a], i * 4);
  });
  return rgba;
}

describe("alphaToMask", () => {
  it("maps opaque pixels to foreground and transparent pixels to background", () => {
    const rgba = makeRgba([
      [10, 10, 10, 255],
      [10, 10, 10, 0],
      [200, 50, 50, 128],
      [200, 50, 50, 1],
    ]);

    expect(Array.from(alphaToMask(rgba, 2, 2))).toEqual([
      FOREGROUND,
      BACKGROUND,
      FOREGROUND,
      FOREGROUND,
    ]);
  });

  it("respects a custom alpha threshold", () => {
    const rgba = makeRgba([[0, 0, 0, 100]]);
    expect(Array.from(alphaToMask(rgba, 1, 1, 101))).toEqual([BACKGROUND]);
    expect(Array.from(alphaToMask(rgba, 1, 1, 100))).toEqual([FOREGROUND]);
  });
});

describe("floodFillSelect", () => {
  // 5x5 opaque image: a black border (the "background") surrounds a white
  // interior, and one interior pixel is also black (an "outline" detail
  // that happens to share the background's exact color but is not
  // connected to it).
  //
  //   B B B B B
  //   B W W W B
  //   B W B W B   <- center pixel is black but isolated from the border
  //   B W W W B
  //   B B B B B
  function buildArtwork() {
    const black: [number, number, number, number] = [0, 0, 0, 255];
    const white: [number, number, number, number] = [255, 255, 255, 255];
    const size = 5;
    const pixels: [number, number, number, number][] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1;
        const isIsolatedOutline = x === 2 && y === 2;
        pixels.push(isBorder || isIsolatedOutline ? black : white);
      }
    }
    return { rgba: makeRgba(pixels), size };
  }

  it("selects the contiguous background region from a seed click", () => {
    const { rgba, size } = buildArtwork();
    const selection = floodFillSelect(rgba, size, size, 0, 0, 10);

    // All 16 border pixels are selected...
    expect(selection.reduce((sum, v) => sum + v, 0)).toBe(16);
    // ...but the isolated black interior pixel at (2,2) is not, even
    // though it is the exact same color as the seed.
    expect(selection[2 * size + 2]).toBe(0);
  });

  it("compares every candidate to the seed color, not to its neighbor", () => {
    // Distance is measured from the clicked seed pixel, so a gradual ramp
    // doesn't "walk" the selection arbitrarily far from the sampled color.
    const rgba = makeRgba([
      [0, 0, 0, 255],
      [10, 10, 10, 255],
      [255, 255, 255, 255],
    ]);
    const selection = floodFillSelect(rgba, 3, 1, 0, 0, 5);
    expect(Array.from(selection)).toEqual([1, 0, 0]);
  });

  it("returns an empty selection for an out-of-bounds seed", () => {
    const rgba = makeRgba([[0, 0, 0, 255]]);
    const selection = floodFillSelect(rgba, 1, 1, 5, 5, 10);
    expect(Array.from(selection)).toEqual([0]);
  });
});

describe("applyBrushStroke", () => {
  it("sets pixels within the radius and leaves the rest untouched", () => {
    const width = 5;
    const height = 5;
    const mask = new Uint8ClampedArray(width * height).fill(FOREGROUND);

    applyBrushStroke(mask, width, height, 2, 2, 1, BACKGROUND);

    // Center and its 4-neighbors fall within radius 1; corners of the
    // bounding box do not.
    expect(mask[2 * width + 2]).toBe(BACKGROUND);
    expect(mask[1 * width + 2]).toBe(BACKGROUND);
    expect(mask[0 * width + 0]).toBe(FOREGROUND);
    expect(mask[4 * width + 4]).toBe(FOREGROUND);
  });

  it("clips at the image bounds instead of throwing", () => {
    const width = 3;
    const height = 3;
    const mask = new Uint8ClampedArray(width * height).fill(FOREGROUND);

    expect(() => applyBrushStroke(mask, width, height, 0, 0, 5, BACKGROUND)).not.toThrow();
    expect(mask[0]).toBe(BACKGROUND);
  });
});

describe("applyBrushLine", () => {
  it("fills in a continuous stroke between two far-apart points", () => {
    const width = 20;
    const height = 3;
    const mask = new Uint8ClampedArray(width * height).fill(FOREGROUND);

    applyBrushLine(mask, width, height, 0, 1, 19, 1, 1, BACKGROUND);

    // The midpoint would be skipped by two independent circle stamps at
    // the endpoints alone, but the line interpolation should cover it.
    expect(mask[1 * width + 10]).toBe(BACKGROUND);
  });
});
