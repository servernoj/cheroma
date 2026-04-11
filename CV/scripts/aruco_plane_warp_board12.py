#!/usr/bin/env python3
"""
Warp the full image from **three** ArUco markers using **12** corner correspondences
(four per marker) to a rectified board frame, then draw a small **red filled circle**
(2 px diameter by default) at **each** detected marker corner in warped space (12 dots).

**Board units:** ``--rect-dims WxH`` and ``--marker-size S`` use the **same abstract
length unit** (mm, inches, etc.); only **ratios** matter for the homography and for
matching aspect to ``--quad-dims``. ``--quad-dims`` maps the rectangle to pixels.

**Layout model:** Rectangle origin at **top-left**, +x toward **top-right**, +y toward
**bottom-left**. One marker sits on each of **three** rectangle corners; the **fourth**
corner has no marker (see ``--missing-corner``; use ``auto`` if you are unsure which
vertex is empty—wrong choice yields a poor fit to all 12 corners). Each marker's OpenCV corner **0**
(TL in marker space, first in clockwise order) lies on that rectangle vertex; the
square extends **+x and +y** in board coordinates by ``--marker-size`` (marker edges
parallel to the rectangle).

**No marker IDs required:** ``detectMarkers`` returns markers in arbitrary order. This
script tries all **3! = 6** assignments of the three detections to the three occupied
corners and picks the one whose **least-squares homography on all 12 corners** has the
lowest mean reprojection error (tie-break: more corners under ``--homography-ransac-px``,
then lower max error). With ``--try-corner-cycles``, each marker also tries **4** cyclic
shifts of OpenCV's corner order (**6×4³** candidates per missing-corner hypothesis).
IDs may repeat; they are only used for stable **sorting** of detections so runs are
reproducible. A TL-only geometric sort under perspective does **not** uniquely label
board corners—hence the small permutation search.

**Placement hint:** Aim each marker's TL toward the board interior so OpenCV corner
order stays consistent with the +x/+y board model.

Output: BGRA PNG by default, tight bbox, transparent outside the source.

Before detection, grayscale is optionally run through **CLAHE** (contrast-limited
adaptive histogram equalization) to improve low-contrast photos; the color image
used for warping is unchanged. Default clip is 2; use ``--detection-clahe-clip 0`` to
disable. ``aruco_plane_warp.py`` uses the same flag with default **0** for backward
compatibility—set both to the same value when comparing scripts.

The warp uses that **same** all-12 LS ``H`` (8 DOF, 12×2 constraints). An optional
**second** LS pass runs when it still lowers mean error numerically; use
``--no-ls-refit-homography`` to disable. ``--homography-ransac-px`` is the threshold for
reporting how many of the 12 corners fall under τ px and for tie-breaking candidates.

**vs four TL markers:** ``aruco_plane_warp.py`` maps **only** each marker's TL to the sheet
quad—four **sheet** anchors and no interior corners. Equal-weight 12-corner LS can trade
slight interior fit for **shear** that hurts lines parallel to the paper edges in warp
space. Use ``--sheet-vertex-weight W`` (``W>1``) to upweight the three detected **sheet
vertex** corners (same role as three of the four TL anchors) so the rectified frame stays
closer to the paper; try ``W≈10``–``30`` if global verticals/horizontals matter more than
marker-square residuals.

**Why a 4-marker photo can “detect better” than a 3-marker setup:** the pipelines
are the same OpenCV detector (and optional CLAHE). A reference shot with **four**
markers is usually a **different** capture than one where a corner marker was
removed: the remaining markers can sit at **different** pixel scales, angles, or
lighting. One undetected marker in a 3-marker run is often simply the **hardest**
quad in that frame (smallest on the sensor, glare, motion blur), not proof that
the 4-marker script is stronger.

The script **exits with an error** unless **exactly three** markers are detected
(fewer than three, or more than three, both fail). There is **no** extra filtering
after ``detectMarkers``; missed markers are down to OpenCV defaults, contrast, blur,
wrong dictionary, etc.
"""

from __future__ import annotations

import argparse
import itertools
import sys
from pathlib import Path

import cv2
import numpy as np


def _get_aruco_dictionary(name: str):
    key = name.strip().upper().replace("-", "_")
    if not hasattr(cv2.aruco, key):
        opts = [x for x in dir(cv2.aruco) if x.startswith("DICT_")]
        print(
            f"error: unknown ArUco dictionary {name!r}. Try e.g. DICT_4X4_50. "
            f"Examples: {', '.join(sorted(opts)[:12])}…",
            file=sys.stderr,
        )
        sys.exit(2)
    return cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, key))


def _warn_if_apriltag_refinement_mismatches_dictionary(
    dictionary_name: str, corner_refinement: int
) -> None:
    if corner_refinement != cv2.aruco.CORNER_REFINE_APRILTAG:
        return
    key = dictionary_name.strip().upper().replace("-", "_")
    if "APRILTAG" in key:
        return
    print(
        "warning: --aruco-refine apriltag is aimed at DICT_APRILTAG_* dictionaries; "
        "with classic ArUco (e.g. DICT_4X4_*) detection often drops markers. "
        "Use subpix or contour.",
        file=sys.stderr,
    )


def _parse_aruco_refine(value: str) -> int:
    v = value.strip().lower()
    mapping = {
        "none": "CORNER_REFINE_NONE",
        "subpix": "CORNER_REFINE_SUBPIX",
        "contour": "CORNER_REFINE_CONTOUR",
        "apriltag": "CORNER_REFINE_APRILTAG",
    }
    if v not in mapping:
        raise argparse.ArgumentTypeError(
            f"invalid --aruco-refine {value!r}; use one of: {', '.join(mapping)}"
        )
    name = mapping[v]
    if not hasattr(cv2.aruco, name):
        raise argparse.ArgumentTypeError(
            f"this OpenCV build has no cv2.aruco.{name}; try subpix or none"
        )
    return int(getattr(cv2.aruco, name))


