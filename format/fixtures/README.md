# Fixtures

`sample_project.json` is a small, hand-authored project file used to test
the reference implementation in `../python/` (round-trip, transforms,
validation) and, later, by the processing service's `/fixture` endpoint
(S02).

Notes:

- `region-ring` exercises a region with a hole (a hole is punched inside
  its outer boundary). `region-narrow-feature` includes a thin protrusion
  (a 2px-wide spike) to exercise later thin-feature handling. Together with
  `region-triangle` these use all 3 palette colors.
- `sourceImage.path` and `mask.path` are placeholder filenames — no binary
  image assets exist yet or are required for schema-level validation.
- The pocket's `diameterMm: 6, depthMm: 2` values are an **illustrative**
  calibration example, not a locked preset or schema default (see
  `../SPEC.md`).
