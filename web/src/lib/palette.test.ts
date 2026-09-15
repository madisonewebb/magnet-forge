import { describe, expect, it } from "vitest";
import { BACKGROUND, FOREGROUND } from "./mask";
import { applyPalette, quantizePalette, type RgbColor } from "./palette";

/** Build an RGBA buffer + matching mask from a row-major list of pixels. */
function makeImage(pixels: { color: RgbColor; foreground: boolean }[]) {
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  const mask = new Uint8ClampedArray(pixels.length);
  pixels.forEach(({ color, foreground }, i) => {
    rgba.set([color.r, color.g, color.b, foreground ? 255 : 0], i * 4);
    mask[i] = foreground ? FOREGROUND : BACKGROUND;
  });
  return { rgba, mask };
}

function nearestOf(color: RgbColor, palette: RgbColor[]): RgbColor {
  return palette.reduce((best, candidate) => {
    const d = (a: RgbColor) => (a.r - color.r) ** 2 + (a.g - color.g) ** 2 + (a.b - color.b) ** 2;
    return d(candidate) < d(best) ? candidate : best;
  });
}

describe("quantizePalette", () => {
  const black: RgbColor = { r: 10, g: 10, b: 10 };
  const cream: RgbColor = { r: 245, g: 235, b: 210 };
  const blue: RgbColor = { r: 30, g: 60, b: 200 };
  const transparentFiller: RgbColor = { r: 0, g: 0, b: 0 };

  // A stand-in for "the hand" from the ticket's verification note: three
  // well-separated foreground color clusters plus a transparent background
  // that must not be counted as (or contribute to) a fourth color.
  function buildHandLikeImage() {
    const pixels: { color: RgbColor; foreground: boolean }[] = [];
    for (let i = 0; i < 40; i++) pixels.push({ color: black, foreground: true });
    for (let i = 0; i < 40; i++) pixels.push({ color: cream, foreground: true });
    for (let i = 0; i < 40; i++) pixels.push({ color: blue, foreground: true });
    for (let i = 0; i < 100; i++) pixels.push({ color: transparentFiller, foreground: false });
    return makeImage(pixels);
  }

  it("reduces to exactly the requested number of colors, ignoring background", () => {
    const { rgba, mask } = buildHandLikeImage();
    const palette = quantizePalette(rgba, mask, 3);

    expect(palette).toHaveLength(3);
    // Every requested cluster is represented (within quantization rounding).
    for (const expected of [black, cream, blue]) {
      const nearest = nearestOf(expected, palette);
      expect(Math.abs(nearest.r - expected.r)).toBeLessThan(5);
      expect(Math.abs(nearest.g - expected.g)).toBeLessThan(5);
      expect(Math.abs(nearest.b - expected.b)).toBeLessThan(5);
    }
  });

  it("does not let a dominant color pair crowd out a locked accent color", () => {
    const dominantA: RgbColor = { r: 200, g: 200, b: 200 };
    const dominantB: RgbColor = { r: 40, g: 40, b: 40 };
    const accent: RgbColor = { r: 220, g: 30, b: 30 };

    const pixels: { color: RgbColor; foreground: boolean }[] = [];
    for (let i = 0; i < 470; i++) pixels.push({ color: dominantA, foreground: true });
    for (let i = 0; i < 470; i++) pixels.push({ color: dominantB, foreground: true });
    for (let i = 0; i < 10; i++) pixels.push({ color: accent, foreground: true }); // ~1%
    const { rgba, mask } = makeImage(pixels);

    const withoutLock = quantizePalette(rgba, mask, 2);
    // Un-forced, an even split between two huge, opposite clusters leaves
    // no room for the tiny accent to survive at k=2.
    const accentDistance = (p: RgbColor[]) =>
      Math.min(...p.map((c) => (c.r - accent.r) ** 2 + (c.g - accent.g) ** 2 + (c.b - accent.b) ** 2));
    expect(accentDistance(withoutLock)).toBeGreaterThan(1000);

    const withLock = quantizePalette(rgba, mask, 2, { lockedColors: [accent] });
    expect(withLock[0]).toEqual(accent);
    expect(accentDistance(withLock)).toBe(0);
  });

  it("returns an empty palette when there are no foreground pixels", () => {
    const { rgba, mask } = makeImage([{ color: black, foreground: false }]);
    expect(quantizePalette(rgba, mask, 4)).toEqual([]);
  });
});

describe("applyPalette", () => {
  it("recolors foreground pixels to their nearest palette color and makes background transparent", () => {
    const red: RgbColor = { r: 255, g: 0, b: 0 };
    const green: RgbColor = { r: 0, g: 255, b: 0 };
    const { rgba, mask } = makeImage([
      { color: { r: 250, g: 10, b: 10 }, foreground: true }, // near red
      { color: { r: 5, g: 5, b: 5 }, foreground: false }, // background
    ]);

    const result = applyPalette(rgba, mask, [red, green]);

    expect(Array.from(result.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(result[7]).toBe(0); // background pixel's alpha
  });

  it("returns a fully transparent buffer for an empty palette", () => {
    const { rgba, mask } = makeImage([{ color: { r: 1, g: 2, b: 3 }, foreground: true }]);
    const result = applyPalette(rgba, mask, []);
    expect(Array.from(result)).toEqual([0, 0, 0, 0]);
  });
});
