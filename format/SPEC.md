# Magnet Forge project format (schema version 1)

This document is the contract for the `.json` project file shared by the web
editor, the processing service's geometry engine, and any future exporters.
It complements the machine-readable schema at
[`schema/project_schema.json`](schema/project_schema.json) and the reference
implementation in [`python/`](python/); when this document and either of
those disagree, this document wins and the other should be fixed.

## Units and conventions

- All physical/model values are in **millimeters**.
- Image pixel coordinates are continuous, origin at the top-left corner,
  X increasing to the right, Y increasing **downward** (standard image
  convention). A pixel's center is at `(x + 0.5, y + 0.5)`.
- Model coordinates are in millimeters, X increasing to the right, Y
  increasing **upward**. This is a deliberate, named decision: model space
  is Y-up (matching conventional CAD/3D-print tooling), which means every
  image-to-model transform includes a vertical flip. This is the single
  easiest detail for an implementer to get backwards — it is called out
  here on purpose, not left implicit in a formula.
- `schemaVersion` is the string `"1"` for this version of the format. A
  breaking change to any field described below requires a new schema
  version; additive, optional fields may be added under `extensions`
  (see below) without a version bump.

## Top-level fields

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"1"` | Literal version string. |
| `sourceImage` | `SourceImageRef` | The uploaded artwork this project derives from. |
| `mask` | `Mask` | Background/foreground mask, same pixel grid as `sourceImage`. |
| `palette` | `PaletteEntry[2..8]` | 2 to 8 named colors used by `regions`. |
| `regions` | `Region[]` | Vector regions traced from the artwork. |
| `physicalDimensions` | `PhysicalDimensions` | Target print size and thickness. |
| `printProfile` | `PrintProfile` | Printer/material assumptions driving tolerances. |
| `pocketSettings` | `PocketSettings` | Rear magnet pockets. |
| `extensions` | `object` | Default `{}`. Escape hatch for fields introduced by later epics (e.g. raised-detail relief height, AI-simplification provenance) without retrofitting the core objects above or bumping `schemaVersion`. Every other object in this format rejects unknown fields; only `extensions` accepts them. |

### `SourceImageRef`

| Field | Type | Notes |
|---|---|---|
| `path` | `string` | Relative reference to the uploaded image. Need not resolve to a real file for schema-level validation. |
| `widthPx` | `integer > 0` | |
| `heightPx` | `integer > 0` | |

### `Mask`

| Field | Type | Notes |
|---|---|---|
| `path` | `string` | Relative reference to the mask raster. |
| `widthPx` | `integer > 0` | Must equal `sourceImage.widthPx` (validated invariant, not expressible in JSON Schema alone). |
| `heightPx` | `integer > 0` | Must equal `sourceImage.heightPx`. |

The mask is assumed to be a raster on the same pixel grid as `sourceImage`
(e.g. an alpha/foreground mask produced by background removal). If a future
epic needs a vector mask representation, that is a new, additive field —
not a change to this one.

### `PaletteEntry`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Stable identifier, referenced by `Region.paletteId`. |
| `name` | `string` | User-facing color name. |
| `colorHex` | `string` | Pattern `^#[0-9A-Fa-f]{6}$`. |

`palette` must have between 2 and 8 entries with unique `id`s.

### `Region`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Stable identifier. See "Stable IDs" below. |
| `paletteId` | `string` | Must reference an existing `palette[].id`. |
| `outer` | `[number, number][]`, 3+ points | Outer boundary polygon, in **image pixel space**. |
| `holes` | `[number, number][][]` | Default `[]`. Each inner polygon has 3+ points, also in image pixel space. |

A region with one entry in `holes` is how a ring/donut-shaped area (a hole
punched through the color region) is represented. A "narrow feature" is not
a distinct schema concept — it is simply a region whose polygon has two
edges that pass close together; later epics (thin-feature detection, etc.)
reason about geometry, not about a schema field.

### `PhysicalDimensions`

| Field | Type | Notes |
|---|---|---|
| `targetWidthMm` | `number > 0` | The authoritative size input. |
| `totalThicknessMm` | `number > 0` | Front (z=0) to back (z=totalThicknessMm). |
| `colorSkinThicknessMm` | `number > 0` | Must be `< totalThicknessMm`. See "Z intervals" below. |
| `backingBorderWidthMm` | `number >= 0` | Width of the solid backing border around traced artwork. |

`targetHeightMm` is deliberately **not** a field: height is derived from
`sourceImage`'s pixel aspect ratio and `targetWidthMm` (aspect ratio is
locked), so storing it separately would let the two contradict each other.

### `PrintProfile`

