"""Load, parse, and serialize Magnet Forge project files."""

from __future__ import annotations

from pathlib import Path

from .models import ProjectFile


def parse_project_json(data: str | bytes) -> ProjectFile:
    return ProjectFile.model_validate_json(data)


def load_project(path: str | Path) -> ProjectFile:
    return parse_project_json(Path(path).read_bytes())


def dump_project_json(project: ProjectFile, *, indent: int = 2) -> str:
    # pydantic's model_dump_json rejects non-finite floats by construction
    # (FiniteFloat already forbids them on the model), so this is the only
    # serialization path callers need.
    return project.model_dump_json(by_alias=True, indent=indent)
