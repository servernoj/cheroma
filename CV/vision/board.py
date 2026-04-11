"""
Detect chess board outline in an image and warp to a square (top-down) view.

Uses the largest 4-vertex contour after edge detection — works best with clear
board boundaries vs background; lighting and clutter affect reliability.
"""

from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from scipy.optimize import differential_evolution

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
    corners: np.ndarray | None = None,
    **find_kw: Any,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    """
    Return ``(warped_bgr, corners)`` or ``(None, None)``.

    If ``corners`` is a 4×2 float32 array (TL, TR, BR, BL in image space), skip
    detection and warp using those. Otherwise ``find_board_corners`` is used;
    ``find_kw`` is passed through (currently unused).
    """
    if corners is not None:
        c = np.asarray(corners, dtype=np.float32).reshape(4, 2)
        warped = warp_board_square(bgr, c, out_size=out_size)
        return warped, c

    found = find_board_corners(bgr, **find_kw)
    if found is None:
        return None, None
    warped = warp_board_square(bgr, found, out_size=out_size)
    return warped, found


def _center_crop_half(bgr: np.ndarray) -> tuple[np.ndarray, tuple[int, int]]:
    """Center crop to 50% of width and height (linear size); returns crop and (x0, y0) offset."""
    h, w = bgr.shape[:2]
    ch = max(1, int(round(h * 0.5)))
    cw = max(1, int(round(w * 0.5)))
    y0 = (h - ch) // 2
    x0 = (w - cw) // 2
    return bgr[y0 : y0 + ch, x0 : x0 + cw].copy(), (x0, y0)


def _detect_square_like_cell_sizes(crop_bgr: np.ndarray) -> tuple[list[float], int]:
    """
    Find roughly square 4-vertex contours in ``crop_bgr``; return side-length estimates
    (from ``sqrt(area)``) sorted by quality, and raw contour count considered.
    """
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 35, 110)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    ch, cw = crop_bgr.shape[:2]
    img_area = float(ch * cw)
    min_area = max(16.0, 0.0008 * img_area)
    max_area = 0.22 * img_area
    scored: list[tuple[float, float, float]] = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue
        peri = cv2.arcLength(cnt, True)
        if peri < 1e-6:
            continue
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        rect = cv2.minAreaRect(cnt)
        rw, rh = rect[1]
        if rw < 1.0 or rh < 1.0:
            continue
        ar = max(rw, rh) / min(rw, rh)
        if ar > 1.38:
            continue
        side = float(np.sqrt(max(area, 1.0)))
        scored.append((-area, ar, side))

    scored.sort(key=lambda t: (t[0], t[1]))
    sides = [t[2] for t in scored]
    return sides, len(contours)


def _median_cell_from_square_candidates(sides: list[float], s: float) -> float:
    """Pick a cell size from top square-like candidates; fall back if empty."""
    if not sides:
        return float(s) / 8.0 * 0.92
    k = min(8, len(sides))
    top = sides[:k]
    cell = float(np.median(np.array(top, dtype=np.float64)))
    lo, hi = float(s) * (1.0 / 14.0), float(s) * (1.0 / 5.5)
    return float(np.clip(cell, lo, hi))


def _rotated_cell_corners(
    ox: float,
    oy: float,
    cell: float,
    ii: int,
    jj: int,
    theta_deg: float,
    dx: float,
    dy: float,
    pivot: tuple[float, float],
) -> np.ndarray:
    """Four corners (TL, TR, BR, BL) of cell (ii, jj) after translation and rotation."""
    x0 = ox + dx + ii * cell
    y0 = oy + dy + jj * cell
    corners = np.array(
        [
            [x0, y0],
            [x0 + cell, y0],
            [x0 + cell, y0 + cell],
            [x0, y0 + cell],
        ],
        dtype=np.float64,
    )
    theta_rad = np.deg2rad(theta_deg)
    c = np.cos(theta_rad)
    s = np.sin(theta_rad)
    px, py = pivot
    out = np.empty_like(corners)
    for k in range(4):
        x, y = corners[k, 0], corners[k, 1]
        rx, ry = x - px, y - py
        out[k, 0] = c * rx - s * ry + px
        out[k, 1] = s * rx + c * ry + py
    return out