def _aruco_detector_params(corner_refinement_method: int) -> cv2.aruco.DetectorParameters:
    params = cv2.aruco.DetectorParameters()
    params.cornerRefinementMethod = corner_refinement_method
    if corner_refinement_method != cv2.aruco.CORNER_REFINE_NONE:
        params.cornerRefinementMinAccuracy = 0.05
        params.cornerRefinementMaxIterations = 40
    return params


def _gray_for_aruco_detection(gray: np.ndarray, *, clahe_clip_limit: float) -> np.ndarray:
    """
    Improve local contrast for marker binarization. Used only for ``detectMarkers``;
    the BGRA frame warped to disk is not modified.
    """
    if clahe_clip_limit <= 0:
        return gray
    clip = float(clahe_clip_limit)
    if clip > 40.0:
        clip = 40.0
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _parse_quad_dims_arg(value: str) -> tuple[int, int]:
    v = value.strip().lower().replace("*", "x")
    if "x" in v:
        parts = v.split("x", 1)
    elif "," in v:
        parts = v.split(",", 1)
    else:
        raise argparse.ArgumentTypeError(
            "--quad-dims must be WxH, e.g. 850x1100 or 850,1100"
        )
    try:
        w = int(parts[0].strip())
        h = int(parts[1].strip())
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"invalid --quad-dims: {value!r}") from e
    if w < 1 or h < 1:
        raise argparse.ArgumentTypeError("--quad-dims width and height must be >= 1")
    if w > 65535 or h > 65535:
        raise argparse.ArgumentTypeError("--quad-dims values too large")
    return w, h


def _parse_rect_dims(value: str) -> tuple[float, float]:
    v = value.strip().lower().replace("*", "x")
    if "x" in v:
        parts = v.split("x", 1)
    elif "," in v:
        parts = v.split(",", 1)
    else:
        raise argparse.ArgumentTypeError(
            "--rect-dims must be WxH in your chosen length unit, e.g. 17x22"
        )
    try:
        w = float(parts[0].strip())
        h = float(parts[1].strip())
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"invalid --rect-dims: {value!r}") from e
    if w <= 0 or h <= 0:
        raise argparse.ArgumentTypeError("--rect-dims width and height must be > 0")
    return w, h


def _parse_marker_size(value: str) -> float:
    try:
        s = float(value.strip())
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"invalid --marker-size: {value!r}") from e
    if s <= 0:
        raise argparse.ArgumentTypeError("--marker-size must be > 0")
    return s


def _parse_sheet_vertex_weight(value: str) -> float:
    try:
        w = float(value.strip())
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"invalid --sheet-vertex-weight: {value!r}") from e
    if w < 1.0:
        raise argparse.ArgumentTypeError("--sheet-vertex-weight must be >= 1")
    if w > 1e4:
        raise argparse.ArgumentTypeError("--sheet-vertex-weight is unreasonably large")
    return w


def _parse_missing_corner(value: str) -> str:
    v = value.strip().lower()
    if v not in ("tl", "tr", "br", "bl", "auto"):
        raise argparse.ArgumentTypeError(
            "--missing-corner must be tl, tr, br, bl, or auto (try all four)"
        )
    return v


def _three_occupied_corners(missing: str) -> tuple[str, str, str]:
    """Perimeter order starting after ``missing``: the three corners that have markers."""
    order = ("tl", "tr", "br", "bl")
    mi = order.index(missing)
    rotated = [order[(mi + k) % 4] for k in range(4)]
    return tuple(c for c in rotated if c != missing)  # type: ignore[return-value]


def _marker_model_board(
    rect_corner: str, rect_w: float, rect_h: float, marker_size: float
) -> np.ndarray:
    """
    Four board-frame (x,y) points, OpenCV order TL, TR, BR, BL of the marker.
    Marker corner 0 sits on ``rect_corner``; square extends +x, +y by ``marker_size``.
    """
    if rect_corner == "tl":
        ox, oy = 0.0, 0.0
    elif rect_corner == "tr":
        ox, oy = rect_w, 0.0
    elif rect_corner == "br":
        ox, oy = rect_w, rect_h
    elif rect_corner == "bl":
        ox, oy = 0.0, rect_h
    else:
        raise ValueError(rect_corner)
    s = marker_size
    return np.array(
        [
            [ox, oy],
            [ox + s, oy],
            [ox + s, oy + s],
            [ox, oy + s],
        ],
        dtype=np.float64,
    )


def _board_to_quad_pixels(
    pts_board: np.ndarray, rect_w: float, rect_h: float, dst_w: int, dst_h: int
) -> np.ndarray:
    sx = dst_w / rect_w
    sy = dst_h / rect_h
    out = np.empty_like(pts_board, dtype=np.float64)
    out[:, 0] = pts_board[:, 0] * sx
    out[:, 1] = pts_board[:, 1] * sy
    return out


