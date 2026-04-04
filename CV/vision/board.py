"""
Detect chess board outline in an image and warp to a square (top-down) view.

Uses the largest 4-vertex contour after edge detection — works best with clear
board boundaries vs background; lighting and clutter affect reliability.
"""

from __future__ import annotations

import os
from typing import Any

import cv2
import numpy as np

# --- Single source of truth for board outline detection (Canny / contour pipeline) ---
_DEFAULT_MAX_DETECTION_DIM = 1920
_DEFAULT_CANNY_LOW = 50
_DEFAULT_CANNY_HIGH = 190
_DEFAULT_APPROX_EPS_RATIO = 0.02
_DEFAULT_MIN_AREA_RATIO = 0.08
_DEFAULT_GAUSSIAN_BLUR_KSIZE = 5
_DEFAULT_DILATE_KERNEL_SIZE = 2
_DEFAULT_DILATE_ITERATIONS = 1


def _order_corners_tl_tr_br_bl(pts: np.ndarray) -> np.ndarray:
    """Order four points as top-left, top-right, bottom-right, bottom-left."""
    pts = pts.reshape(4, 2).astype(np.float32)
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1).flatten()
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect

def find_board_corners(bgr: np.ndarray, **kwargs: Any) -> np.ndarray | None:
    if bgr is None or bgr.size == 0:
        return None
    h0, w0 = bgr.shape[:2]
    scale = min(1.0, _DEFAULT_MAX_DETECTION_DIM / max(h0, w0))
    if scale < 1.0:
        small = cv2.resize(bgr, (int(w0 * scale), int(h0 * scale)), interpolation=cv2.INTER_AREA)
    else:
        small = bgr.copy()
    dh, dw = small.shape[:2]
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(
        gray, 
        (_DEFAULT_GAUSSIAN_BLUR_KSIZE, _DEFAULT_GAUSSIAN_BLUR_KSIZE), 
        0
    )
    # clahe = cv2.createCLAHE(2.5, (8,8)).apply(blur)
    edges = cv2.Canny(blur, _DEFAULT_CANNY_LOW, _DEFAULT_CANNY_HIGH) 
    if _DEFAULT_DILATE_ITERATIONS <= 0:
        edges_d = edges.copy()
    else:
        edges_d = cv2.dilate(
            edges, 
            np.ones((_DEFAULT_DILATE_KERNEL_SIZE, _DEFAULT_DILATE_KERNEL_SIZE), np.uint8), 
            iterations=_DEFAULT_DILATE_ITERATIONS
        )
    contours, _ = cv2.findContours(edges_d, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    img_area = float(dh * dw)
    min_area = _DEFAULT_MIN_AREA_RATIO * img_area
    overlay = small.copy()
    cv2.drawContours(overlay, contours, -1, (0, 255, 0), 1)
    best: tuple[float, np.ndarray, np.ndarray] | None = None
    quad_areas: list[float] = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area:
            continue
        peri = cv2.arcLength(cnt, True)
        if peri < 1e-6:
            continue
        approx = cv2.approxPolyDP(cnt, _DEFAULT_APPROX_EPS_RATIO * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            quad_areas.append(float(area))
            if area > (best[0] if best else 0):
                best = (area, approx.reshape(4, 2).astype(np.float32), approx)

    if best is not None:
        cv2.polylines(overlay, [best[2]], True, (0, 0, 255), 2)
    debug_dir = os.environ.get("VISION_BOARD_DEBUG_DIR", "").strip()
    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)
        cv2.imwrite(os.path.join(debug_dir, f"overlay.png"), overlay)

    if best is None:
        return None
    
    corners = _order_corners_tl_tr_br_bl(best[1])
    if scale < 1.0:
        corners = corners.copy()
        corners[:, 0] /= scale
        corners[:, 1] /= scale

    return corners


def warp_board_square(
    bgr: np.ndarray,
    corners: np.ndarray,
    out_size: int = 800,
) -> np.ndarray:
    """
    Perspective-warp ``bgr`` so the board quad becomes a square ``out_size`` x ``out_size``.
    """
    s = float(out_size)
    dst = np.array([[0, 0], [s, 0], [s, s], [0, s]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(corners, dst)
    return cv2.warpPerspective(bgr, m, (out_size, out_size))


def extract_board(
    bgr: np.ndarray,
    *,
    out_size: int = 800,
    **find_kw: Any,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    """
    Find board corners and return ``(warped_bgr, corners)`` or ``(None, None)``.
    ``find_kw`` is passed to :func:`find_board_corners`.
    """
    corners = find_board_corners(bgr, **find_kw)
    if corners is None:
        return None, None
    warped = warp_board_square(bgr, corners, out_size=out_size)
    return warped, corners
