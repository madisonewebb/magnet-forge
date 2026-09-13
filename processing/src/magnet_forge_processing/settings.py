"""Configurable limits for the processing service.

Exposed as a FastAPI dependency (`get_upload_limits`) rather than module-level
constants so tests can override it via `app.dependency_overrides` instead of
monkeypatching module state or actually uploading multi-megabyte fixtures.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# Documented upload limits (see docs/DEVELOPMENT.md and README/PR description
# for rationale): 25 MB is comfortably above any PNG/JPEG a maker would
# realistically upload from a phone or camera while still bounding memory
# use per request; 8000px on the longest side is far beyond what the
# eventual print pipeline needs (magnets are small physical objects) while
# still allowing high-resolution source art.
DEFAULT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_DIMENSION_PX = 8000


@dataclass(frozen=True)
class UploadLimits:
    max_file_size_bytes: int = DEFAULT_MAX_FILE_SIZE_BYTES
    max_dimension_px: int = DEFAULT_MAX_DIMENSION_PX


def get_upload_limits() -> UploadLimits:
    """FastAPI dependency returning the active upload limits.

    Reads from environment variables so limits can be tuned without a code
    change, and is override-friendly for tests
    (`app.dependency_overrides[get_upload_limits] = lambda: UploadLimits(...)`).
    """
    return UploadLimits(
        max_file_size_bytes=int(
            os.environ.get("MAGNET_FORGE_MAX_UPLOAD_BYTES", DEFAULT_MAX_FILE_SIZE_BYTES)
        ),
        max_dimension_px=int(
            os.environ.get("MAGNET_FORGE_MAX_UPLOAD_DIMENSION_PX", DEFAULT_MAX_DIMENSION_PX)
        ),
    )
