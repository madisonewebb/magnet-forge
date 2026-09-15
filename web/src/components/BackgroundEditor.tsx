import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadResponse } from "../api/schemas";
import {
  BACKGROUND,
  FOREGROUND,
  alphaToMask,
  applyBrushLine,
  applyBrushStroke,
  floodFillSelect,
} from "../lib/mask";

type Tool = "select-background" | "keep" | "remove";

interface BackgroundEditorProps {
  image: UploadResponse;
  // Hands a snapshot of the current mask + decoded original pixels to the
  // next pipeline step (S06 color reduction) when the user is done
  // correcting the background. A snapshot (not a live-shared buffer) keeps
  // this editor free to keep mutating its own mask afterwards — the AC's
  // "keep the original image and mask editable" is about not destroying
  // either, not about them being the same object as whatever consumes them
  // next.
  onDone?: (mask: Uint8ClampedArray, originalImageData: ImageData) => void;
}

// Canvas display is capped and scaled via CSS; the canvas's own
// width/height attributes stay at full image resolution so the mask is
// always edited at source pixel accuracy — only pointer coordinates get
// converted from screen space back to image space (see `getImageCoords`).
const MAX_DISPLAY_WIDTH = 640;

/**
 * S05: background removal / correction. Seeds a mask from the upload's
 * alpha channel when present, or an all-foreground mask for opaque images
 * that the user narrows down with a deterministic magic-wand click; either
 * way, keep/remove brushes correct the result, with an original-image
 * comparison toggle. See web/src/lib/mask.ts for the pixel-level
 * primitives (kept framework-agnostic and unit-tested there).
 */