def _pearson_rotated_cell_means_vs_checker(
    gray: np.ndarray,
    ox: float,
    oy: float,
    cell: float,
    theta_deg: float,
    dx: float,
    dy: float,
    pivot: tuple[float, float],
) -> float | None:
    """Pearson *r* of 64 rotated cell mean luminances vs ±1 checker, or ``None`` if invalid."""
    h, w = gray.shape[:2]
    if h < 8 or w < 8 or cell <= 0:
        return None
    means = np.empty((8, 8), dtype=np.float64)
    mask = np.zeros((h, w), dtype=np.uint8)
    for jj in range(8):
        for ii in range(8):
            mask.fill(0)
            corners = _rotated_cell_corners(ox, oy, cell, ii, jj, theta_deg, dx, dy, pivot)
            poly = np.round(corners).astype(np.int32).reshape(-1, 1, 2)
            cv2.fillConvexPoly(mask, poly, 255)
            if cv2.countNonZero(mask) < 1:
                return None
            means[jj, ii] = float(cv2.mean(gray, mask=mask)[0])
    ideal = np.where((np.arange(8)[:, None] + np.arange(8)) % 2 == 0, 1.0, -1.0)
    a = means.ravel() - means.mean()
    b = ideal.ravel()
    denom = np.sqrt(float(np.dot(a, a) * np.dot(b, b)))
    if denom < 1e-12:
        return None
    return float(np.dot(a, b) / denom)


def _cell_size_candidates_for_fit(sides: list[float], s: float) -> list[float]:
    """
    Nominal ``S/8`` (ideal warp), contour-based estimate, and a tight band around ``S/8``.
    Contour-only sizing is often wrong even when the warp looks good; always try ``S/8``.
    """
    c_nom = s / 8.0
    c_cont = _median_cell_from_square_candidates(sides, s)
    raw = [
        c_nom,
        c_cont,
        c_nom * 0.99,
        c_nom * 1.01,
        c_nom * 0.985,
        c_nom * 1.015,
    ]
    lo, hi = float(s) * (1.0 / 14.0), float(s) * (1.0 / 5.5)
    out: list[float] = []
    for x in raw:
        x = float(np.clip(x, lo, hi))
        bw = 8.0 * x
        if 24.0 <= bw <= s:
            out.append(x)
    seen: set[float] = set()
    uniq: list[float] = []
    for x in out:
        k = round(x, 5)
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    return uniq


def _stress_test_de_init(
    bounds: list[tuple[float, float]],
    pop_rows: int,
    rng: np.random.Generator,
    *,
    corner_frac: float = 0.92,
) -> np.ndarray:
    """
    Initial population biased toward **box corners** (far from ``(0,0,0)``) so DE
    must converge from a bad region. ``rows`` must be ≥ 5 (SciPy requirement).
    """
    n = len(bounds)
    lows = np.array([b[0] for b in bounds], dtype=np.float64)
    highs = np.array([b[1] for b in bounds], dtype=np.float64)
    centers = 0.5 * (lows + highs)
    span = highs - lows
    half = 0.5 * np.where(span > 1e-12, span, 0.0)
    corners = np.array(
        [
            [1, 1, 1],
            [1, -1, 1],
            [-1, 1, -1],
            [-1, -1, -1],
            [1, -1, -1],
            [-1, 1, 1],
        ],
        dtype=np.float64,
    )
    init = np.empty((pop_rows, n), dtype=np.float64)
    for i in range(pop_rows):
        c = corners[i % len(corners)]
        # Map toward ±corner_frac of each half-span from center
        base = centers + corner_frac * c[:n] * half
        noise = rng.normal(0.0, 0.035, size=n) * np.maximum(half, 1e-12)
        row = np.clip(base + noise, lows, highs)
        init[i] = row
    return init