| Field | Type | Notes |
|---|---|---|
| `printerName` | `string` | |
| `nozzleDiameterMm` | `number > 0` | |
| `materialName` | `string` | |
| `layerHeightMm` | `number > 0` | |
| `minFeatureSizeMm` | `number > 0` | Minimum-feature/cleanup threshold tied to this profile. |

### `PocketSettings` / `Pocket`

| Field | Type | Notes |
|---|---|---|
| `pockets` | `Pocket[]` | Default `[]`. |

| `Pocket` field | Type | Notes |
|---|---|---|
| `id` | `string` | Stable identifier. |
| `kind` | `"discMagnetRearOpenGlueIn"` | Literal-enum string. Only one kind exists in v1 (disc magnet, rear-open, glue-in); modeling it as an enum-of-one now means a future kind (press-fit, square magnet, ...) is an additive enum value, not a breaking shape change. |
| `diameterMm` | `number > 0` | |
| `depthMm` | `number > 0` | |
| `xMm` | `number` | Placement in **rear-view model space**, mm. See "Rear-view picking" below. |
| `yMm` | `number` | Placement in rear-view model space, mm. |
| `clearanceMm` | `number >= 0` | |

A 6mm-diameter, 2mm-thick disc magnet is used as an illustrative
calibration example in the fixture; it is **not** a locked preset or a
schema default.

## Stable IDs

`Region.id` and `Pocket.id` must remain stable across edits — a tool that
recolors, moves, or reshapes a region or pocket must preserve its `id` so
that other consumers (undo/redo, saved-project diffing, exporters) can
track the same logical entity across versions of a project file. This is a
consuming-tool invariant, not something the schema itself can enforce
beyond requiring uniqueness within a single file.

## Flat-face z convention

In flat-face mode (the only mode this schema version supports — raised
relief detail is a later, additive epic):

- The visible **front** face is at **z = 0**.
- The **back** face is at **z = totalThicknessMm**.
- The **color-skin interval** is `z ∈ [0, colorSkinThicknessMm)` — the thin
  front layer where palette colors are visible.
- The **backing interval** is `z ∈ [colorSkinThicknessMm, totalThicknessMm]`
  — the structural base, into which rear pockets are cut from the back.

## Image-to-model transforms

Let `s = targetWidthMm / sourceImage.widthPx` (uniform scale). Model height
is derived as `sourceImage.heightPx * s` and is never stored independently.

### Front transform

Maps a front-view image pixel `(px, py)` to a front-face model point:

```
x_mm = px * s
y_mm = (sourceImage.heightPx - py) * s
z_mm = 0
```

### Rear-view picking (rear transform)

The rear view is presented to the user as the front artwork **mirrored
across the vertical axis** — the same mental model as physically flipping a
flat object left-to-right, like flipping a page, to see its back. A pixel
picked at rear-view coordinates `(px, py)` (on a canvas sharing the same
`widthPx × heightPx` grid as `sourceImage`) corresponds to the same
physical point as front-view pixel `(widthPx - px, py)`. Substituting into
the front transform:

```
x_mm = targetWidthMm - px * s
y_mm = (sourceImage.heightPx - py) * s
z_mm = totalThicknessMm
```

Only X mirrors; Y is untouched because the mirror axis is vertical.

### Worked example (used by the reference-implementation tests)

`sourceImage.widthPx = 100`, `heightPx = 60`, `targetWidthMm = 50` ⇒
`s = 0.5`, derived model height = `30mm`.

| Pixel | Front model (mm) | Rear model (mm), `totalThicknessMm = 4` |
|---|---|---|
| `(10.5, 5.5)` | `(5.25, 27.25, 0)` | `(44.75, 27.25, 4)` |
| `(0, 0)` | `(0, 30, 0)` | `(50, 30, 4)` |

Structurally: `image_to_rear_model(px, py, ...)` always equals
`image_to_front_model(widthPx - px, py, ...)` with `z` replaced by
`totalThicknessMm` — this mirror relationship, not just the sampled
points above, is what the reference implementation's tests assert.

## Validity rules enforced beyond field types/ranges

These are cross-field invariants the reference implementation validates
(and any other implementation of this format must also validate):

- `mask.widthPx == sourceImage.widthPx` and `mask.heightPx == sourceImage.heightPx`.
- All `Region.id` values are unique within a project.
- All `Pocket.id` values are unique within a project.
- Every `Region.paletteId` references an existing `palette[].id`.
- `physicalDimensions.colorSkinThicknessMm < physicalDimensions.totalThicknessMm`.
- Every numeric field is finite — `NaN` and `±Infinity` are rejected, both
  when constructing a project in memory and when serializing one to JSON.

## Compatibility

New, optional fields for features out of scope for this schema version
(raised-detail relief height per region, AI-simplification variant
provenance, etc.) should be added either as new optional fields under a
future minor schema version, or staged under the top-level `extensions`
object in the meantime — not by loosening validation on the core objects
described above.
