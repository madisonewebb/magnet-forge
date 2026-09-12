# Development setup

Two services, developed together from a clean checkout:

- `processing/` — Python/FastAPI processing service (workspace-managed by `uv`, includes the `format/python` project-format package as a workspace member).
- `web/` — React/TypeScript web app (Vite), the editor UI.

## Prerequisites

- [`uv`](https://docs.astral.sh/uv/) (Python dependency management, pinned via the committed `uv.lock`)
- Node.js 18+ and npm (pinned via the committed `web/package-lock.json`)

## Processing service

From the repo root:

```bash
uv sync
uv run --directory processing uvicorn magnet_forge_processing.main:app --reload --port 8000
```

`uv sync` installs both workspace members (`format/python` and `processing`)
into a single `.venv` at the repo root. Verify it's up:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

## Web app

In a second terminal:

```bash
cd web
npm install
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

## Tests

```bash
uv run pytest format/python/tests processing/tests   # Python
cd web && npm run build && npm run lint              # TypeScript: type-check, build, lint
```

No web-side test framework is wired up yet (tracked separately as S31);
the upload UI (`web/src/components/ImageUpload.tsx`) is currently covered
only by the processing service's `processing/tests/test_uploads.py` plus
manual/code-review verification, not automated frontend tests.

## Environment files

Only committed `.env.example` files contain configuration; real `.env`
files are gitignored and never committed. `web/.env.example` documents
`VITE_API_BASE_URL`, the only setting the web app currently needs.
