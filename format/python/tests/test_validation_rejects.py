import copy
import json
import math
from pathlib import Path

import pytest
from pydantic import ValidationError

from magnet_forge_format import ProjectFile


@pytest.fixture
def fixture_data(fixture_path: Path) -> dict:
    return json.loads(fixture_path.read_text())


def _key(container, key: str):
    return int(key) if isinstance(container, list) else key


def _mutate(data: dict, **overrides):
    mutated = copy.deepcopy(data)
    for path, value in overrides.items():
        target = mutated
        keys = path.split(".")
        for key in keys[:-1]:
            target = target[_key(target, key)]
        target[_key(target, keys[-1])] = value
    return mutated


@pytest.mark.parametrize(
    "bad_value",
    [math.nan, math.inf, -math.inf],
)
def test_rejects_nonfinite_thickness(fixture_data: dict, bad_value: float):
    data = copy.deepcopy(fixture_data)
    data["physicalDimensions"]["totalThicknessMm"] = bad_value

    with pytest.raises(ValidationError):
        ProjectFile.model_validate(data)


def test_rejects_negative_nozzle_diameter(fixture_data: dict):
    data = _mutate(fixture_data, **{"printProfile.nozzleDiameterMm": -0.4})

    with pytest.raises(ValidationError):
        ProjectFile.model_validate(data)


def test_rejects_zero_target_width(fixture_data: dict):
    data = _mutate(fixture_data, **{"physicalDimensions.targetWidthMm": 0})

    with pytest.raises(ValidationError):
        ProjectFile.model_validate(data)


def test_rejects_duplicate_region_ids(fixture_data: dict):
    data = copy.deepcopy(fixture_data)
    data["regions"][1]["id"] = data["regions"][0]["id"]

    with pytest.raises(ValidationError, match="region ids must be unique"):
        ProjectFile.model_validate(data)


def test_rejects_duplicate_pocket_ids(fixture_data: dict):
    data = copy.deepcopy(fixture_data)
    extra_pocket = copy.deepcopy(data["pocketSettings"]["pockets"][0])
    data["pocketSettings"]["pockets"].append(extra_pocket)

    with pytest.raises(ValidationError, match="pocket ids must be unique"):
        ProjectFile.model_validate(data)


def test_rejects_region_with_unknown_palette_id(fixture_data: dict):
    data = _mutate(fixture_data, **{"regions.0.paletteId": "not-a-real-color"})

    with pytest.raises(ValidationError, match="unknown paletteId"):
        ProjectFile.model_validate(data)


def test_rejects_skin_thickness_not_less_than_total(fixture_data: dict):
    data = copy.deepcopy(fixture_data)
    data["physicalDimensions"]["colorSkinThicknessMm"] = data["physicalDimensions"][
        "totalThicknessMm"
    ]

    with pytest.raises(ValidationError, match="colorSkinThicknessMm must be less than"):
        ProjectFile.model_validate(data)


def test_rejects_mask_dimension_mismatch(fixture_data: dict):
    data = _mutate(fixture_data, **{"mask.widthPx": 999})

    with pytest.raises(ValidationError, match="mask.widthPx must equal"):
        ProjectFile.model_validate(data)


def test_rejects_palette_outside_size_bounds(fixture_data: dict):
    data = copy.deepcopy(fixture_data)
    data["palette"] = data["palette"][:1]  # only 1 entry, minimum is 2

    with pytest.raises(ValidationError):
        ProjectFile.model_validate(data)


def test_valid_fixture_passes(fixture_data: dict):
    # Sanity check that the mutation helpers above are actually exercising
    # validation failures and not e.g. silently no-op-ing.
    ProjectFile.model_validate(fixture_data)