def _build_src_dst_for_permutation(
    dets: list[np.ndarray],
    perm: tuple[int, int, int],
    slots: tuple[str, str, str],
    rw: float,
    rh: float,
    marker_size: float,
    dst_w: int,
    dst_h: int,
    corner_rolls: tuple[int, int, int] = (0, 0, 0),
) -> tuple[np.ndarray, np.ndarray]:
    """
    ``corner_rolls[slot_i]`` in 0..3: cyclic shift of that marker's OpenCV corners
    before matching to model TL,TR,BR,BL (``np.roll(..., -roll, 0)`` so image row 0
    is the detector corner that sits on the board vertex for that slot).
    """
    src_pts: list[list[float]] = []
    dst_pts: list[list[float]] = []
    for slot_i in range(3):
        det = np.asarray(dets[perm[slot_i]], dtype=np.float32).reshape(4, 2)
        r = int(corner_rolls[slot_i]) % 4
        det = np.roll(det, -r, axis=0)
        corner_name = slots[slot_i]
        m_b = _marker_model_board(corner_name, rw, rh, marker_size)
        m_px = _board_to_quad_pixels(m_b, rw, rh, dst_w, dst_h)
        for k in range(4):
            src_pts.append([float(det[k, 0]), float(det[k, 1])])
            dst_pts.append([float(m_px[k, 0]), float(m_px[k, 1])])
    return (
        np.array(src_pts, dtype=np.float32),
        np.array(dst_pts, dtype=np.float32),
    )


def _reprojection_errors_per_point(
    h_mat: np.ndarray, src: np.ndarray, dst: np.ndarray
) -> np.ndarray:
    h64 = np.asarray(h_mat, dtype=np.float64)
    src_h = np.hstack([src.astype(np.float64), np.ones((len(src), 1))])
    proj = (h64 @ src_h.T).T
    wv = proj[:, 2:3]
    wv[wv == 0] = 1e-12
    pred = proj[:, :2] / wv
    return np.linalg.norm(pred - dst.astype(np.float64), axis=1)


def _mean_reproj_error_all(
    h_mat: np.ndarray, src: np.ndarray, dst: np.ndarray
) -> float:
    """Mean L2 reproj over every correspondence."""
    return float(np.mean(_reprojection_errors_per_point(h_mat, src, dst)))


# In ``_build_src_dst_for_permutation`` order: three blocks of four (TL,TR,BR,BL); model
# TL of each marker is the corner on the sheet vertex.
_SHEET_VERTEX_ROW_INDICES = (0, 4, 8)


def _make_sheet_vertex_weights(sheet_vertex_weight: float) -> np.ndarray:
    w = np.ones(12, dtype=np.float64)
    w[list(_SHEET_VERTEX_ROW_INDICES)] = float(sheet_vertex_weight)
    return w


def _weighted_rms_reproj(
    h_mat: np.ndarray,
    src: np.ndarray,
    dst: np.ndarray,
    weights: np.ndarray,
) -> float:
    err = _reprojection_errors_per_point(h_mat, src, dst)
    w = np.asarray(weights, dtype=np.float64).ravel()
    return float(np.sqrt(np.sum(w * err * err) / np.sum(w)))


def _find_homography_weighted_dlt(
    src: np.ndarray,
    dst: np.ndarray,
    weights: np.ndarray,
) -> np.ndarray | None:
    """Weighted DLT (H&Z); all correspondences participate, diagonal weights per point."""
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64).ravel()
    n = len(src)
    if n < 4 or len(dst) != n or len(w) != n:
        return None
    sw = np.sqrt(np.maximum(w, 1e-12))
    rows: list[np.ndarray] = []
    for i in range(n):
        x, y = src[i, 0], src[i, 1]
        X, Y = dst[i, 0], dst[i, 1]
        si = sw[i]
        rows.append(si * np.array([-x, -y, -1, 0, 0, 0, x * X, y * X, X], dtype=np.float64))
        rows.append(si * np.array([0, 0, 0, -x, -y, -1, x * Y, y * Y, Y], dtype=np.float64))
    a = np.stack(rows, axis=0)
    _, _, vt = np.linalg.svd(a)
    h = vt[-1, :]
    if float(np.linalg.norm(h)) < 1e-14:
        return None
    h_mat = h.reshape(3, 3)
    d = float(h_mat[2, 2])
    if abs(d) < 1e-14:
        return None
    h_mat = h_mat / d
    return h_mat


def _inlier_mask_from_errors(err_px: np.ndarray, thresh: float) -> np.ndarray:
    """Shape (N, 1) uint8 like cv2.findHomography RANSAC mask."""
    return (err_px <= float(thresh)).astype(np.uint8).reshape(-1, 1)


def _maybe_ls_refit_homography(
    h_current: np.ndarray,
    src: np.ndarray,
    dst: np.ndarray,
    ransac_px: float,
    *,
    sheet_vertex_weight: float,
) -> tuple[np.ndarray, np.ndarray | None, bool, float, float]:
    """
    Second LS solve on the same 12 points. If the chosen error metric improves vs
    ``h_current``, return the new ``H`` and an inlier mask from ``ransac_px``;
    else return ``h_current`` and ``mask=None`` (caller keeps the prior mask).

    With ``sheet_vertex_weight`` 1, uses OpenCV unweighted LS and compares mean L2
    reproj. Otherwise uses weighted DLT with the same vertex weights and compares
    weighted RMS reproj.
    """
    w_vec = _make_sheet_vertex_weights(sheet_vertex_weight)
    if abs(sheet_vertex_weight - 1.0) < 1e-12:
        mean_r = _mean_reproj_error_all(h_current, src, dst)
        h_ls, _ = cv2.findHomography(src, dst, method=0)
        if h_ls is None:
            return h_current, None, False, mean_r, mean_r
        mean_l = _mean_reproj_error_all(h_ls, src, dst)
        if mean_l >= mean_r - 1e-9:
            return h_current, None, False, mean_r, mean_l
        err = _reprojection_errors_per_point(h_ls, src, dst)
        mask = _inlier_mask_from_errors(err, ransac_px)
        return h_ls, mask, True, mean_r, mean_l

    score_r = _weighted_rms_reproj(h_current, src, dst, w_vec)
    h_ls = _find_homography_weighted_dlt(src, dst, w_vec)
    if h_ls is None:
        return h_current, None, False, score_r, score_r
    score_l = _weighted_rms_reproj(h_ls, src, dst, w_vec)
    if score_l >= score_r - 1e-12:
        return h_current, None, False, score_r, score_l
    err = _reprojection_errors_per_point(h_ls, src, dst)
    mask = _inlier_mask_from_errors(err, ransac_px)
    return h_ls, mask, True, score_r, score_l


