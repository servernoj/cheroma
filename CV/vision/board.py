"""
Detect chess board outline in an image and warp to a square (top-down) view.

Uses the largest 4-vertex contour after edge detection — works best with clear
board boundaries vs background; lighting and clutter affect reliability.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

# --- Single source of truth for board outline detection (Canny / contour pipeline) ---
_DEFAULT_MAX_DETECTION_DIM = 960
_DEFAULT_CANNY_LOW = 90
_DEFAULT_CANNY_HIGH = 190
_DEFAULT_APPROX_EPS_RATIO = 0.02
_DEFAULT_MIN_AREA_RATIO = 0.08
_DEFAULT_GAUSSIAN_BLUR_KSIZE = 5
_DEFAULT_DILATE_KERNEL_SIZE = 3
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


def analyze_board_detection(
    bgr: np.ndarray,
    *,
    max_detection_dim: int = _DEFAULT_MAX_DETECTION_DIM,
    canny_low: int = _DEFAULT_CANNY_LOW,
    canny_high: int = _DEFAULT_CANNY_HIGH,
    approx_eps_ratio: float = _DEFAULT_APPROX_EPS_RATIO,
    min_area_ratio: float = _DEFAULT_MIN_AREA_RATIO,
    gaussian_blur_ksize: int = _DEFAULT_GAUSSIAN_BLUR_KSIZE,
    dilate_kernel_size: int = _DEFAULT_DILATE_KERNEL_SIZE,
    dilate_iterations: int = _DEFAULT_DILATE_ITERATIONS,
) -> dict[str, Any]:
    """
    Run the same pipeline as :func:`find_board_corners` and return corners plus debug data.

    Use this headless: inspect intermediate arrays (``small_bgr``, ``gray``, …) or
    :func:`save_board_debug_images`, or :func:`debug_payload_for_json` for JSON stats.
    """
    empty: dict[str, Any] = {
        "ok": False,
        "corners": None,
        "scale": 1.0,
        "image_size": [0, 0],
        "detection_size": [0, 0],
        "contour_count": 0,
        "quad_candidate_count": 0,
        "quad_candidate_areas": [],
        "best_quad_area": None,
        "reason": "empty_input",
        "small_bgr": None,
        "gray": None,
        "gray_blur": None,
        "edges_canny": None,
        "edges_dilated": None,
        "overlay": None,
    }
    if bgr is None or bgr.size == 0:
        return empty

    h0, w0 = bgr.shape[:2]
    empty["image_size"] = [w0, h0]
    scale = min(1.0, max_detection_dim / max(h0, w0))
    if scale < 1.0:
        small = cv2.resize(bgr, (int(w0 * scale), int(h0 * scale)), interpolation=cv2.INTER_AREA)
    else:
        small = bgr.copy()

    dh, dw = small.shape[:2]
    empty["detection_size"] = [dw, dh]
    empty["scale"] = scale

    gk = max(1, int(gaussian_blur_ksize)) | 1  # odd kernel size
    dk = max(1, int(dilate_kernel_size))
    dit = max(0, int(dilate_iterations))

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray_blur = cv2.GaussianBlur(gray, (gk, gk), 0)
    edges = cv2.Canny(gray_blur, canny_low, canny_high)
    if dit <= 0:
        edges_d = edges.copy()
    else:
        edges_d = cv2.dilate(edges, np.ones((dk, dk), np.uint8), iterations=dit)

    contours, _ = cv2.findContours(edges_d, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    img_area = float(dh * dw)
    min_area = min_area_ratio * img_area

    overlay = small.copy()
    cv2.drawContours(overlay, contours, -1, (0, 255, 0), 1)

    best: tuple[float, np.ndarray] | None = None
    quad_areas: list[float] = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area:
            continue
        peri = cv2.arcLength(cnt, True)
        if peri < 1e-6:
            continue
        approx = cv2.approxPolyDP(cnt, approx_eps_ratio * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            quad_areas.append(float(area))
            if area > (best[0] if best else 0):
                best = (area, approx.reshape(4, 2).astype(np.float32))
                cv2.polylines(overlay, [approx], True, (0, 0, 255), 2)

    out: dict[str, Any] = {
        "ok": best is not None,
        "corners": None,
        "scale": scale,
        "image_size": [w0, h0],
        "detection_size": [dw, dh],
        "contour_count": len(contours),
        "quad_candidate_count": len(quad_areas),
        "quad_candidate_areas": sorted(quad_areas, reverse=True)[:20],
        "best_quad_area": float(best[0]) if best else None,
        "reason": "ok" if best else ("no_quadrilateral" if contours else "no_contours"),
        "small_bgr": small,
        "gray": gray,
        "gray_blur": gray_blur,
        "edges_canny": edges,
        "edges_dilated": edges_d,
        "overlay": overlay,
    }

    if best is None:
        return out

    corners = _order_corners_tl_tr_br_bl(best[1])
    if scale < 1.0:
        corners = corners.copy()
        corners[:, 0] /= scale
        corners[:, 1] /= scale
    out["corners"] = corners
    out["ok"] = True
    out["reason"] = "ok"
    return out


def find_board_corners(bgr: np.ndarray, **kwargs: Any) -> np.ndarray | None:
    """
    Find the four corners of the dominant quadrilateral (expected board outline).

    Keyword args override :func:`analyze_board_detection` defaults (same single source).

    Returns ``(4, 2)`` float32 points in **original image coordinates**, or ``None``.
    """
    r = analyze_board_detection(bgr, **kwargs)
    c = r.get("corners")
    return np.asarray(c, dtype=np.float32) if c is not None else None


def debug_payload_for_json(analysis: dict[str, Any]) -> dict[str, Any]:
    """Build a JSON-serializable dict of detection stats (no images, no raw numpy)."""
    return {
        "ok": analysis.get("ok"),
        "reason": analysis.get("reason"),
        "image_size": analysis.get("image_size"),
        "detection_size": analysis.get("detection_size"),
        "scale": analysis.get("scale"),
        "contour_count": analysis.get("contour_count"),
        "quad_candidate_count": analysis.get("quad_candidate_count"),
        "quad_candidate_areas": analysis.get("quad_candidate_areas"),
        "best_quad_area": analysis.get("best_quad_area"),
    }


def save_board_debug_images(
    analysis: dict[str, Any],
    directory: str,
    *,
    prefix: str = "board",
) -> list[str]:
    """
    Write intermediate pipeline images from :func:`analyze_board_detection` to PNG files
    (detection resolution: resize → gray → blur → Canny → dilate → overlay).
    Returns list of paths written, in pipeline order.
    """
    import os

    steps: list[tuple[str, str]] = [
        ("small_bgr", "01_small_bgr.png"),
        ("gray", "02_gray.png"),
        ("gray_blur", "03_gray_blur.png"),
        ("edges_canny", "04_canny.png"),
        ("edges_dilated", "05_canny_dilated.png"),
        ("overlay", "06_overlay.png"),
    ]
    paths: list[str] = []
    os.makedirs(directory, exist_ok=True)
    for key, fname in steps:
        img = analysis.get(key)
        if img is None:
            continue
        p = os.path.join(directory, f"{prefix}_{fname}")
        cv2.imwrite(p, img)
        paths.append(p)
    return paths


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
