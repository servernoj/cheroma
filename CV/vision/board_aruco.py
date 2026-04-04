"""
Board pose via ArUco markers on the rim.

Detection runs on **raw grayscale** and on **CLAHE** output, then merges by marker ID
(keeping the quad with larger perimeter) so borderline cases that only appear in one
path still decode, while duplicate ID hypotheses collapse to one.

Edit ``_clahe`` and ``_aruco_setup`` in the tuning block.

If ``VISION_BOARD_DEBUG_DIR`` is set, saves ``aruco_overlay.png``, ``aruco_gray.png``,
and ``aruco_clahe.png``. Each call prints marker count and ids to stdout.
"""

from __future__ import annotations

import os

import cv2
import numpy as np

# =============================================================================
# ArUco tuning — CLAHE + detector parameters
# =============================================================================


def _clahe(gray: np.ndarray) -> np.ndarray:
    clip_limit = 2.5
    tile_size = (8, 8)
    return cv2.createCLAHE(clip_limit, tile_size).apply(gray)


def _aruco_setup(dictionary: cv2.aruco.Dictionary) -> cv2.aruco.ArucoDetector:
    p = cv2.aruco.DetectorParameters()
    p.detectInvertedMarker = True
    p.minMarkerPerimeterRate = 0.008
    p.minMarkerDistanceRate = 0.05
    p.maxErroneousBitsInBorderRate = 0.5
    p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    # p.adaptiveThreshWinSizeMin = 3
    # p.adaptiveThreshWinSizeMax = 23
    # p.adaptiveThreshConstant = 7
    # p.polygonalApproxAccuracyRate = 0.05
    # p.minCornerDistanceRate = 0.05
    # p.minDistanceToBorder = 3
    # p.minOtsuStdDev = 5.0
    # p.perspectiveRemovePixelPerCell = 4
    # p.perspectiveRemoveIgnoredMarginPerCell = 0.13
    r = cv2.aruco.RefineParameters()
    return cv2.aruco.ArucoDetector(dictionary, p, r)



def find_board_corners(bgr: np.ndarray, dict: int) -> np.ndarray | None:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    equalized = _clahe(gray)
    dictionary = cv2.aruco.getPredefinedDictionary(dict)
    detector = _aruco_setup(dictionary)

    corners_list, ids, _ = detector.detectMarkers(equalized)

    n = 0 if ids is None else len(ids)
    id_list = [] if ids is None or n == 0 else ids.flatten().tolist()
    print(n, id_list)

    debug_dir = os.environ.get("VISION_BOARD_DEBUG_DIR", "").strip()
    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)
        overlay = bgr.copy()
        if corners_list:
            for marker_corner in corners_list:
                mc = marker_corner.reshape((4, 2))
                (tl, tr, br, bl) = mc
                tl = (int(tl[0]), int(tl[1]))
                tr = (int(tr[0]), int(tr[1]))
                br = (int(br[0]), int(br[1]))
                bl = (int(bl[0]), int(bl[1]))
                cv2.line(overlay, tl, tr, (0, 255, 0), 1)
                cv2.line(overlay, tr, br, (0, 255, 0), 1)
                cv2.line(overlay, br, bl, (0, 255, 0), 1)
                cv2.line(overlay, bl, tl, (0, 255, 0), 1)
                cv2.circle(overlay, tl, 4, (0, 0, 255), -1)

        cv2.imwrite(os.path.join(debug_dir, "aruco_overlay.png"), overlay)
        cv2.imwrite(os.path.join(debug_dir, "aruco_gray.png"), gray)
        cv2.imwrite(os.path.join(debug_dir, "aruco_clahe.png"), equalized)

    return None


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
    dict: int = cv2.aruco.DICT_4X4_50,
    out_size: int = 800,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    corners = find_board_corners(bgr, dict)
    if corners is None:
        return None, None
    warped = warp_board_square(bgr, corners, out_size=out_size)
    return warped, corners
