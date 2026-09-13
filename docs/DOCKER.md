# Container images

Each service has its own Dockerfile under `docker/`:

- `docker/Dockerfile.processing` — the FastAPI processing service (`processing/`).
- `docker/Dockerfile.web` — the Vite/React web app (`web/`), built to static
  files and served by nginx.

Both are built **from the repository root** (see the build-context note
below for why). Neither image bakes in secrets; all configuration is via
environment variables (processing) or a build argument (web — see below).

## Processing service

`processing` depends on `format/python` (package `magnet-forge-format`) as
a local `uv` workspace member, not a published package. Both directories
must be in the build context for `uv sync` to resolve the workspace, so
**the build context must be the repo root**, not `processing/`:

```bash
docker build -f docker/Dockerfile.processing -t magnet-forge-processing .
```

Run it:

```bash
docker run --rm -p 8000:8000 magnet-forge-processing
```

Verify the #10 health endpoint:

```bash
curl http://localhost:8000/health
# {"status":"ok"}

curl http://localhost:8000/fixture | python3 -m json.tool
```

Configuration (environment variables, all optional):

| Variable       | Default                                          | Purpose                                                      |
|----------------|---------------------------------------------------|----------------------------------------------------------------|
| `PORT`         | `8000`                                            | Port uvicorn binds to inside the container.                  |
| `FIXTURE_PATH` | `/app/format/fixtures/sample_project.json`        | Overrides the fixture file the `/fixture` endpoint serves.    |

To use a different port on the host:

```bash
docker run --rm -p 9000:9000 -e PORT=9000 magnet-forge-processing
```

The final image is a `python:3.11-slim`-based image running as a non-root
user (`appuser`, uid 1000), containing only the resolved (non-dev)
dependencies, `format/python`'s and `processing`'s source, and the sample
fixture — no test files, no build tools.

## Web app

Build (also from the repo root, so the Dockerfile can pull in
`docker/nginx.web.conf`):

```bash
docker build -f docker/Dockerfile.web -t magnet-forge-web .
```

Run it:

```bash
docker run --rm -p 8080:8080 magnet-forge-web
```

Verify:

```bash
curl -I http://localhost:8080/
# HTTP/1.1 200 OK ...
```

The final image is `nginxinc/nginx-unprivileged:1.27-alpine` (runs as a
non-root `nginx` user, uid 101, listening on 8080 by default) serving the
static output of `npm run build`.

### `VITE_API_BASE_URL` is a build-time setting, not a runtime one

Vite inlines `VITE_*` environment variables into the JS bundle at
**build time** (`npm run build`). Setting `VITE_API_BASE_URL` with
`docker run -e ...` has **no effect** — by the time the container starts,
the JavaScript has already been produced and baked into the image.

To point a built image at a given processing service URL, pass it as a
Docker build **argument** and rebuild for that target:

```bash
docker build -f docker/Dockerfile.web \
  --build-arg VITE_API_BASE_URL=https://processing.example.com \
  -t magnet-forge-web .
```

If omitted, it defaults to `http://localhost:8000` (matching
`web/.env.example`), suitable for local use alongside the processing
container above.

This means each deployment target that needs a different processing
service URL needs its own image build/tag. That is a deliberate
simplification — not an oversight — rather than adding a
runtime-substitution shim (e.g. rewriting the built JS at container start)
that this app doesn't need yet.

No secrets are involved here: `VITE_API_BASE_URL` is just the processing
service's base URL, same as in local dev (`web/.env.example`).

## Multi-architecture builds (amd64/arm64)

Both Dockerfiles are plain single-`FROM`-per-stage Dockerfiles with no
architecture-specific steps, so they're multi-arch-ready as-is via
`docker buildx`. For a real multi-arch build and push (e.g. from CI), use:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f docker/Dockerfile.processing \
  -t <registry>/magnet-forge-processing:<tag> \
  --push .

docker buildx build --platform linux/amd64,linux/arm64 \
  -f docker/Dockerfile.web \
  --build-arg VITE_API_BASE_URL=<url-for-this-target> \
  -t <registry>/magnet-forge-web:<tag> \
  --push .
```

**Note on verification:** the sandbox this was built and tested in has
Docker but not the `docker buildx` plugin installed, so the commands above
were not exercised here. What *was* verified locally is a native-arch
(`linux/amd64`) build and run of both images: the processing container
responding on `/health` and `/fixture`, and the web container serving its
`index.html` with a 200. Before relying on the multi-arch commands in a
real pipeline, run them once against a buildx-enabled builder (e.g. GitHub
Actions' `docker/setup-buildx-action`) to confirm.

## Local build + run in one shot (no compose)

A `docker-compose.yml` was deliberately not added — two `docker build` /
`docker run` commands per service is small enough to document directly
(above), and a compose file's own opinions about networking/volumes
would be more scaffolding than this ticket needs. Revisit if the number
of services or run-time flags grows.