_DEBUG_FIT_MAX_FRAMES = 180
_DEBUG_FIT_FPS = 10.0


def _subsample_fit_frames(frames: list[np.ndarray], max_n: int = _DEBUG_FIT_MAX_FRAMES) -> list[np.ndarray]:
    if len(frames) <= max_n:
        return frames
    idx = np.linspace(0, len(frames) - 1, max_n).round().astype(int)
    # Ensure strictly increasing indices for uniqueness
    out: list[np.ndarray] = []
    prev = -1
    for i in idx:
        if int(i) != prev:
            out.append(frames[int(i)])
            prev = int(i)
    return out if out else frames[:max_n]


def _cell_px_tag_for_filename(cell: float) -> str:
    """Compact cell size in px for filenames (e.g. ``100p125`` for 100.125)."""
    t = f"{float(cell):.6f}".rstrip("0").rstrip(".")
    return t.replace(".", "p")


def _write_fit_debug_gif(
    debug_dir: str,
    stem: str,
    frames_bgr: list[np.ndarray],
    *,
    fps: float = _DEBUG_FIT_FPS,
) -> str | None:
    """Write one animated GIF; returns path or ``None`` on failure."""
    if not frames_bgr:
        return None
    os.makedirs(debug_dir, exist_ok=True)
    try:
        import imageio.v2 as imageio

        rgb = [cv2.cvtColor(f, cv2.COLOR_BGR2RGB) for f in frames_bgr]
        gif_path = os.path.join(debug_dir, f"{stem}.gif")
        imageio.mimsave(gif_path, rgb, duration=1.0 / max(0.5, float(fps)), loop=0)
        return gif_path
    except Exception:
        return None


def _pearson_cell_means_vs_checker(patch: np.ndarray, cell_px: float) -> float:
    """
    Pearson correlation between the **64 cell mean luminances** and an ideal ±1
    checkerboard.

    Per-pixel NCC across the whole patch tends to favor the **largest** (full-frame)
    grid: millions of rim pixels are forced into edge “squares” and still contribute
    to the statistic. Here each square is **one** sample, so a rim that belongs
    outside the true 8×8 **hurts** edge cells’ means and lowers the score; a
    slightly **smaller** centered grid can win when it aligns with the real board.
    """
    h, w = patch.shape[:2]
    if h < 8 or w < 8 or cell_px <= 0:
        return -1.0
    means = np.empty((8, 8), dtype=np.float64)
    for jj in range(8):
        for ii in range(8):
            x0f = ii * cell_px
            y0f = jj * cell_px
            x1f = (ii + 1) * cell_px
            y1f = (jj + 1) * cell_px
            x0 = int(np.floor(x0f))
            y0 = int(np.floor(y0f))
            x1 = int(np.ceil(x1f))
            y1 = int(np.ceil(y1f))
            x0, y0 = max(0, x0), max(0, y0)
            x1, y1 = min(w, x1), min(h, y1)
            if x1 <= x0 or y1 <= y0:
                return -1.0
            means[jj, ii] = float(patch[y0:y1, x0:x1].mean())
    ideal = np.where((np.arange(8)[:, None] + np.arange(8)) % 2 == 0, 1.0, -1.0)
    a = means.ravel() - means.mean()
    b = ideal.ravel()
    denom = np.sqrt(float(np.dot(a, a) * np.dot(b, b)))
    if denom < 1e-12:
        return -1.0
    return float(np.dot(a, b) / denom)


