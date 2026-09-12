"""POST /uploads — accept source artwork (S04).

Scope: this endpoint only decodes, normalizes orientation, validates, and
echoes back a preview-ready image plus metadata. It does not create or
persist a project file (that pipeline — background removal, palette
reduction, vectorization — belongs to later, separate tickets).

Response shape: a small JSON envelope with metadata fields (width, height,
whether the image has an alpha channel) plus the orientation-normalized
image re-encoded as PNG and returned as a base64 data URL
(`imageDataUrl`). This was chosen over raw image bytes + header metadata
because it keeps the response self-contained and trivial for the web
client to render directly via `<img src>` — the tradeoff is ~33% base64
overhead, which is acceptable at these size limits for a single
interactively-uploaded image.

The response is always PNG regardless of the input format: normalizing
EXIF orientation requires re-encoding anyway, and PNG uniformly supports
an alpha channel, which keeps the client's rendering path uniform for both
PNG and JPEG sources.
"""

from __future__ import annotations

import base64
import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field

from ..settings import UploadLimits, get_upload_limits

router = APIRouter()

# Content is validated by decoding it with Pillow, not by trusting the
# filename extension or the browser-supplied Content-Type — both are
# attacker/user controlled and a file can be renamed to wear a misleading
# extension. Only these two Pillow-reported formats are accepted.
_ACCEPTED_FORMATS = {"PNG", "JPEG"}


class UploadResponse(BaseModel):
    width: int
    height: int
    has_alpha: bool = Field(alias="hasAlpha")
    format: str
    image_data_url: str = Field(alias="imageDataUrl")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def _reject_corrupt(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="The file could not be decoded. It may be corrupt, truncated, or not a valid image.",
    )


@router.post("/uploads", response_model=UploadResponse, response_model_by_alias=True)
async def create_upload(
    file: UploadFile = File(...),
    limits: UploadLimits = Depends(get_upload_limits),
) -> UploadResponse:
    data = await file.read()

    # File size is checked first, and cheaply, before any image decoding.
    if len(data) > limits.max_file_size_bytes:
        max_mb = limits.max_file_size_bytes / (1024 * 1024)
        got_mb = len(data) / (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"File is too large ({got_mb:.1f} MB). The maximum allowed size is {max_mb:.0f} MB.",
        )

    try:
        image = Image.open(io.BytesIO(data))
        # Force Pillow to parse the header now (cheap relative to a full
        # pixel decode) so a garbage/truncated file that fools the initial
        # signature sniff is still caught here, before it can reach a
        # dimensions check.
        image_format = image.format
    except UnidentifiedImageError as exc:
        raise _reject_corrupt(exc) from exc
    except OSError as exc:
        raise _reject_corrupt(exc) from exc

    if image_format not in _ACCEPTED_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=(
                f"Unsupported image format '{image_format or 'unknown'}'. "
                "Only PNG and JPEG are accepted."
            ),
        )

    # Dimensions are read from the (already-parsed) header, before the
    # expensive full pixel decode below, per the acceptance criteria.
    width, height = image.size
    if max(width, height) > limits.max_dimension_px:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"Image dimensions ({width}x{height}px) exceed the maximum of "
                f"{limits.max_dimension_px}px on the longest side."
            ),
        )

    try:
        # exif_transpose forces a full decode internally; this is where a
        # truncated-but-header-valid file (or corrupt pixel data) surfaces.
        normalized = ImageOps.exif_transpose(image) or image
        normalized.load()
    except (OSError, SyntaxError) as exc:
        raise _reject_corrupt(exc) from exc

    has_alpha = normalized.mode in ("RGBA", "LA") or (
        normalized.mode == "P" and "transparency" in normalized.info
    )
    normalized = normalized.convert("RGBA") if has_alpha else normalized.convert("RGB")

    buffer = io.BytesIO()
    normalized.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")

    out_width, out_height = normalized.size
    return UploadResponse(
        width=out_width,
        height=out_height,
        hasAlpha=has_alpha,
        format="PNG",
        imageDataUrl=f"data:image/png;base64,{encoded}",
    )
