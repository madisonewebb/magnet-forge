import { useCallback, useRef, useState } from "react";
import { ApiError, uploadImage } from "../api/client";
import type { UploadResponse } from "../api/schemas";

// Must match the accepted formats enforced server-side in
// processing/src/magnet_forge_processing/routers/uploads.py. Restricting
// the file picker/drop-zone to these types is a UX nicety only — the
// server re-validates by decoding the actual bytes, since a client-side
// MIME/extension check can always be bypassed.
const ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg"];

// Human-readable mirror of the limits documented and enforced in
// processing/src/magnet_forge_processing/settings.py — kept as text here
// only; the server is the source of truth and returns its own message if
// this ever drifts.
const LIMITS_HINT = "PNG or JPEG, up to 25 MB, up to 8000px on the longest side";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "error"; message: string }
  | { status: "success"; result: UploadResponse };

function isAcceptedFile(file: File): boolean {
  return ACCEPTED_MIME_TYPES.includes(file.type);
}

export function ImageUpload() {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    if (!isAcceptedFile(file)) {
      setState({
        status: "error",
        message: `"${file.name}" is not a PNG or JPEG file. Please choose a different file.`,
      });
      return;
    }

    setState({ status: "uploading" });
    uploadImage(file)
      .then((result) => {
        setState({ status: "success", result });
      })
      .catch((error: unknown) => {
        setState({
          status: "error",
          message: error instanceof ApiError ? error.message : "Upload failed. Please try again.",
        });
      });
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file after a retry.
    event.target.value = "";
    if (file) handleFile(file);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const reset = () => setState({ status: "idle" });

  return (
    <div>
      {state.status !== "success" && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
          }}
          style={{
            border: `2px dashed ${isDragActive ? "#646cff" : "#888"}`,
            borderRadius: "8px",
            padding: "2rem",
            textAlign: "center",
            cursor: "pointer",
            backgroundColor: isDragActive ? "rgba(100, 108, 255, 0.08)" : "transparent",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleInputChange}
            style={{ display: "none" }}
            aria-label="Choose an image file to upload"
          />
          {state.status === "uploading" ? (
            <p role="status">Uploading…</p>
          ) : (
            <p>
              Drag and drop an image here, or click to choose a file.
              <br />
              <small>{LIMITS_HINT}</small>
            </p>
          )}
        </div>
      )}

      {state.status === "error" && (
        <div role="alert" style={{ marginTop: "1rem", color: "crimson" }}>
          <p>{state.message}</p>
          <button type="button" onClick={reset}>
            Choose a different file
          </button>
        </div>
      )}

      {state.status === "success" && (
        <div style={{ marginTop: "1rem" }}>
          <div
            style={{
              display: "inline-block",
              backgroundImage:
                "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%)",
              backgroundSize: "16px 16px",
              lineHeight: 0,
              border: "1px solid #0002",
              borderRadius: "4px",
              overflow: "hidden",
            }}
          >
            <img
              src={state.result.imageDataUrl}
              alt="Uploaded artwork preview"
              style={{ display: "block", maxWidth: "100%", maxHeight: "400px" }}
            />
          </div>
          <p>
            {state.result.width}×{state.result.height}px
            {state.result.hasAlpha ? " · has transparency" : ""}
          </p>
          <button type="button" onClick={reset}>
            Upload a different image
          </button>
        </div>
      )}
    </div>
  );
}