def fit_ideal_checkerboard_to_warp(
    warped_bgr: np.ndarray,
    *,
    max_theta_deg: float = 10.0,
    max_trans_frac: float = 0.25,
    refine_maxiter: int = 30,
    refine_popsize: int = 8,
    refine_seed: int = 42,
    stress_test: bool = False,
    stress_corner_frac: float = 0.92,
) -> dict[str, Any] | None:
    """
    Fit an ideal 8×8 grid to a square warped board image.

    1. **Center-crop** the warp to **50%** linear size (rim excluded from analysis).
    2. Detect **roughly square** 4-vertex contours; take the **median** side length
       among the best candidates as **cell** size (with sane clamping; fallback if
       none found).
    3. Try several **cell** sizes: nominal ``S/8``, contour median, and a narrow band
       around ``S/8`` (contours alone are unreliable when the warp is already good).
    4. **Refine** ``(theta, dx, dy)`` by **bounded optimization** (differential
       evolution): maximize **|Pearson|** of 64 cell-mean luminances vs ±1 checker.
       Bounds: ``theta`` in ``±max_theta_deg``, ``dx``/``dy`` in
       ``±max_trans_frac * cell``. Rotation about **translated board center**
       ``(S/2+dx, S/2+dy)``.

    If ``stress_test`` is True, the DE **initial population** is biased toward **box
    corners** (far from the usual optimum near 0) so you can verify convergence;
    use a generous ``refine_maxiter`` (e.g. 50–80) if the run plateaus.

    If ``VISION_BOARD_DEBUG_DIR`` is set, writes one **GIF** per cell-size candidate
    DE run (see filename: ``candidate`` index + ``cellpx``), plus
    ``overlay_fit_<ts>_API_WINNER.gif`` copied from the run that matches the API
    result (highest |Pearson|). Paths in ``debug_fit_animations``.

    Returns ``theta_deg``, ``dx``, ``dy`` for :func:`render_rotated_checkerboard_overlay`.
    """
    if warped_bgr is None or warped_bgr.size == 0:
        return None
    h, w = warped_bgr.shape[:2]
    if h != w or h < 64:
        return None
    s = float(h)
    gray_u8 = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2GRAY)
    gray_u8 = cv2.GaussianBlur(gray_u8, (3, 3), 0)

    crop, _ = _center_crop_half(warped_bgr)
    sides, n_contours_seen = _detect_square_like_cell_sizes(crop)
    cell_sizes = _cell_size_candidates_for_fit(sides, s)
    if not cell_sizes:
        return None

    mtheta = max(0.0, float(max_theta_deg))
    mtf = max(0.0, min(0.5, float(max_trans_frac)))
    maxiter = max(5, min(120, int(refine_maxiter)))
    popsize = max(4, min(25, int(refine_popsize)))
    seed = int(refine_seed) & 0xFFFFFFFF
    rng = np.random.default_rng(seed)
    st = bool(stress_test)
    scf = float(np.clip(stress_corner_frac, 0.5, 0.999))
    if st:
        # Corner-seeded population needs more generations to move toward the optimum.
        maxiter = min(120, max(maxiter, 55))

    best_abs = -1.0
    best_r = -1.0
    best_theta = 0.0
    best_dx = 0.0
    best_dy = 0.0
    best_cell = cell_sizes[0]
    best_ox = 0.0
    best_oy = 0.0
    best_ci = 0
    evaluated = 0

    debug_dir = os.environ.get("VISION_BOARD_DEBUG_DIR", "").strip()
    run_ts = int(time.time() * 1000)
    debug_animation_paths: list[str] = []
    debug_gif_by_candidate: dict[int, str] = {}

    def run_de_for_cell(
        cell: float,
        ox0: float,
        oy0: float,
        cell_idx: int,
    ) -> tuple[float, float, float, float | None, int]:
        tr = mtf * cell
        bounds = [(-mtheta, mtheta), (-tr, tr), (-tr, tr)]

        n_ev = [0]

        def objective(x: np.ndarray) -> float:
            n_ev[0] += 1
            theta_deg, dx, dy = float(x[0]), float(x[1]), float(x[2])
            pivot = (s / 2.0 + dx, s / 2.0 + dy)
            r = _pearson_rotated_cell_means_vs_checker(
                gray_u8, ox0, oy0, cell, theta_deg, dx, dy, pivot
            )
            if r is None:
                return 1e9
            return -abs(r)

        frames: list[np.ndarray] = []
        last_params: list[float] | None = None

        def push_frame(theta_deg: float, dx: float, dy: float) -> None:
            nonlocal last_params
            cur = [theta_deg, dx, dy]
            if last_params is not None and np.allclose(cur, last_params, rtol=0, atol=1e-6):
                return
            last_params = cur
            frames.append(
                render_rotated_checkerboard_overlay(
                    warped_bgr, cell, ox0, oy0, theta_deg, dx, dy
                )
            )

        if debug_dir:
            # Deliberately poor starting pose (near a box corner) for visual contrast.
            b0 = float(np.clip((mtheta if mtheta > 1e-9 else 0.0) * 0.95, -mtheta, mtheta))
            b1 = float(np.clip(tr * 0.95, -tr, tr)) if tr > 1e-9 else 0.0
            b2 = float(np.clip(-tr * 0.95, -tr, tr)) if tr > 1e-9 else 0.0
            push_frame(b0, b1, b2)

        def de_callback(*args: Any, **kwargs: Any) -> bool:
            if not debug_dir:
                return False
            xk = args[0]
            if hasattr(xk, "x"):
                x = np.asarray(xk.x, dtype=np.float64).ravel()
            else:
                x = np.asarray(xk, dtype=np.float64).ravel()
            if x.size >= 3:
                push_frame(float(x[0]), float(x[1]), float(x[2]))
            return False

        n_dim = 3
        pop_rows = max(5, popsize * n_dim)
        de_kw: dict[str, Any] = {
            "seed": seed,
            "maxiter": maxiter,
            "popsize": popsize,
            "polish": True,
            "atol": 1e-3,
            "tol": 1e-3,
        }
        if st:
            de_kw["init"] = _stress_test_de_init(
                bounds, pop_rows, rng, corner_frac=scf
            )
            de_kw.pop("popsize", None)
        if debug_dir:
            de_kw["callback"] = de_callback

        res = differential_evolution(objective, bounds, **de_kw)
        n_calls = int(n_ev[0])
        x = res.x
        theta_deg, dx, dy = float(x[0]), float(x[1]), float(x[2])
        if debug_dir:
            push_frame(theta_deg, dx, dy)
            sub = _subsample_fit_frames(frames)
            ctag = _cell_px_tag_for_filename(cell)
            stem = f"overlay_fit_{run_ts}_candidate{cell_idx:02d}_cellpx{ctag}"
            gif_path = _write_fit_debug_gif(
                debug_dir, stem, sub, fps=_DEBUG_FIT_FPS
            )
            if gif_path:
                debug_animation_paths.append(gif_path)
                debug_gif_by_candidate[cell_idx] = gif_path

        pivot = (s / 2.0 + dx, s / 2.0 + dy)
        r = _pearson_rotated_cell_means_vs_checker(
            gray_u8, ox0, oy0, cell, theta_deg, dx, dy, pivot
        )
        if r is None:
            return 0.0, 0.0, 0.0, None, n_calls
        return theta_deg, dx, dy, r, n_calls

    for ci, cell in enumerate(cell_sizes):
        bw = 8.0 * cell
        ox0 = 0.5 * (s - bw)
        oy0 = 0.5 * (s - bw)
        th, dx, dy, r, n_calls = run_de_for_cell(cell, ox0, oy0, ci)
        evaluated += n_calls
        if r is None:
            continue
        ar = abs(r)
        if ar > best_abs:
            best_abs = ar
            best_r = r
            best_theta = th
            best_dx = dx
            best_dy = dy
            best_cell = cell
            best_ox = ox0
            best_oy = oy0
            best_ci = ci

    if debug_dir and debug_gif_by_candidate:
        win = debug_gif_by_candidate.get(best_ci)
        if win and os.path.isfile(win):
            dst = os.path.join(debug_dir, f"overlay_fit_{run_ts}_API_WINNER.gif")
            try:
                shutil.copy2(win, dst)
                debug_animation_paths.append(dst)
            except OSError:
                pass

    w_side = int(round(8.0 * best_cell))
    w_side = max(8, min(w_side, h, w))

    if best_abs < 0.0:
        return None

    return {
        "cell": best_cell,
        "ox": best_ox,
        "oy": best_oy,
        "theta_deg": best_theta,
        "dx": best_dx,
        "dy": best_dy,
        "ncc": float(best_r),
        "ncc_abs": float(best_abs),
        "board_px": w_side,
        "evaluated_steps": evaluated,
        "refine_method": "differential_evolution",
        "refine_maxiter": maxiter,
        "refine_popsize": popsize,
        "stress_test": st,
        "stress_corner_frac": scf if st else None,
        "debug_fit_animations": debug_animation_paths,
        "cell_candidate_index": best_ci,
        "cell_size_candidates_px": [float(c) for c in cell_sizes],
        "square_candidates": len(sides),
        "contours_seen": n_contours_seen,
        "cell_sizes_tried": len(cell_sizes),
    }


