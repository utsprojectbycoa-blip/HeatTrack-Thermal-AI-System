"""
duck_temperature.py - measure a detected duck's temperature in a thermal frame.

The webcam detector (YOLO, added later) gives a box around each duck or
duck head in webcam pixels. This module maps that box onto the 32x24
thermal frame and extracts a temperature reading, rejecting readings that
are likely to be wrong.

Readings are SKIN-SURFACE temperatures. Converting them to core body
temperature needs a correction fitted against cloacal thermometer
readings from your own ducks (core_offset_c is a placeholder for that).
"""

from dataclasses import dataclass, field
from typing import List, Optional, Sequence, Tuple

import numpy as np

Box = Tuple[float, float, float, float]  # x1, y1, x2, y2


@dataclass
class MeasureSettings:
    min_pixels_wide: int = 2        # fully covered thermal pixels across the box
    min_pixels_high: int = 2
    edge_margin: int = 1            # boxes touching the frame edge may be cut off
    max_overlap: float = 0.2        # max share of the box covered by another duck
    min_valid_c: float = 30.0       # plausible duck skin range; outside = reject
    max_valid_c: float = 46.0
    top_k: int = 3                  # "high" temperature = mean of the hottest k pixels
    core_offset_c: float = 0.0      # skin-to-core correction, fit from your data


@dataclass
class DuckReading:
    valid: bool
    reason: str
    max_c: Optional[float] = None       # hottest pixel
    high_c: Optional[float] = None      # mean of hottest top_k pixels (more robust)
    p95_c: Optional[float] = None
    estimated_body_c: Optional[float] = None
    n_pixels: int = 0
    thermal_box: Optional[Box] = None
    hottest_pixel: Optional[Tuple[int, int]] = field(default=None)  # (row, col)


def webcam_box_to_thermal(box: Box, homography: np.ndarray) -> Box:
    """Map a webcam box to thermal pixel coordinates using the 3x3
    homography from the camera-alignment calibration."""
    x1, y1, x2, y2 = box
    corners = np.array([[x1, y1, 1], [x2, y1, 1], [x2, y2, 1], [x1, y2, 1]], dtype=float).T
    mapped = homography @ corners
    mapped = mapped[:2] / mapped[2]
    return (float(mapped[0].min()), float(mapped[1].min()),
            float(mapped[0].max()), float(mapped[1].max()))


def _area(b: Box) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _overlap_fraction(box: Box, others: Sequence[Box]) -> float:
    """Largest share of `box` covered by any other box."""
    area = _area(box)
    if area == 0:
        return 1.0
    worst = 0.0
    for o in others:
        ix = max(0.0, min(box[2], o[2]) - max(box[0], o[0]))
        iy = max(0.0, min(box[3], o[3]) - max(box[1], o[1]))
        worst = max(worst, ix * iy / area)
    return worst


def measure_duck(frame: np.ndarray, thermal_box: Box,
                 other_boxes: Sequence[Box] = (),
                 settings: MeasureSettings = MeasureSettings()) -> DuckReading:
    """Measure one duck (or duck head) inside a thermal frame.

    frame        : (24, 32) array of deg C from ThermalCamera.read_frame
    thermal_box  : box in thermal pixel coordinates (x = column, y = row);
                   pixel (r, c) spans x in [c, c+1), y in [r, r+1)
    other_boxes  : the other ducks' thermal boxes in the same frame
    """
    rows, cols = frame.shape
    x1, y1, x2, y2 = thermal_box
    reading = DuckReading(valid=False, reason="", thermal_box=thermal_box)

    m = settings.edge_margin
    if x1 < m or y1 < m or x2 > cols - m or y2 > rows - m:
        reading.reason = "touches frame edge (may be cut off)"
        return reading

    # Only pixels lying completely inside the box, so no pixel mixes
    # duck and background (which would read too cold).
    c1, c2 = int(np.ceil(x1)), int(np.floor(x2))
    r1, r2 = int(np.ceil(y1)), int(np.floor(y2))
    if c2 - c1 < settings.min_pixels_wide or r2 - r1 < settings.min_pixels_high:
        reading.reason = "too small in thermal image (too far from camera)"
        return reading

    if _overlap_fraction(thermal_box, other_boxes) > settings.max_overlap:
        reading.reason = "overlaps another duck"
        return reading

    region = frame[r1:r2, c1:c2]
    values = region[np.isfinite(region)].ravel()
    reading.n_pixels = int(values.size)
    if values.size == 0:
        reading.reason = "no valid pixels"
        return reading

    hottest = float(values.max())
    if not settings.min_valid_c <= hottest <= settings.max_valid_c:
        reading.reason = f"hottest pixel {hottest:.1f} C outside plausible duck range"
        return reading

    k = min(settings.top_k, values.size)
    high = float(np.sort(values)[-k:].mean())
    rr, cc = np.unravel_index(int(np.nanargmax(region)), region.shape)

    reading.valid = True
    reading.reason = "ok"
    reading.max_c = round(hottest, 2)
    reading.high_c = round(high, 2)
    reading.p95_c = round(float(np.percentile(values, 95)), 2)
    reading.estimated_body_c = round(high + settings.core_offset_c, 2)
    reading.hottest_pixel = (r1 + int(rr), c1 + int(cc))
    return reading


def measure_ducks(frame: np.ndarray, thermal_boxes: List[Box],
                  settings: MeasureSettings = MeasureSettings()) -> List[DuckReading]:
    """Measure every detected duck in one frame."""
    results = []
    for i, box in enumerate(thermal_boxes):
        others = thermal_boxes[:i] + thermal_boxes[i + 1:]
        results.append(measure_duck(frame, box, others, settings))
    return results
