from pathlib import Path

import pytest

from magnet_forge_format import ProjectFile, load_project

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "fixtures" / "sample_project.json"


@pytest.fixture
def fixture_path() -> Path:
    return FIXTURE_PATH


@pytest.fixture
def loaded_fixture() -> ProjectFile:
    return load_project(FIXTURE_PATH)