def _best_homography_from_permutations(
    dets: list[np.ndarray],
    slots: tuple[str, str, str],
    rw: float,
    rh: float,
    marker_size: float,
    dst_w: int,
    dst_h: int,
    ransac_px: float,
    *,
    try_corner_cycles: bool = False,
    sheet_vertex_weight: float = 1.0,
) -> tuple[np.ndarray, np.ndarray | None, tuple[int, int, int], tuple[int, int, int]] | None:
    """
    Each candidate uses **all 12** point pairs. With ``sheet_vertex_weight`` 1,
    ``findHomography(..., method=0)``; else weighted DLT with higher weight on the
    three sheet-vertex corners (rows 0,4,8). Pick minimum mean L2 reproj when weight
    is 1, else minimum weighted RMS reproj; tie-break by count under ``ransac_px``,
    then max reproj.
    """
    best_h: np.ndarray | None = None
    best_mask: np.ndarray | None = None
    best_perm = (-1, -1, -1)
    best_rolls = (0, 0, 0)
    best_key: tuple[float, int, float] | None = None
    w_vec = _make_sheet_vertex_weights(sheet_vertex_weight)
    use_uniform = abs(sheet_vertex_weight - 1.0) < 1e-12

    if try_corner_cycles:
        roll_space = list(itertools.product(range(4), range(4), range(4)))
    else:
        roll_space = [(0, 0, 0)]

    for perm in itertools.permutations((0, 1, 2)):
        for rolls in roll_space:
            rolls_t = (int(rolls[0]), int(rolls[1]), int(rolls[2]))
            src, dst = _build_src_dst_for_permutation(
                dets,
                perm,
                slots,
                rw,
                rh,
                marker_size,
                dst_w,
                dst_h,
                corner_rolls=rolls_t,
            )
            if use_uniform:
                h_mat, _ = cv2.findHomography(src, dst, method=0)
            else:
                h_mat = _find_homography_weighted_dlt(src, dst, w_vec)
            if h_mat is None:
                continue
            err = _reprojection_errors_per_point(h_mat, src, dst)
            primary = (
                float(np.mean(err))
                if use_uniform
                else _weighted_rms_reproj(h_mat, src, dst, w_vec)
            )
            n_under = int(np.sum(err <= float(ransac_px)))
            max_e = float(np.max(err))
            key = (primary, -n_under, max_e)
            if best_key is None or key < best_key:
                best_h = h_mat
                best_mask = _inlier_mask_from_errors(err, ransac_px)
                best_perm = perm
                best_rolls = rolls_t
                best_key = key

    if best_h is None:
        return None
    return best_h, best_mask, best_perm, best_rolls


def _best_homography_auto_missing_corner(
    dets: list[np.ndarray],
    rw: float,
    rh: float,
    marker_size: float,
    dst_w: int,
    dst_h: int,
    ransac_px: float,
    *,
    try_corner_cycles: bool = False,
    sheet_vertex_weight: float = 1.0,
) -> tuple[
    np.ndarray,
    np.ndarray | None,
    tuple[int, int, int],
    tuple[int, int, int],
    str,
    tuple[str, str, str],
] | None:
    """
    Try each of the four ``missing`` hypotheses. For each, take the best
    permutation/cycle mix under the same all-12 LS criterion as
    ``_best_homography_from_permutations``, then pick the missing corner whose
    winner has the lowest (score, −n_under, max reproj) lexicographically.
    """
    best: tuple[
        tuple[float, int, float],
        str,
        np.ndarray,
        np.ndarray | None,
        tuple[int, int, int],
        tuple[int, int, int],
        tuple[str, str, str],
    ] | None = None
    w_vec = _make_sheet_vertex_weights(sheet_vertex_weight)
    use_uniform = abs(sheet_vertex_weight - 1.0) < 1e-12
    for miss in ("tl", "tr", "br", "bl"):
        slots = _three_occupied_corners(miss)
        got = _best_homography_from_permutations(
            dets,
            slots,
            rw,
            rh,
            marker_size,
            dst_w,
            dst_h,
            ransac_px,
            try_corner_cycles=try_corner_cycles,
            sheet_vertex_weight=sheet_vertex_weight,
        )
        if got is None:
            continue
        h_mat, mask, perm, rolls = got
        src, dst = _build_src_dst_for_permutation(
            dets,
            perm,
            slots,
            rw,
            rh,
            marker_size,
            dst_w,
            dst_h,
            corner_rolls=rolls,
        )
        err = _reprojection_errors_per_point(h_mat, src, dst)
        primary = (
            float(np.mean(err))
            if use_uniform
            else _weighted_rms_reproj(h_mat, src, dst, w_vec)
        )
        n_under = int(np.sum(err <= float(ransac_px)))
        max_e = float(np.max(err))
        key = (primary, -n_under, max_e)
        pack = (key, miss, h_mat, mask, perm, rolls, slots)
        if best is None or key < best[0]:
            best = pack
    if best is None:
        return None
    _key, miss, h_mat, mask, perm, rolls, slots = best
    return h_mat, mask, perm, rolls, miss, slots