def render_checkerboard_overlay(
    warped_bgr: np.ndarray,
    cell: float,
    ox: float,
    oy: float,
    *,
    alpha: float = 0.5,
    bgr_light: tuple[int, int, int] = (0, 0, 255),
    bgr_dark: tuple[int, int, int] = (0, 255, 0),
) -> np.ndarray:
    """Half-transparent red/green (default) over each ideal square."""
    out = warped_bgr.astype(np.float32)
    h, w = out.shape[:2]
    a = float(np.clip(alpha, 0.0, 1.0))
    cl = np.array(bgr_light, dtype=np.float32)
    cd = np.array(bgr_dark, dtype=np.float32)
    for jj in range(8):
        for ii in range(8):
            x0 = int(round(ox + ii * cell))
            y0 = int(round(oy + jj * cell))
            x1 = int(round(ox + (ii + 1) * cell))
            y1 = int(round(oy + (jj + 1) * cell))
            x0, x1 = max(0, x0), min(w, x1)
            y0, y1 = max(0, y0), min(h, y1)
            if x1 <= x0 or y1 <= y0:
                continue
            color = cl if (ii + jj) % 2 == 0 else cd
            patch = out[y0:y1, x0:x1]
            patch[:] = (1.0 - a) * patch + a * color
    return np.clip(out, 0, 255).astype(np.uint8)


