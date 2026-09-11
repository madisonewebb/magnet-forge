"""Pydantic models for the Magnet Forge project file format (schema version 1).

See ../../../SPEC.md for the authoritative human-readable contract. Field
shapes here should stay in sync with ../../schema/project_schema.json;
cross-field invariants that JSON Schema cannot express (id uniqueness,
palette references, dimension equality, finiteness) live here as
`model_validator`s.
"""

from __future__ import annotations

import math
import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _require_finite(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("value must be finite (NaN and Infinity are rejected)")
    return value


FiniteFloat = Annotated[float, AfterValidator(_require_finite)]
Point = tuple[FiniteFloat, FiniteFloat]


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceImageRef(_StrictModel):
    path: str = Field(min_length=1)
    width_px: int = Field(alias="widthPx", gt=0)
    height_px: int = Field(alias="heightPx", gt=0)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Mask(_StrictModel):
    path: str = Field(min_length=1)
    width_px: int = Field(alias="widthPx", gt=0)
    height_px: int = Field(alias="heightPx", gt=0)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class PaletteEntry(_StrictModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    color_hex: str = Field(alias="colorHex")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def _check_hex(self) -> "PaletteEntry":
        if not _HEX_COLOR_RE.match(self.color_hex):
            raise ValueError(f"colorHex {self.color_hex!r} must match ^#[0-9A-Fa-f]{{6}}$")
        return self


class Region(_StrictModel):
    id: str = Field(min_length=1)
    palette_id: str = Field(alias="paletteId", min_length=1)
    outer: list[Point] = Field(min_length=3)
    holes: list[list[Point]] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def _check_holes(self) -> "Region":
        for hole in self.holes:
            if len(hole) < 3:
                raise ValueError("each hole polygon must have at least 3 points")
        return self


class PhysicalDimensions(_StrictModel):
    target_width_mm: FiniteFloat = Field(alias="targetWidthMm", gt=0)
    total_thickness_mm: FiniteFloat = Field(alias="totalThicknessMm", gt=0)
    color_skin_thickness_mm: FiniteFloat = Field(alias="colorSkinThicknessMm", gt=0)
    backing_border_width_mm: FiniteFloat = Field(alias="backingBorderWidthMm", ge=0)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def _check_skin_within_thickness(self) -> "PhysicalDimensions":
        if self.color_skin_thickness_mm >= self.total_thickness_mm:
            raise ValueError(
                "colorSkinThicknessMm must be less than totalThicknessMm "
                f"(got {self.color_skin_thickness_mm} >= {self.total_thickness_mm})"
            )
        return self


class PrintProfile(_StrictModel):
    printer_name: str = Field(alias="printerName", min_length=1)
    nozzle_diameter_mm: FiniteFloat = Field(alias="nozzleDiameterMm", gt=0)
    material_name: str = Field(alias="materialName", min_length=1)
    layer_height_mm: FiniteFloat = Field(alias="layerHeightMm", gt=0)
    min_feature_size_mm: FiniteFloat = Field(alias="minFeatureSizeMm", gt=0)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Pocket(_StrictModel):
    id: str = Field(min_length=1)
    kind: Literal["discMagnetRearOpenGlueIn"]
    diameter_mm: FiniteFloat = Field(alias="diameterMm", gt=0)
    depth_mm: FiniteFloat = Field(alias="depthMm", gt=0)
    x_mm: FiniteFloat = Field(alias="xMm")
    y_mm: FiniteFloat = Field(alias="yMm")
    clearance_mm: FiniteFloat = Field(alias="clearanceMm", ge=0)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class PocketSettings(_StrictModel):
    pockets: list[Pocket] = Field(default_factory=list)


class ProjectFile(_StrictModel):
    schema_version: Literal["1"] = Field(alias="schemaVersion")
    source_image: SourceImageRef = Field(alias="sourceImage")
    mask: Mask
    palette: list[PaletteEntry] = Field(min_length=2, max_length=8)
    regions: list[Region] = Field(default_factory=list)
    physical_dimensions: PhysicalDimensions = Field(alias="physicalDimensions")
    print_profile: PrintProfile = Field(alias="printProfile")
    pocket_settings: PocketSettings = Field(alias="pocketSettings")
    extensions: dict = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def _check_cross_references(self) -> "ProjectFile":
        if self.mask.width_px != self.source_image.width_px:
            raise ValueError(
                "mask.widthPx must equal sourceImage.widthPx "
                f"(got {self.mask.width_px} != {self.source_image.width_px})"
            )
        if self.mask.height_px != self.source_image.height_px:
            raise ValueError(
                "mask.heightPx must equal sourceImage.heightPx "
                f"(got {self.mask.height_px} != {self.source_image.height_px})"
            )

        palette_ids = [entry.id for entry in self.palette]
        if len(set(palette_ids)) != len(palette_ids):
            raise ValueError("palette entries must have unique ids")
        palette_id_set = set(palette_ids)

        region_ids = [region.id for region in self.regions]
        if len(set(region_ids)) != len(region_ids):
            raise ValueError("region ids must be unique within a project")
        for region in self.regions:
            if region.palette_id not in palette_id_set:
                raise ValueError(
                    f"region {region.id!r} references unknown paletteId {region.palette_id!r}"
                )

        pocket_ids = [pocket.id for pocket in self.pocket_settings.pockets]
        if len(set(pocket_ids)) != len(pocket_ids):
            raise ValueError("pocket ids must be unique within a project")

        return self
