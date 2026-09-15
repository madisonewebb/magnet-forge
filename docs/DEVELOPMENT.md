# Development setup

Two services, developed together from a clean checkout:

- `processing/` — Python/FastAPI processing service (workspace-managed by `uv`, includes the `format/python` project-format package as a workspace member).
- `web/` — React/TypeScript web app (Vite), the editor UI.

Installing dependencies, linting, and testing both stacks is driven by a
single [Task](https://taskfile.dev) runner (`Taskfile.yml`) so local
development and CI (`.github/workflows/ci.yml`) run the exact same
commands. See [Install, lint, test](#install-lint-test) below.

## Prerequisites

- [`uv`](https://docs.astral.sh/uv/) (Python dependency management, pinned via the committed `uv.lock`)
- Node.js 20.x and npm (pinned via the committed `web/package-lock.json`; CI runs Node 20)
- [Task](https://taskfile.dev) — install the same version CI pins (`v3.53.1`):

  ```bash
  sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b ~/.local/bin v3.53.1
  ```

  (adjust `-b` to any directory already on your `PATH`)

## Install, lint, test

From a clean checkout, one command each:

```bash
task install-dev   # uv sync (format/python + processing) + npm ci (web)
task lint           # ruff check (format/python, processing) + eslint (web)
task test            # pytest (format/python, processing) + tsc -b && vite build + vitest (web)
```

These are exactly the commands `.github/workflows/ci.yml` runs, in the same
order, so a green `task install-dev && task lint && task test` locally means
CI will pass too. `Taskfile.yml` also defines namespaced sub-tasks
(`task install-dev:python`, `task lint:web`, `task test:python`, ...) if you
want to run just one stack while iterating.

Python linting is `ruff` (added as a pinned dev dependency at the repo root
and configured via `[tool.ruff]` in the root `pyproject.toml`); the web app
reuses its existing ESLint (`npm run lint`) and TypeScript build
(`npm run build`, which type-checks via `tsc -b`).

> **Note on `task test:web`:** there is still no component/DOM test setup —
> `npm run build` (`tsc -b && vite build`) type-checks the whole app, and
> `npm run test` (Vitest) covers framework-agnostic logic modules under
> `web/src/lib/**/*.test.ts` (e.g. `mask.ts` and `palette.ts`, the S05/S06
> background-mask and color-quantization primitives), which are written to
> operate on plain pixel buffers so they don't need a DOM. React components
> themselves remain covered by manual/code-review verification until a
> component test setup exists.

## Running the services locally

`task` covers install/lint/test; the long-running dev servers are started
directly.

### Processing service

From the repo root (after `task install-dev`, or run `uv sync` yourself):

```bash
uv run --directory processing uvicorn magnet_forge_processing.main:app --reload --port 8000
```

Verify it's up:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

### Web app

In a second terminal (after `task install-dev`, or run `npm install`
yourself):

```bash
cd web
cp .env.example .env
npm run dev
```

Open the printed local URL (default `http://localhost:5173`). No secrets
are required — `.env.example` only sets the processing service's base URL.

## Verify the fixture round-trips end-to-end

With both services running, either:

- Open the web app in a browser: it fetches `format/fixtures/sample_project.json`
  from the processing service's `GET /fixture` endpoint and renders a
  loading state, then a summary (schema version, region count, palette
  swatches). A failed request shows an error state instead of a blank page.
- Or check the API directly:

  ```bash
  curl http://localhost:8000/fixture | python3 -m json.tool
  ```

  This exercises the same validation as `format/python`'s tests: the
  fixture is loaded, validated, and serialized by
  `magnet_forge_format.load_project`.

## Uploading artwork

`POST /uploads` (multipart/form-data, field name `file`) accepts a PNG or
JPEG image, normalizes EXIF orientation, and returns metadata plus the
normalized image re-encoded as PNG (`imageDataUrl`, a base64 data URL) —
see `processing/src/magnet_forge_processing/routers/uploads.py` for the
full response shape. The web app's upload UI lives in
`web/src/components/ImageUpload.tsx`, used from the Workspace page.

Format is validated by decoding the file's actual bytes with Pillow, not
by trusting the filename extension or the client-supplied Content-Type —
a file with a misleading extension is rejected with a 415, not silently
accepted.

Documented limits (`processing/src/magnet_forge_processing/settings.py`,
overridable via `MAGNET_FORGE_MAX_UPLOAD_BYTES` /
`MAGNET_FORGE_MAX_UPLOAD_DIMENSION_PX` env vars):

- Max file size: **25 MB**
- Max dimension: **8000px** on the longest side

Both are checked before the (more expensive) full pixel decode. Corrupt or
undecodable files, oversized files, oversized dimensions, and unsupported
formats each return a 4xx with a human-readable `detail` message — never a
500 or a raw stack trace.

```bash
curl -F "file=@artwork.png;type=image/png" http://localhost:8000/uploads
```

The upload UI (`web/src/components/ImageUpload.tsx`) is currently covered
only by the processing service's `processing/tests/test_uploads.py` plus
manual/code-review verification — there is no web-side component test
setup yet (see the note on `task test:web` above).

## Removing or correcting the background

After a successful upload, the Workspace page renders
`web/src/components/BackgroundEditor.tsx`, entirely client-side (no new
processing-service endpoint):

- An existing alpha channel (`hasAlpha` from the upload response) is
  authoritative and seeds the initial mask directly — no user action
  needed.
- An opaque image starts fully foreground; the "select background" tool
  runs a deterministic, tolerance-bounded flood fill from a clicked pixel
  (`floodFillSelect` in `web/src/lib/mask.ts`). Selection only follows
  *contiguous* similar-colored pixels from the click, so a black outline
  detail is never affected by clicking a black background, even though
  they're the same color — only connectivity, not color-matching over the
  whole image, drives the selection.
- "Keep" / "remove" brushes (`applyBrushStroke` / `applyBrushLine`) correct
  the mask by hand at any point; a "compare with original" toggle re-renders
  the untouched image for reference without discarding the mask.
- The original pixel buffer is never mutated — only a short-lived composite
  copy (background pixels made transparent) is rendered each frame — so the
  source image and the mask both stay independently editable going into
  later pipeline steps (palette reduction, vectorization), which aren't
  implemented yet.

The pixel-level primitives in `web/src/lib/mask.ts` are framework-agnostic
(operate on plain typed arrays) and covered by `web/src/lib/mask.test.ts`;
the React component itself is manual/code-review verified only, per the
`task test:web` note above.

## Reducing to a color palette

Clicking "Continue to color simplification" in the background editor hands
a snapshot of the current mask and original pixel data to
`web/src/components/PaletteEditor.tsx`:

- Color quantization (`quantizePalette` in `web/src/lib/palette.ts`) is
  k-means over **foreground pixels only** — background/transparent pixels
  never contribute a sample and never consume one of the 2-8 palette slots.
- Seeding uses deterministic farthest-point sampling, which favors
  including visually distinct outlier colors over always picking the most
  frequent ones. A user can also explicitly **lock** a color (via the
  browser's native color-picker swatches, which include an eyedropper in
  Chromium browsers, letting you sample directly off the canvas) to
  guarantee it survives quantization regardless of how rare it is —
  locked colors seed fixed centroids that k-means never moves.
- `applyPalette` recolors foreground pixels to their nearest palette color
  for the simplified preview; a "compare with original" toggle re-renders
  the (background-corrected, but not yet recolored) image for reference.
  Neither the original pixel buffer nor the mask handed in is ever
  mutated — palette-size and lock changes only recompute the preview.

The pixel-level primitives in `web/src/lib/palette.ts` are
framework-agnostic and covered by `web/src/lib/palette.test.ts`, including
a synthetic "three well-separated colors plus transparent background"
fixture (confirming background never becomes a fourth color) and a
dominant-pair-vs-locked-accent fixture (confirming a locked color survives
even when two much larger clusters would otherwise crowd it out at a small
palette size). The React component itself is manual/code-review verified
only, per the `task test:web` note above.

## Environment files

Only committed `.env.example` files contain configuration; real `.env`
files are gitignored and never committed. `web/.env.example` documents
`VITE_API_BASE_URL`, the only setting the web app currently needs.

## Containers

For building and running each service as a container image (for
deployment, or to sanity-check a change outside the local dev setup
above), see [`docs/DOCKER.md`](./DOCKER.md).