def render_rotated_checkerboard_overlay(
    warped_bgr: np.ndarray,
    cell: float,
    ox: float,
    oy: float,
    theta_deg: float,
    dx: float,
    dy: float,
    *,
    pivot: tuple[float, float] | None = None,
    alpha: float = 0.5,
    bgr_light: tuple[int, int, int] = (0, 0, 255),
    bgr_dark: tuple[int, int, int] = (0, 255, 0),
) -> np.ndarray:
    """Half-transparent checker tint on each cell quad (rotation + translation).

    Default pivot is the **translated board center** ``(S/2+dx, S/2+dy)`` so rotation
    matches :func:`fit_ideal_checkerboard_to_warp`.
    """
    out = warped_bgr.astype(np.float32)
    h, w = out.shape[:2]
    s = float(h)
    if pivot is None:
        pivot = (s / 2.0 + float(dx), s / 2.0 + float(dy))
    a = float(np.clip(alpha, 0.0, 1.0))
    cl = np.array(bgr_light, dtype=np.float32)
    cd = np.array(bgr_dark, dtype=np.float32)
    # uint8 mask + in-cell blend matches :func:`render_checkerboard_overlay` and avoids
    # unreliable ``fillConvexPoly`` on float buffers and full-frame compositing bugs.
    mask = np.zeros((h, w), dtype=np.uint8)
    for jj in range(8):
        for ii in range(8):
            mask.fill(0)
            corners = _rotated_cell_corners(ox, oy, cell, ii, jj, theta_deg, dx, dy, pivot)
            poly = np.round(corners).astype(np.int32).reshape(-1, 1, 2)
            cv2.fillConvexPoly(mask, poly, 255)
            sel = mask > 0
            if not np.any(sel):
                continue
            col = cl if (ii + jj) % 2 == 0 else cd
            out[sel] = (1.0 - a) * out[sel] + a * col
    return np.clip(out, 0, 255).astype(np.uint8)


