"""Image-pixel <-> model-space (mm) coordinate transforms.

See ../../../SPEC.md#image-to-model-transforms for the derivation and the
worked example these functions are tested against. Model space is Y-up;
image space is Y-down; the rear transform mirrors X about the vertical
center axis (Y is untouched) and places the point at z = totalThicknessMm.
"""

from __future__ import annotations


def _scale(width_px: int, target_width_mm: float) -> float:
    return target_width_mm / width_px


def image_to_front_model(
    px: float,
    py: float,
    *,
    width_px: int,
    height_px: int,
    target_width_mm: float,
) -> tuple[float, float, float]:
    """Map a front-view image pixel to a front-face model point (z=0)."""
    s = _scale(width_px, target_width_mm)
    x_mm = px * s
    y_mm = (height_px - py) * s
    return (x_mm, y_mm, 0.0)


def image_to_rear_model(
    px: float,
    py: float,
    *,
    width_px: int,
    height_px: int,
    target_width_mm: float,
    total_thickness_mm: float,
) -> tuple[float, float, float]:
    """Map a rear-view image pixel to a back-face model point.

    The rear view is the front artwork mirrored across the vertical axis
    (like flipping a page left-to-right), so a rear-view pick at pixel
    (px, py) corresponds to the same physical point as front-view pixel
    (width_px - px, py).
    """
    s = _scale(width_px, target_width_mm)
    x_mm = target_width_mm - px * s
    y_mm = (height_px - py) * s
    return (x_mm, y_mm, total_thickness_mm)
