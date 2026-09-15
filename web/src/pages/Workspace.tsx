import { useEffect, useState } from "react";
import { fetchFixtureProject } from "../api/client";
import type { ProjectSummary, UploadResponse } from "../api/schemas";
import { BackgroundEditor } from "../components/BackgroundEditor";
import { ImageUpload } from "../components/ImageUpload";
import { PaletteEditor } from "../components/PaletteEditor";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; project: ProjectSummary };

interface SimplificationInput {
  mask: Uint8ClampedArray;
  originalImageData: ImageData;
}

export function Workspace() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [uploadedImage, setUploadedImage] = useState<UploadResponse | null>(null);
  const [simplificationInput, setSimplificationInput] = useState<SimplificationInput | null>(
    null,
  );

  const handleUploaded = (result: UploadResponse) => {
    setUploadedImage(result);
    setSimplificationInput(null);
  };

  useEffect(() => {
    let cancelled = false;

    fetchFixtureProject()
      .then((project) => {
        if (!cancelled) setState({ status: "success", project });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <section>
        <h2>Upload artwork</h2>
        <ImageUpload onUploaded={handleUploaded} />
      </section>

      {uploadedImage && (
        <section style={{ marginTop: "2rem" }}>
          <BackgroundEditor
            key={uploadedImage.imageDataUrl}
            image={uploadedImage}
            onDone={(mask, originalImageData) =>
              setSimplificationInput({ mask, originalImageData })
            }
          />
        </section>
      )}

      {uploadedImage && simplificationInput && (
        <section style={{ marginTop: "2rem" }}>
          <PaletteEditor
            image={uploadedImage}
            imageData={simplificationInput.originalImageData}
            mask={simplificationInput.mask}
          />
        </section>
      )}

      <section style={{ marginTop: "2rem" }}>
        <h2>Fixture project</h2>
        {renderFixtureSection(state)}
      </section>
    </div>
  );
}

function renderFixtureSection(state: LoadState) {
  if (state.status === "loading") {
    return <p role="status">Loading fixture project…</p>;
  }

  if (state.status === "error") {
    return (
      <p role="alert" style={{ color: "crimson" }}>
        Failed to load fixture project: {state.message}
      </p>
    );
  }

  const { project } = state;
  return (
    <div>
      <p>Schema version: {project.schemaVersion}</p>
      <p>Regions: {project.regions.length}</p>
      <ul style={{ display: "flex", gap: "0.5rem", listStyle: "none", padding: 0 }}>
        {project.palette.map((entry) => (
          <li key={entry.id} title={entry.name}>
            <span
              style={{
                display: "inline-block",
                width: "1.25rem",
                height: "1.25rem",
                borderRadius: "50%",
                backgroundColor: entry.colorHex,
                border: "1px solid #0002",
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