_OCV_CORNER_NAMES = ("TL", "TR", "BR", "BL")


def _print_homography_debug(
    dets: list[np.ndarray],
    perm: tuple[int, int, int],
    slots: tuple[str, str, str],
    corner_rolls: tuple[int, int, int],
    h_mat: np.ndarray,
    mask: np.ndarray | None,
    rw: float,
    rh: float,
    marker_size: float,
    dst_w: int,
    dst_h: int,
    ransac_px: float,
    ids_sorted: list[int],
    resolved_missing: str,
    *,
    try_corner_cycles: bool,
    ls_refit_used: bool = False,
    n_under_before_second_ls: int = 0,
    sheet_vertex_weight: float = 1.0,
) -> None:
    """stderr: per-hypothesis LS scores + per-point reproj for winner."""
    print("\n--- homography debug ---", file=sys.stderr)
    fit_desc = (
        "least squares on all 12 corners (uniform weights)"
        if abs(sheet_vertex_weight - 1.0) < 1e-12
        else (
            f"weighted LS on 12 corners (sheet-vertex rows weighted ×{sheet_vertex_weight:g})"
        )
    )
    print(
        f"model: rect-dims {rw}×{rh}, marker-size {marker_size}, quad-dims {dst_w}×{dst_h}; "
        f"each candidate H = {fit_desc}; "
        f"'in' uses reproj ≤ {ransac_px}px vs shown H",
        file=sys.stderr,
    )
    if ls_refit_used:
        print(
            f"Second LS pass improved the fit vs first solve; "
            f"before that pass {n_under_before_second_ls}/12 were ≤ {ransac_px}px.",
            file=sys.stderr,
        )
    per_hyp = "6 permutations × 4³ corner rolls each" if try_corner_cycles else "6 permutations each"
    print(
        f"chosen missing-corner (for table below): {resolved_missing!r}, "
        f"perm (slot order → sorted_det index): {perm}, "
        f"corner_rolls (per slot, cyclic shift of OCV corners): {corner_rolls}",
        file=sys.stderr,
    )
    print(f"sorted detections: [id={ids_sorted[0]}, id={ids_sorted[1]}, id={ids_sorted[2]}]", file=sys.stderr)

    print(f"\nBest fit per missing-corner hypothesis ({per_hyp}):", file=sys.stderr)
    for miss in ("tl", "tr", "br", "bl"):
        sl = _three_occupied_corners(miss)
        got = _best_homography_from_permutations(
            dets,
            sl,
            rw,
            rh,
            marker_size,
            dst_w,
            dst_h,
            ransac_px,
            try_corner_cycles=try_corner_cycles,
            sheet_vertex_weight=sheet_vertex_weight,
        )
        if got is None:
            print(f"  missing={miss!r}: no homography", file=sys.stderr)
            continue
        h_i, _, p_i, r_i = got
        src_i, dst_i = _build_src_dst_for_permutation(
            dets,
            p_i,
            sl,
            rw,
            rh,
            marker_size,
            dst_w,
            dst_h,
            corner_rolls=r_i,
        )
        err_i = _reprojection_errors_per_point(h_i, src_i, dst_i)
        n_u = int(np.sum(err_i <= float(ransac_px)))
        mean_all = float(np.mean(err_i))
        max_e = float(np.max(err_i))
        inl = err_i <= float(ransac_px)
        mean_on_u = float(np.mean(err_i[inl])) if np.any(inl) else float("nan")
        mark = " ← used" if miss == resolved_missing else ""
        print(
            f"  missing={miss!r}: mean {mean_all:.3f} px, max {max_e:.3f} px, "
            f"{n_u}/12 ≤ {ransac_px:g}px (mean on those {mean_on_u:.3f} px){mark}",
            file=sys.stderr,
        )

    src, dst = _build_src_dst_for_permutation(
        dets,
        perm,
        slots,
        rw,
        rh,
        marker_size,
        dst_w,
        dst_h,
        corner_rolls=corner_rolls,
    )
    h64 = np.asarray(h_mat, dtype=np.float64)
    src_h = np.hstack([src.astype(np.float64), np.ones((12, 1))])
    proj = (h64 @ src_h.T).T
    wv = proj[:, 2:3]
    wv[wv == 0] = 1e-12
    pred = proj[:, :2] / wv
    err = np.linalg.norm(pred - dst.astype(np.float64), axis=1)
    inl = mask.ravel().astype(bool) if mask is not None else np.zeros(12, dtype=bool)

    print(
        "\nPer-corner (winning assignment), warp-space dst vs H·src:",
        file=sys.stderr,
    )
    print(
        f"{'#':>2} {'board':>4} {'ocv':>3} {'det':>3} "
        f"{'src_x':>8} {'src_y':>8} {'dst_x':>8} {'dst_y':>8} "
        f"{'err_px':>8} {'in':>3}",
        file=sys.stderr,
    )
    row = 0
    for slot_i in range(3):
        det_idx = perm[slot_i]
        corner_slot = slots[slot_i]
        for k in range(4):
            nm = _OCV_CORNER_NAMES[k]
            print(
                f"{row:2d} {corner_slot:>4} {nm:>3} {det_idx:3d} "
                f"{src[row, 0]:8.2f} {src[row, 1]:8.2f} "
                f"{dst[row, 0]:8.2f} {dst[row, 1]:8.2f} "
                f"{err[row]:8.3f} {'Y' if inl[row] else 'N':>3}",
                file=sys.stderr,
            )
            row += 1

    print(
        f"\nAll 12 points: mean err {float(np.mean(err)):.3f} px, "
        f"max err {float(np.max(err)):.3f} px",
        file=sys.stderr,
    )
    if np.any(inl):
        print(
            f"Inliers only: mean {float(np.mean(err[inl])):.3f} px, "
            f"max {float(np.max(err[inl])):.3f} px",
            file=sys.stderr,
        )
    if np.any(~inl):
        print(
            f"Outliers only: mean {float(np.mean(err[~inl])):.3f} px, "
            f"max {float(np.max(err[~inl])):.3f} px",
            file=sys.stderr,
        )
    print("--- end homography debug ---\n", file=sys.stderr)


