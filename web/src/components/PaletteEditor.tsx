import { useEffect, useMemo, useRef, useState } from "react";
import type { UploadResponse } from "../api/schemas";
import { FOREGROUND } from "../lib/mask";
import { applyPalette, quantizePalette, type RgbColor } from "../lib/palette";

interface PaletteEditorProps {
  image: UploadResponse;
  // The un-recolored pixel data and the (possibly hand-corrected) mask
  // handed off by BackgroundEditor's "Continue" step — see Workspace.tsx.
  imageData: ImageData;
  mask: Uint8ClampedArray;
}

const MIN_PALETTE_SIZE = 2;
const MAX_PALETTE_SIZE = 8;
const DEFAULT_PALETTE_SIZE = 5;
const MAX_DISPLAY_WIDTH = 640;

function toHex(color: RgbColor): string {
  const channel = (n: number) => n.toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function fromHex(hex: string): RgbColor {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * S06: reduce the (background-corrected) artwork to a small, fixed-size
 * color palette. Quantization and recoloring live in `web/src/lib/palette.ts`
 * (framework-agnostic, unit-tested); this component is the interactive
 * layer — palette-size control, locking an accent color so it survives
 * quantization regardless of how rare it is, manual per-swatch color
 * overrides via the browser's native color picker, and an
 * original/simplified comparison toggle.
 */
export function PaletteEditor({ image, imageData, mask }: PaletteEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentInputRef = useRef<HTMLInputElement>(null);

  const [paletteSize, setPaletteSize] = useState(DEFAULT_PALETTE_SIZE);
  const [lockedColors, setLockedColors] = useState<RgbColor[]>([]);
  const [showOriginal, setShowOriginal] = useState(false);

  // Shrinking the palette size can leave more locked colors than slots.
  useEffect(() => {
    setLockedColors((prev) => (prev.length > paletteSize ? prev.slice(0, paletteSize) : prev));
  }, [paletteSize]);

  // quantizePalette places locked colors first, in order, so `palette[i]`
  // for `i < lockedColors.length` always corresponds to `lockedColors[i]`.
  const palette = useMemo(
    () => quantizePalette(imageData.data, mask, paletteSize, { lockedColors }),
    [imageData, mask, paletteSize, lockedColors],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    if (showOriginal) {
      const composite = new Uint8ClampedArray(imageData.data);
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] !== FOREGROUND) composite[i * 4 + 3] = 0;
      }
      ctx.putImageData(new ImageData(composite, image.width, image.height), 0, 0);
    } else {
      const simplified = applyPalette(imageData.data, mask, palette);
      ctx.putImageData(new ImageData(simplified, image.width, image.height), 0, 0);
    }
  }, [showOriginal, palette, imageData, mask, image.width, image.height]);

  const handleSwatchChange = (index: number, color: RgbColor) => {
    setLockedColors((prev) => {
      if (index < prev.length) {
        const next = [...prev];
        next[index] = color;
        return next;
      }
      // Editing a computed (not-yet-locked) swatch locks it at the chosen color.
      return prev.length < paletteSize ? [...prev, color] : prev;
    });
  };

  const handleUnlock = (index: number) => {
    setLockedColors((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddAccent = (color: RgbColor) => {
    setLockedColors((prev) => (prev.length >= paletteSize ? prev : [...prev, color]));
  };

  const displayWidth = Math.min(MAX_DISPLAY_WIDTH, image.width);

  return (
    <div>
      <h3>Reduce to a color palette</h3>

      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Palette size ({paletteSize})
          <br />
          <input
            type="range"
            min={MIN_PALETTE_SIZE}
            max={MAX_PALETTE_SIZE}
            value={paletteSize}
            onChange={(event) => setPaletteSize(Number(event.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={showOriginal}
            onChange={(event) => setShowOriginal(event.target.checked)}
          />{" "}
          Compare with original
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start", marginBottom: "1rem" }}>
        {palette.map((color, index) => {
          const locked = index < lockedColors.length;
          return (
            <div key={index} style={{ textAlign: "center" }}>
              <input
                type="color"
                value={toHex(color)}
                onChange={(event) => handleSwatchChange(index, fromHex(event.target.value))}
                title={
                  locked
                    ? "Locked accent color — pick a new value or unlock it"
                    : "Computed color — pick a value to lock it in place"
                }
                style={{
                  width: "2.5rem",
                  height: "2.5rem",
                  padding: 0,
                  cursor: "pointer",
                  border: locked ? "2px solid #646cff" : "1px solid #0002",
                  borderRadius: "4px",
                }}
              />
              {locked && (
                <button
                  type="button"
                  onClick={() => handleUnlock(index)}
                  style={{ display: "block", fontSize: "0.7rem", marginTop: "0.25rem" }}
                >
                  Unlock
                </button>
              )}
            </div>
          );
        })}

        {lockedColors.length < paletteSize && (
          <div>
            <input
              ref={accentInputRef}
              type="color"
              onChange={(event) => handleAddAccent(fromHex(event.target.value))}
              style={{ display: "none" }}
              aria-hidden="true"
              tabIndex={-1}
            />
            <button type="button" onClick={() => accentInputRef.current?.click()}>
              + Add accent color
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          display: "inline-block",
          backgroundImage: "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%)",
          backgroundSize: "16px 16px",
          lineHeight: 0,
          border: "1px solid #0002",
          borderRadius: "4px",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          width={image.width}
          height={image.height}
          style={{ display: "block", width: `${displayWidth}px`, height: "auto" }}
        />
      </div>

      <p>
        <small>
          Palette size is independent of your printer's AMS/filament-slot count — an 8-color
          palette here isn't guaranteed printable on every setup.
        </small>
      </p>
    </div>
  );
}