export function BackgroundEditor({ image, onDone }: BackgroundEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalDataRef = useRef<ImageData | null>(null);
  const maskRef = useRef<Uint8ClampedArray | null>(null);
  const paintingRef = useRef<{ x: number; y: number } | null>(null);
  const redrawScheduledRef = useRef(false);

  const [tool, setTool] = useState<Tool>(image.hasAlpha ? "keep" : "select-background");
  const [tolerance, setTolerance] = useState(32);
  const [brushRadius, setBrushRadius] = useState(24);
  const [showOriginal, setShowOriginal] = useState(false);
  const [ready, setReady] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const original = originalDataRef.current;
    const mask = maskRef.current;
    if (!canvas || !original || !mask) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (showOriginal) {
      ctx.putImageData(original, 0, 0);
      return;
    }

    // Composite from a fresh copy each redraw so the true original pixels
    // (kept in `originalDataRef`) are never mutated — only this
    // short-lived render copy has background pixels made transparent.
    const composite = new ImageData(
      new Uint8ClampedArray(original.data),
      original.width,
      original.height,
    );
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === BACKGROUND) composite.data[i * 4 + 3] = 0;
    }
    ctx.putImageData(composite, 0, 0);
  }, [showOriginal]);

  const requestRedraw = useCallback(() => {
    if (redrawScheduledRef.current) return;
    redrawScheduledRef.current = true;
    requestAnimationFrame(() => {
      redrawScheduledRef.current = false;
      redraw();
    });
  }, [redraw]);

  // Load the upload once into an offscreen canvas to read its pixel data,
  // and seed the initial mask. An existing alpha channel is authoritative
  // (AC: "respect an existing alpha mask"); an opaque image starts fully
  // foreground until a magic-wand click narrows it down.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const offscreen = document.createElement("canvas");
      offscreen.width = image.width;
      offscreen.height = image.height;
      const ctx = offscreen.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, image.width, image.height);
      originalDataRef.current = data;
      maskRef.current = image.hasAlpha
        ? alphaToMask(data.data, image.width, image.height)
        : new Uint8ClampedArray(image.width * image.height).fill(FOREGROUND);
      setReady(true);
    };
    img.src = image.imageDataUrl;
    return () => {
      cancelled = true;
    };
  }, [image]);

  useEffect(() => {
    if (ready) requestRedraw();
  }, [ready, showOriginal, requestRedraw]);

  const getImageCoords = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready || showOriginal) return;
    const mask = maskRef.current!;
    const { x, y } = getImageCoords(event);

    if (tool === "select-background") {
      const original = originalDataRef.current!;
      const selection = floodFillSelect(
        original.data,
        image.width,
        image.height,
        Math.round(x),
        Math.round(y),
        tolerance,
      );
      for (let i = 0; i < selection.length; i++) {
        if (selection[i]) mask[i] = BACKGROUND;
      }
      requestRedraw();
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    paintingRef.current = { x, y };
    applyBrushStroke(mask, image.width, image.height, x, y, brushRadius, toolValue(tool));
    requestRedraw();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!paintingRef.current) return;
    const mask = maskRef.current!;
    const { x, y } = getImageCoords(event);
    applyBrushLine(
      mask,
      image.width,
      image.height,
      paintingRef.current.x,
      paintingRef.current.y,
      x,
      y,
      brushRadius,
      toolValue(tool),
    );
    paintingRef.current = { x, y };
    requestRedraw();
  };

  const stopPainting = () => {
    paintingRef.current = null;
  };

  const handleReset = () => {
    const original = originalDataRef.current;
    if (!original) return;
    maskRef.current = image.hasAlpha
      ? alphaToMask(original.data, image.width, image.height)
      : new Uint8ClampedArray(image.width * image.height).fill(FOREGROUND);
    requestRedraw();
  };

  const handleDone = () => {
    const original = originalDataRef.current;
    const mask = maskRef.current;
    if (!original || !mask || !onDone) return;
    // Clone the mask: this editor keeps mutating `maskRef.current` in
    // place for further corrections, so the next step needs its own copy.
    onDone(new Uint8ClampedArray(mask), original);
  };

  const displayWidth = Math.min(MAX_DISPLAY_WIDTH, image.width);

  return (
    <div>
      <h3>Remove or correct the background</h3>

      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <fieldset style={{ border: "1px solid #0002", borderRadius: "4px" }}>
          <legend>Tool</legend>
          <label style={{ display: "block" }}>
            <input
              type="radio"
              name="tool"
              checked={tool === "select-background"}
              onChange={() => setTool("select-background")}
            />{" "}
            Select background (click)
          </label>
          <label style={{ display: "block" }}>
            <input
              type="radio"
              name="tool"
              checked={tool === "keep"}
              onChange={() => setTool("keep")}
            />{" "}
            Keep brush
          </label>
          <label style={{ display: "block" }}>
            <input
              type="radio"
              name="tool"
              checked={tool === "remove"}
              onChange={() => setTool("remove")}
            />{" "}
            Remove brush
          </label>
        </fieldset>

        <div>
          {tool === "select-background" ? (
            <label>
              Tolerance
              <br />
              <input
                type="range"
                min={1}
                max={128}
                value={tolerance}
                onChange={(event) => setTolerance(Number(event.target.value))}
              />{" "}
              {tolerance}
            </label>
          ) : (
            <label>
              Brush size
              <br />
              <input
                type="range"
                min={2}
                max={100}
                value={brushRadius}
                onChange={(event) => setBrushRadius(Number(event.target.value))}
              />{" "}
              {brushRadius}px
            </label>
          )}
          <br />
          <label>
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(event) => setShowOriginal(event.target.checked)}
            />{" "}
            Compare with original
          </label>
          <br />
          <button type="button" onClick={handleReset}>
            Reset mask
          </button>
          {onDone && (
            <>
              {" "}
              <button type="button" onClick={handleDone} disabled={!ready}>
                Continue to color simplification →
              </button>
            </>
          )}
        </div>
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
          style={{
            display: "block",
            width: `${displayWidth}px`,
            height: "auto",
            touchAction: "none",
            cursor: showOriginal ? "default" : tool === "select-background" ? "crosshair" : "cell",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopPainting}
          onPointerLeave={stopPainting}
        />
      </div>

      {!ready && <p role="status">Loading image for editing…</p>}
      {!image.hasAlpha && ready && tool === "select-background" && (
        <p>
          <small>Click on the background to select it, then switch to the brushes to correct edges.</small>
        </p>
      )}
    </div>
  );
}

function toolValue(tool: Tool): number {
  return tool === "keep" ? FOREGROUND : BACKGROUND;
}
