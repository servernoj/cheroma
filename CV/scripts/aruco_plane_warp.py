#!/usr/bin/env python3
"""
Offline CLI: detect exactly four ArUco markers, estimate the plane homography,
warp the **full** image without cropping to the marker quad, draw the rectified
quad in red, and save the **warp canvas**: tight axis-aligned bbox of the warped
full frame (no extra padding). ``--quad-dims`` sets the marker rectangle size in
that space; gaps inside the bbox with no source pixel are **transparent** (BGRA,
default ``.png``). Quad vertices use each marker's **top-left** corner (OpenCV's
first corner, clockwise from top-left in marker space).

``--quad-dims WxH`` is **required**: it sets the rectified marker rectangle in warp
space (e.g. ``1000x400``), so pixel **width / height ratio** matches your known
physical rectangle for consistent mm-per-pixel along X and Y (up to one scale).

Optional ``--detection-clahe-clip`` applies CLAHE to grayscale **only** for
``detectMarkers`` (default 0 = raw gray, unchanged from older versions). Use the
same value as ``aruco_plane_warp_board12.py`` when comparing the two scripts.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def _order_corners_tl_tr_br_bl(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype(np.float32)
    rect = np.zeros((4, 2), dtype=np.float32)
    # Per-corner scalars, shape (4,) — same layout for s and d.
    s = pts[:, 0] + pts[:, 1]
    d = pts[:, 1] - pts[:, 0]
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect


def _marker_top_left_corners(corners: Sequence[Any]) -> np.ndarray:
    """
    One 2D point per marker: the marker's **top-left** vertex.

    OpenCV returns corners clockwise starting from the marker's top-left in
    marker coordinates; that is index ``0`` after reshaping to (4, 2).

    ``corners`` is typed loosely because ``cv2.aruco.ArucoDetector.detectMarkers``
    is annotated as ``Sequence[MatLike]``, not ``list[ndarray]``.
    """
    pts: list[np.ndarray] = []
    for c in corners:
        m = np.asarray(c, dtype=np.float32).reshape(4, 2)
        pts.append(m[0].copy())
    return np.stack(pts, axis=0)


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
    """
    CORNER_REFINE_APRILTAG drives AprilTag-2-style processing; with classic ArUco
    predefined dicts (DICT_4X4_*, etc.) OpenCV often finds few or no markers.
    """
    if corner_refinement != cv2.aruco.CORNER_REFINE_APRILTAG:
        return
    key = dictionary_name.strip().upper().replace("-", "_")
    if "APRILTAG" in key:
        return
    print(
        "warning: --aruco-refine apriltag is aimed at DICT_APRILTAG_* dictionaries; "
        "with classic ArUco (e.g. DICT_4X4_*) detection often drops to one or zero "
        "markers. Use subpix or contour for those markers.",
        file=sys.stderr,
    )


def _parse_aruco_refine(value: str) -> int:
    """
    Map CLI string → cv2.aruco.CORNER_REFINE_*.

    OpenCV defaults to CORNER_REFINE_NONE (integer pixel corners). Sub-pixel
    refinement usually tightens corners by a noticeable fraction of a pixel
    up to a few pixels, depending on blur and marker size.

    ``apriltag`` is not a drop-in upgrade for classic ArUco markers: it follows
    the AprilTag-2 path and typically fails or thins out detections unless the
    dictionary is an AprilTag family (``DICT_APRILTAG_*``).
    """
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
        # Slightly stricter than OpenCV defaults (0.1, 30) — helps when edges are sharp.
        params.cornerRefinementMinAccuracy = 0.05
        params.cornerRefinementMaxIterations = 40
    return params


def _gray_for_aruco_detection(gray: np.ndarray, *, clahe_clip_limit: float) -> np.ndarray:
    if clahe_clip_limit <= 0:
        return gray
    clip = min(40.0, float(clahe_clip_limit))
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _warp_full_image_no_crop(
    image_bgra: np.ndarray,
    src_ordered: np.ndarray,
    dst_w: int,
    dst_h: int,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Homography from src quad to [0,dst_w]×[0,dst_h], then warp full frame with
    translation so the warped frame fits a **tight** axis-aligned bbox. Source must
    be BGRA; unmappable pixels become transparent (0,0,0,0).

    Returns (warped BGRA, H2 3×3 applied by warpPerspective).
    """
    if image_bgra.shape[2] != 4:
        raise ValueError("_warp_full_image_no_crop expects BGRA input")
    h0, w0 = image_bgra.shape[:2]
    dst = np.array(
        [[0, 0], [dst_w, 0], [dst_w, dst_h], [0, dst_h]], dtype=np.float32
    )
    h_mat = cv2.getPerspectiveTransform(src_ordered.astype(np.float32), dst)
    inh = np.array(
        [[[0, 0], [w0 - 1, 0], [w0 - 1, h0 - 1], [0, h0 - 1]]], dtype=np.float32
    )
    warped_corners = cv2.perspectiveTransform(inh, h_mat).reshape(-1, 2)
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


