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
task test            # pytest (format/python, processing) + tsc -b && vite build (web)
```

These are exactly the commands `.github/workflows/ci.yml` runs, in the same
order, so a green `task install-dev && task lint && task test` locally means
CI will pass too. `Taskfile.yml` also defines namespaced sub-tasks
(`task install-dev:python`, `task lint:web`, `task test:python`, ...) if you
want to run just one stack while iterating.

Python linting is `ruff` (added as a pinned dev dependency at the repo root
and configured via `[tool.ruff]` in the root `pyproject.toml`); the web app
reuses its existing ESLint (`npm run lint`) and TypeScript build
(`npm run build`, which type-checks via `tsc -b`) — nothing new was added on
the web side.

> **Note on `task test:web`:** there is no test framework or test files in
> `web/` yet (adding one is out of scope here). `npm run build` runs
> `tsc -b && vite build`, which type-checks the whole app — today that's the
> only meaningful automated check available, so it stands in as the web
> "test" step until a real test suite exists.

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
manual/code-review verification — there is no web-side test framework yet
(see the note on `task test:web` above).

## Environment files

Only committed `.env.example` files contain configuration; real `.env`
files are gitignored and never committed. `web/.env.example` documents
`VITE_API_BASE_URL`, the only setting the web app currently needs.

## Containers

For building and running each service as a container image (for
deployment, or to sanity-check a change outside the local dev setup
above), see [`docs/DOCKER.md`](./DOCKER.md).
