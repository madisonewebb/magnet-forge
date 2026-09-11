"""Resolves the S01 sample project fixture used by the /fixture endpoint.

The fixture is single-sourced at ../format/fixtures/sample_project.json
(relative to the repo root) rather than copied into this service. This
package isn't meant to be installed/published outside this monorepo at
this stage, so resolving the path relative to this file is acceptable;
FIXTURE_PATH overrides it for flexibility (e.g. containerized deploys).
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from magnet_forge_format import ProjectFile, load_project

_DEFAULT_FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "format" / "fixtures" / "sample_project.json"
)


def _fixture_path() -> Path:
    override = os.environ.get("FIXTURE_PATH")
    return Path(override) if override else _DEFAULT_FIXTURE_PATH


@lru_cache
def load_fixture_project() -> ProjectFile:
    return load_project(_fixture_path())