def _quad_in_warped_space(h2: np.ndarray, src_ordered: np.ndarray) -> np.ndarray:
    """Map original quad corners into warped image coordinates."""
    homog = np.hstack([src_ordered.astype(np.float64), np.ones((4, 1))])
    wh = (h2 @ homog.T).T
    w = wh[:, 2:3]
    w[w == 0] = 1e-12
    pts = (wh[:, :2] / w).astype(np.float32)
    return pts.reshape(-1, 1, 2)


def _save_image(path: Path, image: np.ndarray, jpeg_quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    suf = path.suffix.lower()
    if suf in (".jpg", ".jpeg"):
        if image.ndim == 3 and image.shape[2] == 4:
            print(
                "error: JPEG does not support alpha; use a .png (or .webp) output path.",
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


def _parse_quad_dims_arg(value: str) -> tuple[int, int]:
    """``WxH`` or ``W,H`` → ``(width, height)`` in destination quad pixels."""
    v = value.strip().lower().replace("*", "x")
    if "x" in v:
        parts = v.split("x", 1)
    elif "," in v:
        parts = v.split(",", 1)
    else:
        raise argparse.ArgumentTypeError(
            "--quad-dims must be WxH, e.g. 1000x400 or 1000,400"
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


def run(
    input_path: Path,
    output_path: Path,
    *,
    quad_dims: tuple[int, int],
    dictionary_name: str,
    aruco_corner_refinement: int,
    line_thickness: int,
    jpeg_quality: int,
    detection_clahe_clip: float,
) -> None:
    if not input_path.is_file():
        print(f"error: not a file: {input_path}", file=sys.stderr)
        sys.exit(2)

    image = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if image is None or image.size == 0:
        print(f"error: could not read image: {input_path}", file=sys.stderr)
        sys.exit(2)

    if image.ndim != 3 or image.shape[2] not in (3, 4):
        print(
            "error: expected BGR or BGRA image (3 or 4 channels)", file=sys.stderr
        )
        sys.exit(2)

    if image.shape[2] == 3:
        image_bgra = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    else:
        image_bgra = image

    gray = cv2.cvtColor(image_bgra, cv2.COLOR_BGRA2GRAY)
    gray_detect = _gray_for_aruco_detection(gray, clahe_clip_limit=detection_clahe_clip)

    _warn_if_apriltag_refinement_mismatches_dictionary(
        dictionary_name, aruco_corner_refinement
    )
    aruco_dict = _get_aruco_dictionary(dictionary_name)
    params = _aruco_detector_params(aruco_corner_refinement)
    detector = cv2.aruco.ArucoDetector(aruco_dict, params)
    corners, ids, _ = detector.detectMarkers(gray_detect)

    if ids is None or len(ids) == 0:
        print("error: no ArUco markers detected.", file=sys.stderr)
        sys.exit(1)

    if len(corners) != 4:
        print(
            f"error: need exactly 4 markers, found {len(corners)}.", file=sys.stderr
        )
        sys.exit(1)

    flat_ids = ids.flatten().astype(int)
    if len(np.unique(flat_ids)) != 4:
        print(
            "error: need 4 markers with distinct IDs (duplicate IDs detected).",
            file=sys.stderr,
        )
        sys.exit(1)

    src_tl_quad = _marker_top_left_corners(corners)
    src_ordered = _order_corners_tl_tr_br_bl(src_tl_quad)
    dst_w, dst_h = quad_dims

    warped, h2 = _warp_full_image_no_crop(image_bgra, src_ordered, dst_w, dst_h)

    warped_quad = _quad_in_warped_space(h2, src_ordered)
    contour = np.rint(warped_quad).astype(np.int32)
    cv2.polylines(
        warped,
        [contour],
        True,
        (0, 0, 255, 255),
        max(1, int(line_thickness)),
        cv2.LINE_AA,
    )

    _save_image(output_path, warped, jpeg_quality)
    ow, oh = warped.shape[1], warped.shape[0]
    print(
        f"wrote {output_path} (canvas {ow}×{oh} px; marker quad {dst_w}×{dst_h} px)"
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description="Warp full image from 4 ArUco markers (no crop), draw red quad. "
        "Quad = top-left of each marker. Requires --quad-dims WxH for rectified quad "
        "size (known side ratio). Output is BGRA: tight bbox, transparent gaps. "
        "Default output name uses .png."
    )
    p.add_argument("image", type=Path, help="Input image path")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output path (default: <stem>_plane_warp.png for alpha)",
    )
    p.add_argument(
        "--quad-dims",
        type=_parse_quad_dims_arg,
        required=True,
        metavar="WxH",
        dest="quad_dims",
        help=(
            "Required. Rectified marker quad in warp space (width × height), e.g. "
            "1000x400 or 1000,400. Match W:H to your physical rectangle so X/Y "
            "pixel scale stays in proportion. Canvas is the tight bbox of the "
            "warped frame; undefined pixels are transparent."
        ),
    )
    p.add_argument(
        "--dictionary",
        default="DICT_4X4_50",
        help="OpenCV predefined dictionary name, e.g. DICT_4X4_250",
    )
    p.add_argument(
        "--aruco-refine",
        type=_parse_aruco_refine,
        default=_parse_aruco_refine("subpix"),
        metavar="MODE",
        help=(
            "Corner refinement: subpix (default), contour, none, or apriltag. "
            "apriltag follows AprilTag-2-style detection and usually breaks classic "
            "ArUco (DICT_4X4_* …); reserve it for DICT_APRILTAG_* dictionaries."
        ),
    )
    p.add_argument(
        "--detection-clahe-clip",
        type=float,
        default=0.0,
        metavar="L",
        help=(
            "CLAHE clip limit on grayscale before detectMarkers (default 0 = off). "
            "Same option as aruco_plane_warp_board12.py for apples-to-apples tests."
        ),
    )
    p.add_argument(
        "--line-thickness",
        type=int,
        default=2,
        help="Red quad line thickness in warp space (default 2)",
    )
    p.add_argument(
        "--jpeg-quality",
        type=int,
        default=95,
        help="JPEG quality when output is .jpg/.jpeg (default 95)",
    )
    args = p.parse_args()

    inp = args.image.expanduser().resolve()
    out = args.output
    if out is None:
        out = inp.with_name(f"{inp.stem}_plane_warp.png")
    else:
        out = out.expanduser().resolve()

    run(
        inp,
        out,
        quad_dims=args.quad_dims,
        dictionary_name=args.dictionary,
        aruco_corner_refinement=args.aruco_refine,
        line_thickness=args.line_thickness,
        jpeg_quality=args.jpeg_quality,
        detection_clahe_clip=args.detection_clahe_clip,
    )


if __name__ == "__main__":
    main()
