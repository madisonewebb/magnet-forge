import pytest

from magnet_forge_format import image_to_front_model, image_to_rear_model

WIDTH_PX = 100
HEIGHT_PX = 60
TARGET_WIDTH_MM = 50.0
TOTAL_THICKNESS_MM = 4.0


def _front(px: float, py: float) -> tuple[float, float, float]:
    return image_to_front_model(
        px, py, width_px=WIDTH_PX, height_px=HEIGHT_PX, target_width_mm=TARGET_WIDTH_MM
    )


def _rear(px: float, py: float) -> tuple[float, float, float]:
    return image_to_rear_model(
        px,
        py,
        width_px=WIDTH_PX,
        height_px=HEIGHT_PX,
        target_width_mm=TARGET_WIDTH_MM,
        total_thickness_mm=TOTAL_THICKNESS_MM,
    )


def test_front_known_point_matches_spec_worked_example():
    x, y, z = _front(10.5, 5.5)
    assert x == pytest.approx(5.25)
    assert y == pytest.approx(27.25)
    assert z == 0.0


def test_rear_known_point_matches_spec_worked_example():
    x, y, z = _rear(10.5, 5.5)
    assert x == pytest.approx(44.75)
    assert y == pytest.approx(27.25)
    assert z == TOTAL_THICKNESS_MM


def test_front_origin_corner():
    assert _front(0, 0) == pytest.approx((0.0, 30.0, 0.0))


def test_rear_origin_corner():
    assert _rear(0, 0) == pytest.approx((50.0, 30.0, TOTAL_THICKNESS_MM))


@pytest.mark.parametrize(
    ("px", "py"),
    [(0, 0), (10.5, 5.5), (50, 30), (99.5, 0.5), (0.5, 59.5)],
)
def test_rear_mirrors_front_across_vertical_axis(px: float, py: float):
    rear = _rear(px, py)
    mirrored_front = _front(WIDTH_PX - px, py)

    assert rear[0] == pytest.approx(mirrored_front[0])
    assert rear[1] == pytest.approx(mirrored_front[1])
    assert rear[2] == TOTAL_THICKNESS_MM
    assert mirrored_front[2] == 0.0