def _warp_full_image_from_homography(
    image_bgra: np.ndarray,
    h_mat: np.ndarray,
    dst_w: int,
    dst_h: int,
) -> tuple[np.ndarray, np.ndarray]:
    if image_bgra.shape[2] != 4:
        raise ValueError("expected BGRA")
    h0, w0 = image_bgra.shape[:2]
    h_mat = np.asarray(h_mat, dtype=np.float64)
    inh = np.array(
        [[[0, 0], [w0 - 1, 0], [w0 - 1, h0 - 1], [0, h0 - 1]]], dtype=np.float32
    )
    warped_corners = cv2.perspectiveTransform(inh, h_mat.astype(np.float32)).reshape(
        -1, 2
    )
    min_xy = warped_corners.min(axis=0)
    max_xy = warped_corners.max(axis=0)
    out_w = int(np.ceil(max_xy[0] - min_xy[0]))
    out_h = int(np.ceil(max_xy[1] - min_xy[1]))
    t_x = float(-min_xy[0])
    t_y = float(-min_xy[1])
    t_mat = np.array([[1, 0, t_x], [0, 1, t_y], [0, 0, 1]], dtype=np.float64)
    h2 = t_mat @ h_mat
    warped = cv2.warpPerspective(
        image_bgra,
        h2,
        (out_w, out_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    return warped, h2.astype(np.float64)


def _draw_warped_marker_corner_dots(
    warped_bgra: np.ndarray,
    dets: list[np.ndarray],
    h2: np.ndarray,
    *,
    diameter_px: int = 2,
) -> None:
    """Filled circles at each of the 12 marker corners in warped coordinates."""
    d = max(1, int(diameter_px))
    # Geometric diameter d → integer radius (d=2 → r=1; d=1 → r=0, single pixel).
    radius = max(0, d // 2)
    color = (0, 0, 255, 255)
    h2f = h2.astype(np.float64)
    for det in dets:
        pts = det.reshape(1, 4, 2).astype(np.float32)
        wpts = cv2.perspectiveTransform(pts, h2f).reshape(4, 2)
        for p in wpts:
            cx = int(round(float(p[0])))
            cy = int(round(float(p[1])))
            cv2.circle(
                warped_bgra,
                (cx, cy),
                radius,
                color,
                thickness=-1,
                lineType=cv2.LINE_AA,
            )


def _save_image(path: Path, image: np.ndarray, jpeg_quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    suf = path.suffix.lower()
    if suf in (".jpg", ".jpeg"):
        if image.ndim == 3 and image.shape[2] == 4:
            print(
                "error: JPEG does not support alpha; use .png (or .webp) output.",
                file=sys.stderr,
            )
            sys.exit(2)
        ok, buf = cv2.imencode(
            ".jpg",
            image,
            [int(cv2.IMWRITE_JPEG_QUALITY), max(1, min(100, jpeg_quality))],
        )
        if not ok:
            raise RuntimeError("JPEG encode failed")
        path.write_bytes(buf.tobytes())
    else:
        if not cv2.imwrite(str(path), image):
            raise RuntimeError(f"Failed to write {path}")


def run(
    input_path: Path,
    output_path: Path,
    *,
    quad_dims: tuple[int, int],
    rect_dims: tuple[float, float],
    marker_size: float,
    missing_corner: str,
    dictionary_name: str,
    aruco_corner_refinement: int,
    homography_ransac_px: float,
    corner_dot_diameter_px: int,
    jpeg_quality: int,
    print_assignment: bool,
    detection_clahe_clip: float,
    debug_homography: bool,
    try_corner_cycles: bool,
    ls_refit_homography: bool,
    sheet_vertex_weight: float,
) -> None:
    if not input_path.is_file():
        print(f"error: not a file: {input_path}", file=sys.stderr)
        sys.exit(2)

    rw, rh = rect_dims
    dst_w, dst_h = quad_dims
    ar = dst_w * rh / (dst_h * rw)
    if abs(ar - 1.0) > 0.02:
        print(
            f"warning: aspect mismatch: --quad-dims {dst_w}×{dst_h} vs "
            f"--rect-dims {rw}×{rh} (ratio quad {dst_w/dst_h:.4f} vs rect {rw/rh:.4f}). "
            "Scale will be anisotropic in X vs Y.",
            file=sys.stderr,
        )

    image = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if image is None or image.size == 0:
        print(f"error: could not read image: {input_path}", file=sys.stderr)
        sys.exit(2)
    if image.ndim != 3 or image.shape[2] not in (3, 4):
        print("error: expected BGR or BGRA image", file=sys.stderr)
        sys.exit(2)

    image_bgra = (
        cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
        if image.shape[2] == 3
        else image
    )
    gray = cv2.cvtColor(image_bgra, cv2.COLOR_BGRA2GRAY)
    gray_detect = _gray_for_aruco_detection(
        gray, clahe_clip_limit=detection_clahe_clip
    )

    _warn_if_apriltag_refinement_mismatches_dictionary(
        dictionary_name, aruco_corner_refinement
    )
    aruco_dict = _get_aruco_dictionary(dictionary_name)
    detector = cv2.aruco.ArucoDetector(
        aruco_dict, _aruco_detector_params(aruco_corner_refinement)
    )
    corners_list, ids, _ = detector.detectMarkers(gray_detect)

    if ids is None or len(ids) == 0:
        print("error: no ArUco markers detected.", file=sys.stderr)
        sys.exit(1)

    n = len(corners_list)
    if n != 3:
        print(f"error: need exactly 3 markers, found {n}.", file=sys.stderr)
        sys.exit(1)

    flat_ids = ids.flatten().astype(int)
    indexed: list[tuple[int, int, np.ndarray]] = []
    for i, c in enumerate(corners_list):
        det = np.asarray(c, dtype=np.float32).reshape(4, 2)
        indexed.append((flat_ids[i], i, det))
    indexed.sort(key=lambda t: (t[0], t[1]))
    dets = [t[2] for t in indexed]
    ids_sorted = [t[0] for t in indexed]

    resolved_missing = missing_corner
    auto_note_pending = False
    if missing_corner == "auto":
        auto = _best_homography_auto_missing_corner(
            dets,
            rw,
            rh,
            marker_size,
            dst_w,
            dst_h,
            homography_ransac_px,
            try_corner_cycles=try_corner_cycles,
            sheet_vertex_weight=sheet_vertex_weight,
        )
        if auto is None:
            print(
                "error: could not fit homography for any missing-corner hypothesis "
                "(try --homography-ransac-px, check --rect-dims / --marker-size).",
                file=sys.stderr,
            )
            sys.exit(1)
        h_mat, mask, perm, corner_rolls, resolved_missing, slots = auto
        auto_note_pending = True
    else:
        slots = _three_occupied_corners(missing_corner)
        got = _best_homography_from_permutations(
            dets,
            slots,
            rw,
            rh,
            marker_size,
            dst_w,
            dst_h,
            homography_ransac_px,
            try_corner_cycles=try_corner_cycles,
            sheet_vertex_weight=sheet_vertex_weight,
        )
        if got is None:
            print(
                "error: could not fit homography (try --missing-corner auto, "
                "--homography-ransac-px, or check layout).",
                file=sys.stderr,
            )
            sys.exit(1)
        h_mat, mask, perm, corner_rolls = got

    src12, dst12 = _build_src_dst_for_permutation(
        dets,
        perm,
        slots,
        rw,
        rh,
        marker_size,
        dst_w,
        dst_h,
        corner_rolls=corner_rolls,
    )
    if auto_note_pending:
        print(
            f"note: --missing-corner auto chose {resolved_missing!r} "
            f"(mean reproj {_mean_reproj_error_all(h_mat, src12, dst12):.2f}px on 12 corners; "
            f"{int(mask.sum()) if mask is not None else 0}/12 ≤ {homography_ransac_px:g}px).",
            file=sys.stderr,
        )

    n_under_before_extra_ls = int(mask.sum()) if mask is not None else 0
    ls_refit_used = False
    if ls_refit_homography:
        h_new, mask_new, applied, mean_r, mean_l = _maybe_ls_refit_homography(
            h_mat,
            src12,
            dst12,
            homography_ransac_px,
            sheet_vertex_weight=sheet_vertex_weight,
        )
        if applied:
            h_mat = h_new
            mask = mask_new
            ls_refit_used = True
            metric = (
                "mean reproj"
                if abs(sheet_vertex_weight - 1.0) < 1e-12
                else "weighted RMS reproj"
            )
            print(
                f"note: second LS solve on 12 corners: {metric} "
                f"{mean_r:.3f} → {mean_l:.3f} px",
                file=sys.stderr,
            )

    inliers_post = int(mask.sum()) if mask is not None else 0
    mean_final = _mean_reproj_error_all(h_mat, src12, dst12)

    if inliers_post < 8 and mean_final > 6.0:
        print(
            f"warning: only {inliers_post}/12 corners within {homography_ransac_px:g}px of "
            f"model (mean reproj {mean_final:.2f}px); wrong --missing-corner is a common cause "
            f"(try --missing-corner auto). If markers are rotated, try --try-corner-cycles. "
            f"Also check --rect-dims, --marker-size, and --homography-ransac-px.",
            file=sys.stderr,
        )

    if print_assignment:
        parts = [
            f"{slots[i]} ← sorted_det[{perm[i]}] (id={ids_sorted[perm[i]]})"
            for i in range(3)
        ]
        print(
            f"assignment (missing={resolved_missing}): " + "; ".join(parts)
        )

    if debug_homography:
        _print_homography_debug(
            dets,
            perm,
            slots,
            corner_rolls,
            h_mat,
            mask,
            rw,
            rh,
            marker_size,
            dst_w,
            dst_h,
            homography_ransac_px,
            ids_sorted,
            resolved_missing,
            try_corner_cycles=try_corner_cycles,
            ls_refit_used=ls_refit_used,
            n_under_before_second_ls=n_under_before_extra_ls,
            sheet_vertex_weight=sheet_vertex_weight,
        )

    warped, h2 = _warp_full_image_from_homography(image_bgra, h_mat, dst_w, dst_h)

    _draw_warped_marker_corner_dots(
        warped, dets, h2, diameter_px=corner_dot_diameter_px
    )

    _save_image(output_path, warped, jpeg_quality)
    ow, oh = warped.shape[1], warped.shape[0]
    tail = (
        f"LS homography from 12 corners, mean reproj {mean_final:.2f}px, "
        f"{inliers_post}/12 ≤ {homography_ransac_px:g}px"
    )
    if ls_refit_used:
        tail += " (second LS pass applied)"
    if abs(sheet_vertex_weight - 1.0) >= 1e-12:
        tail += f"; sheet-vertex-weight {sheet_vertex_weight:g}"
    print(
        f"wrote {output_path} (canvas {ow}×{oh} px; board quad {dst_w}×{dst_h} px; "
        f"{tail})"
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description=(
            "Warp from 3 ArUco markers using 12 corners; no marker IDs required—"
            "tries 6 permutations and picks the assignment whose least-squares H on "
            "all 12 corners has lowest mean reproj. "
            "Use --rect-dims and --marker-size in the same length unit."
        )
    )
    p.add_argument("image", type=Path, help="Input image path")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output path (default: <stem>_plane_warp12.png)",
    )
    p.add_argument(
        "--quad-dims",
        type=_parse_quad_dims_arg,
        required=True,
        metavar="WxH",
        help="Warp rectangle size in pixels (match aspect of --rect-dims for isotropic scale).",
    )
    p.add_argument(
        "--rect-dims",
        type=_parse_rect_dims,
        required=True,
        metavar="WxH",
        help="Rectangle width × height in your chosen unit (same unit as --marker-size).",
    )
    p.add_argument(
        "--marker-size",
        type=_parse_marker_size,
        required=True,
        metavar="S",
        help="Marker edge length in the same unit as --rect-dims (square, axis-aligned).",
    )
    p.add_argument(
        "--missing-corner",
        type=_parse_missing_corner,
        default="tr",
        metavar="CORNER",
        help=(
            "Rectangle vertex with no marker: tl, tr, br, bl (default tr), or "
            "auto to try all four (fixes bad warp when the empty corner was guessed wrong)."
        ),
    )
    p.add_argument(
        "--print-assignment",
        action="store_true",
        help="Print which sorted detection was mapped to which board corner.",
    )
    p.add_argument(
        "--debug-homography",
        action="store_true",
        help=(
            "Print to stderr: LS scores per missing-corner hypothesis, "
            "then a 12-row table of src/dst/reproj error for the chosen H."
        ),
    )
    p.add_argument(
        "--try-corner-cycles",
        action="store_true",
        help=(
            "For each marker, try all 4 cyclic shifts of OpenCV's corner order before "
            "matching to board TL/TR/BR/BL (384 LS candidates per missing-corner hypothesis "
            "instead of 6). Use when a marker is rotated so corner 0 is not on the sheet vertex."
        ),
    )
    p.add_argument(
        "--no-ls-refit-homography",
        action="store_true",
        help=(
            "Skip optional second LS solve on the 12 corners when it would lower mean reproj "
            "(default: allow that second pass)."
        ),
    )
    p.add_argument(
        "--sheet-vertex-weight",
        type=_parse_sheet_vertex_weight,
        default=1.0,
        metavar="W",
        help=(
            "Per-point weight on the three marker corners that lie on sheet vertices "
            "(default 1 = uniform LS like before). Use W>1 (try 10–30) to prioritize "
            "global paper alignment over the nine interior marker corners—closer in spirit "
            "to the four-marker TL-only warp when rectifying verticals/horizontals."
        ),
    )
    p.add_argument(
        "--dictionary",
        default="DICT_4X4_50",
        help="OpenCV predefined dictionary name",
    )
    p.add_argument(
        "--aruco-refine",
        type=_parse_aruco_refine,
        default=_parse_aruco_refine("subpix"),
        metavar="MODE",
        help="subpix (default), contour, none, or apriltag",
    )
    p.add_argument(
        "--detection-clahe-clip",
        type=float,
        default=2.0,
        metavar="L",
        help=(
            "CLAHE clip limit on grayscale before detectMarkers (default 2). "
            "Improves flat/low-contrast lighting; use 0 to disable."
        ),
    )
    p.add_argument(
        "--homography-ransac-px",
        type=float,
        default=3.0,
        metavar="PX",
        help=(
            "Reprojection threshold in pixels for reporting how many of the 12 corners "
            "fall under τ and for tie-breaking assignments (default 3). "
            "Homography is fit with least squares on all 12 corners, not RANSAC."
        ),
    )
    p.add_argument(
        "--corner-dot-diameter",
        type=int,
        default=2,
        metavar="PX",
        help="Diameter in pixels of red overlay dots at each marker corner (default 2)",
    )
    p.add_argument("--jpeg-quality", type=int, default=95, help="For .jpg output only")
    args = p.parse_args()

    inp = args.image.expanduser().resolve()
    out = args.output
    if out is None:
        out = inp.with_name(f"{inp.stem}_plane_warp12.png")
    else:
        out = out.expanduser().resolve()

    run(
        inp,
        out,
        quad_dims=args.quad_dims,
        rect_dims=args.rect_dims,
        marker_size=args.marker_size,
        missing_corner=args.missing_corner,
        dictionary_name=args.dictionary,
        aruco_corner_refinement=args.aruco_refine,
        detection_clahe_clip=args.detection_clahe_clip,
        homography_ransac_px=args.homography_ransac_px,
        corner_dot_diameter_px=args.corner_dot_diameter,
        jpeg_quality=args.jpeg_quality,
        print_assignment=args.print_assignment,
        debug_homography=args.debug_homography,
        try_corner_cycles=args.try_corner_cycles,
        ls_refit_homography=not args.no_ls_refit_homography,
        sheet_vertex_weight=args.sheet_vertex_weight,
    )


if __name__ == "__main__":
    main()
