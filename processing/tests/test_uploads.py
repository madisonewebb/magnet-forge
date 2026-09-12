import base64
import io

import pytest
from PIL import Image
from fastapi.testclient import TestClient

from magnet_forge_processing.main import app
from magnet_forge_processing.settings import UploadLimits, get_upload_limits

client = TestClient(app)


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _jpeg_bytes_with_orientation(image: Image.Image, orientation: int) -> bytes:
    """Build a tiny JPEG with a given EXIF Orientation tag (0x0112)."""
    exif = Image.Exif()
    exif[0x0112] = orientation
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def test_upload_transparent_png_preserves_alpha():
    # A 10x4 image, half opaque red / half fully transparent.
    image = Image.new("RGBA", (10, 4), (255, 0, 0, 255))
    for x in range(5, 10):
        for y in range(4):
            image.putpixel((x, y), (0, 0, 0, 0))

    response = client.post(
        "/uploads",
        files={"file": ("art.png", _png_bytes(image), "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["width"] == 10
    assert body["height"] == 4
    assert body["hasAlpha"] is True
    assert body["format"] == "PNG"
    assert body["imageDataUrl"].startswith("data:image/png;base64,")

    # The returned image really is decodable PNG with alpha, not just a
    # metadata claim.
    encoded = body["imageDataUrl"].removeprefix("data:image/png;base64,")
    decoded = Image.open(io.BytesIO(base64.b64decode(encoded)))
    assert decoded.mode == "RGBA"
    assert decoded.size == (10, 4)
    assert decoded.getpixel((0, 0))[3] == 255
    assert decoded.getpixel((9, 0))[3] == 0


def test_upload_rotated_jpeg_is_orientation_normalized():
    # A 20x10 (wide) source image, tagged with EXIF orientation 6
    # ("rotate 270"), which viewers must rotate 90deg clockwise to display
    # upright — i.e. the *displayed* image is 10 wide x 20 tall.
    raw = Image.new("RGB", (20, 10), (0, 128, 255))
    jpeg_bytes = _jpeg_bytes_with_orientation(raw, orientation=6)

    # Sanity-check the fixture actually carries the raw, un-rotated
    # dimensions and the orientation tag before it reaches the endpoint.
    reopened = Image.open(io.BytesIO(jpeg_bytes))
    assert reopened.size == (20, 10)
    assert reopened.getexif().get(0x0112) == 6

    response = client.post(
        "/uploads",
        files={"file": ("art.jpg", jpeg_bytes, "image/jpeg")},
    )

    assert response.status_code == 200
    body = response.json()
    # Normalized (post-rotation) dimensions, not the raw on-disk ones.
    assert body["width"] == 10
    assert body["height"] == 20
    assert body["hasAlpha"] is False
    assert body["format"] == "PNG"

    encoded = body["imageDataUrl"].removeprefix("data:image/png;base64,")
    decoded = Image.open(io.BytesIO(base64.b64decode(encoded)))
    assert decoded.size == (10, 20)


def test_upload_corrupt_data_returns_clear_4xx():
    response = client.post(
        "/uploads",
        files={"file": ("art.png", b"not-an-image-just-garbage-bytes", "image/png")},
    )

    assert 400 <= response.status_code < 500
    body = response.json()
    assert "detail" in body
    assert isinstance(body["detail"], str)
    assert body["detail"]  # human-readable, non-empty


def test_upload_wrong_format_is_rejected_even_with_misleading_extension():
    # A GIF disguised with a .png extension and image/png content-type:
    # format is validated by decoding, not by trusting the client.
    gif = Image.new("RGB", (4, 4), (1, 2, 3))
    buffer = io.BytesIO()
    gif.save(buffer, format="GIF")

    response = client.post(
        "/uploads",
        files={"file": ("sneaky.png", buffer.getvalue(), "image/png")},
    )

    assert response.status_code == 415
    assert "PNG" in response.json()["detail"] or "JPEG" in response.json()["detail"]


def test_upload_oversized_file_is_rejected_before_dimension_check():
    # Fake "too large" cheaply by lowering the limit via dependency
    # override, rather than constructing a real 25MB fixture.
    tiny_png = _png_bytes(Image.new("RGBA", (4, 4), (0, 0, 0, 0)))
    assert len(tiny_png) > 16  # sanity: our override below is smaller than this

    app.dependency_overrides[get_upload_limits] = lambda: UploadLimits(
        max_file_size_bytes=16, max_dimension_px=8000
    )
    try:
        response = client.post(
            "/uploads",
            files={"file": ("art.png", tiny_png, "image/png")},
        )
    finally:
        app.dependency_overrides.pop(get_upload_limits, None)

    assert response.status_code == 413
    assert "too large" in response.json()["detail"].lower()


def test_upload_oversized_dimensions_are_rejected():
    app.dependency_overrides[get_upload_limits] = lambda: UploadLimits(
        max_file_size_bytes=25 * 1024 * 1024, max_dimension_px=8
    )
    try:
        image = Image.new("RGB", (20, 5), (10, 20, 30))
        response = client.post(
            "/uploads",
            files={"file": ("art.png", _png_bytes(image), "image/png")},
        )
    finally:
        app.dependency_overrides.pop(get_upload_limits, None)

    assert response.status_code == 422
    assert "dimensions" in response.json()["detail"].lower()


@pytest.fixture(autouse=True)
def _reset_dependency_overrides():
    yield
    app.dependency_overrides.pop(get_upload_limits, None)