# --- Persisted board calibration (single global quad, full-frame coordinates) ---
# File lives next to the vision package: ``CV/board_calibration.json`` unless
# ``VISION_BOARD_CALIBRATION_FILE`` is set.


def calibration_file_path() -> Path:
    raw = os.environ.get("VISION_BOARD_CALIBRATION_FILE", "").strip()
    return Path(raw) if raw else Path(__file__).resolve().parent.parent / "board_calibration.json"


def _load_calibration_document() -> dict[str, Any] | None:
    path = calibration_file_path()
    if not path.is_file():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, OSError):
        return None


def _write_calibration_document(data: dict[str, Any]) -> None:
    path = calibration_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    tmp.replace(path)


def _calibration_record_from_doc(doc: dict[str, Any]) -> dict[str, Any] | None:
    """Parse ``frame_width``, ``frame_height``, ``corners``; same shape as ``set_stored_calibration`` returns."""
    try:
        fw = int(doc["frame_width"])
        fh = int(doc["frame_height"])
        corners = doc["corners"]
    except (KeyError, TypeError, ValueError):
        return None
    if not isinstance(corners, list) or len(corners) != 4:
        return None
    pts: list[list[float]] = []
    for p in corners:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            return None
        pts.append([float(p[0]), float(p[1])])
    return {"frame_width": fw, "frame_height": fh, "corners": pts}


def get_stored_calibration_record() -> dict[str, Any] | None:
    """On-disk calibration as ``frame_width`` / ``frame_height`` / ``corners``, or ``None`` if missing/invalid."""
    doc = _load_calibration_document()
    if doc is None:
        return None
    return _calibration_record_from_doc(doc)


def get_stored_calibration(
    frame_width: int, frame_height: int
) -> tuple[np.ndarray | None, str]:
    """
    Load the single stored quad if present and ``frame_width`` / ``frame_height``
    match. Returns ``(corners, status)`` with status ``ok``, ``none``, ``invalid``,
    or ``size_mismatch``.
    """
    doc = _load_calibration_document()
    if doc is None:
        return None, "none"
    record = _calibration_record_from_doc(doc)
    if record is None:
        return None, "invalid"
    if record["frame_width"] != int(frame_width) or record["frame_height"] != int(frame_height):
        return None, "size_mismatch"
    return np.array(record["corners"], dtype=np.float32), "ok"


def set_stored_calibration(
    corners: np.ndarray, frame_width: int, frame_height: int
) -> dict[str, Any]:
    """Replace on-disk calibration with one 4×2 quad (TL, TR, BR, BL)."""
    c = corners.reshape(4, 2).astype(float).tolist()
    fw, fh = int(frame_width), int(frame_height)
    doc: dict[str, Any] = {
        "frame_width": fw,
        "frame_height": fh,
        "corners": c,
    }
    _write_calibration_document(doc)
    return {"frame_width": fw, "frame_height": fh, "corners": c}


def clear_stored_calibration() -> bool:
    """Remove the calibration file. Returns whether a file was deleted."""
    path = calibration_file_path()
    if not path.is_file():
        return False
    path.unlink()
    return True


