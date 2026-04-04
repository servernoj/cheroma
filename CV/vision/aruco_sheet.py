"""
ArUco marker sheet: pick marker IDs with large pairwise Hamming distance and draw a PNG grid.
"""

from __future__ import annotations

import math
from io import BytesIO
from itertools import combinations
from typing import Final

import cv2
import numpy as np
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

# OpenCV predefined dictionary name -> id (for query parsing)
_ARUCO_DICTIONARIES: Final[dict[str, int]] = {
    "DICT_4X4_50": cv2.aruco.DICT_4X4_50,
    "DICT_4X4_100": cv2.aruco.DICT_4X4_100,
    "DICT_4X4_250": cv2.aruco.DICT_4X4_250,
    "DICT_4X4_1000": cv2.aruco.DICT_4X4_1000,
    "DICT_5X5_50": cv2.aruco.DICT_5X5_50,
    "DICT_5X5_100": cv2.aruco.DICT_5X5_100,
    "DICT_5X5_250": cv2.aruco.DICT_5X5_250,
    "DICT_5X5_1000": cv2.aruco.DICT_5X5_1000,
    "DICT_6X6_50": cv2.aruco.DICT_6X6_50,
    "DICT_6X6_100": cv2.aruco.DICT_6X6_100,
    "DICT_6X6_250": cv2.aruco.DICT_6X6_250,
    "DICT_6X6_1000": cv2.aruco.DICT_6X6_1000,
    "DICT_7X7_50": cv2.aruco.DICT_7X7_50,
    "DICT_7X7_100": cv2.aruco.DICT_7X7_100,
    "DICT_7X7_250": cv2.aruco.DICT_7X7_250,
    "DICT_7X7_1000": cv2.aruco.DICT_7X7_1000,
    "DICT_ARUCO_ORIGINAL": cv2.aruco.DICT_ARUCO_ORIGINAL,
}

MAX_BRUTE_COMBINATIONS: Final[int] = 350_000


def list_dictionary_names() -> list[str]:
    return sorted(_ARUCO_DICTIONARIES.keys())


def resolve_dictionary(name: str) -> int:
    key = name.strip().upper()
    if key not in _ARUCO_DICTIONARIES:
        raise ValueError(
            f"unknown dictionary {name!r}; use one of {list_dictionary_names()}"
        )
    return _ARUCO_DICTIONARIES[key]


def _marker_inner_bits(aruco_dict: cv2.aruco.Dictionary, marker_id: int) -> np.ndarray:
    """Binary grid (markerSize x markerSize) for canonical marker orientation."""
    n = aruco_dict.markerSize
    border = 1
    cells = n + 2 * border
    img = np.zeros((cells, cells), np.uint8)
    cv2.aruco.generateImageMarker(aruco_dict, marker_id, cells, img, border)
    inner = img[border : border + n, border : border + n]
    return (inner > 127).astype(np.uint8)


def _hamming_matrix(aruco_dict: cv2.aruco.Dictionary, num_markers: int) -> np.ndarray:
    """Upper-triangle stored in full matrix: H[i,j] = Hamming distance, i != j; diagonal 0."""
    bits = [_marker_inner_bits(aruco_dict, i) for i in range(num_markers)]
    H = np.zeros((num_markers, num_markers), dtype=np.int32)
    for i in range(num_markers):
        for j in range(i + 1, num_markers):
            d = int(np.sum(bits[i] != bits[j]))
            H[i, j] = d
            H[j, i] = d
    return H


def _min_pairwise_distance(H: np.ndarray, ids: list[int]) -> int:
    if len(ids) < 2:
        return 0
    m = 10**9
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            m = min(m, int(H[a, b]))
    return m


def _select_optimal_ids_brute(H: np.ndarray, m: int, n: int) -> tuple[list[int], int]:
    best: tuple[int, ...] | None = None
    best_min = -1
    for comb in combinations(range(m), n):
        d = _min_pairwise_distance(H, list(comb))
        if d > best_min:
            best_min = d
            best = comb
    assert best is not None
    return list(best), best_min


def _select_optimal_ids_greedy(H: np.ndarray, m: int, n: int) -> tuple[list[int], int]:
    """Heuristic: start with the pair farthest apart; add the ID maximizing min distance to the set."""
    if n <= 0:
        return [], 0
    if n == 1:
        return [0], 0
    if n == 2:
        best_i, best_j = 0, 1
        best_d = -1
        for i in range(m):
            for j in range(i + 1, m):
                d = int(H[i, j])
                if d > best_d:
                    best_d = d
                    best_i, best_j = i, j
        return [best_i, best_j], best_d

    best_pair = (0, 1)
    best_pd = -1
    for i in range(m):
        for j in range(i + 1, m):
            d = int(H[i, j])
            if d > best_pd:
                best_pd = d
                best_pair = (i, j)

    selected = list(best_pair)
    while len(selected) < n:
        best_cand = -1
        best_score = -1
        for j in range(m):
            if j in selected:
                continue
            score = min(int(H[j, s]) for s in selected)
            if score > best_score:
                best_score = score
                best_cand = j
        selected.append(best_cand)
    return selected, _min_pairwise_distance(H, selected)


def select_marker_ids_for_distance(
    aruco_dict: cv2.aruco.Dictionary, count: int
) -> tuple[list[int], int]:
    """
    Choose ``count`` marker IDs from the dictionary such that the minimum pairwise
    Hamming distance (on inner bit grids) is as large as possible.

    Returns (sorted_ids, min_pairwise_hamming).
    """
    m = aruco_dict.bytesList.shape[0]
    if count < 1:
        raise ValueError("count must be >= 1")
    if count > m:
        raise ValueError(f"count {count} exceeds dictionary size {m}")

    H = _hamming_matrix(aruco_dict, m)

    if count == 1:
        return [0], 0

    ncomb = math.comb(m, count)
    if ncomb <= MAX_BRUTE_COMBINATIONS:
        ids, vmin = _select_optimal_ids_brute(H, m, count)
    else:
        ids, vmin = _select_optimal_ids_greedy(H, m, count)

    return sorted(ids), vmin


def render_marker_sheet_png(
    aruco_dict: cv2.aruco.Dictionary,
    marker_ids: list[int],
    *,
    marker_side_px: int = 160,
    gap_px: int = 24,
    pad_px: int = 32,
    cols: int | None = None,
    label: bool = True,
    inverted: bool = False,
    padding_ring_px: int = 20,
    cut_outline_px: int = 1,
) -> tuple[bytes, dict]:
    """
    Draw markers on a white canvas with a **padding ring** around each (sharp corners).

    The ring uses the color **opposite** to the marker's outer rim: white pad for
    normal (black) markers, black pad for inverted (white-rim) markers. When the pad
    is white, a thin **black** rectangle is drawn on the outer edge of the full tile
    (cutting line). Inverted tiles omit that line so the black pad stays clean.
    """
    if not marker_ids:
        raise ValueError("marker_ids must be non-empty")

    pr = max(0, int(padding_ring_px))
    total_side = marker_side_px + 2 * pr

    n = len(marker_ids)
    if cols is None:
        cols = max(1, int(math.ceil(math.sqrt(n))))
    rows = int(math.ceil(n / cols))

    label_h = 28 if label else 0
    cell_w = total_side + gap_px
    row_h = total_side + label_h + gap_px
    w = pad_px * 2 + cols * cell_w - gap_px
    h = pad_px * 2 + rows * row_h - (gap_px if rows else 0)
    canvas = np.full((h, w), 255, dtype=np.uint8)

    border_bits = 1
    cut_t = max(0, min(4, int(cut_outline_px)))
    meta: dict = {
        "marker_side_px": marker_side_px,
        "padding_ring_px": pr,
        "cut_outline_px": cut_t if not inverted else 0,
        "total_tile_side_px": total_side,
        "gap_px": gap_px,
        "cols": cols,
        "rows": rows,
        "canvas_wh": [w, h],
        "inverted": inverted,
    }

    for idx, mid in enumerate(marker_ids):
        r, c = divmod(idx, cols)
        x0 = pad_px + c * cell_w
        y0 = pad_px + r * row_h
        # Opposite rim: normal → white pad; inverted (white rim) → black pad
        pad_color = 0 if inverted else 255
        tile = canvas[y0 : y0 + total_side, x0 : x0 + total_side]
        tile[:] = pad_color

        mx = x0 + pr
        my = y0 + pr
        roi = canvas[my : my + marker_side_px, mx : mx + marker_side_px]
        cv2.aruco.generateImageMarker(
            aruco_dict, mid, marker_side_px, roi, border_bits
        )
        if inverted:
            cv2.bitwise_not(roi, roi)

        if not inverted and cut_t > 0:
            cv2.rectangle(
                canvas,
                (x0, y0),
                (x0 + total_side - 1, y0 + total_side - 1),
                0,
                cut_t,
            )

        if label:
            cv2.putText(
                canvas,
                f"id={mid}",
                (x0, y0 + total_side + 20),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                0,
                1,
                cv2.LINE_AA,
            )

    ok, buf = cv2.imencode(".png", canvas)
    if not ok:
        raise RuntimeError("PNG encode failed")
    return buf.tobytes(), meta


def png_bytes_to_pdf_with_dpi(png_bytes: bytes, dpi: float) -> tuple[bytes, dict]:
    """
    Wrap a raster marker sheet in a single-page PDF whose **page size** matches
    ``pixels / dpi`` inches. Viewers and printers that honor “actual size” / 100%
    scale will reproduce that physical size.

    ``dpi`` is the **logical** resolution used for pixel→inch conversion (e.g. 300).
    """
    if dpi <= 0:
        raise ValueError("dpi must be positive")

    arr = cv2.imdecode(np.frombuffer(png_bytes, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if arr is None:
        raise ValueError("invalid PNG bytes")
    h_px, w_px = arr.shape[:2]

    w_in = w_px / dpi
    h_in = h_px / dpi
    w_pt = w_in * 72.0
    h_pt = h_in * 72.0

    out = BytesIO()
    c = canvas.Canvas(out, pagesize=(w_pt, h_pt))
    c.drawImage(
        ImageReader(BytesIO(png_bytes)),
        0,
        0,
        width=w_pt,
        height=h_pt,
        mask="auto",
    )
    c.save()
    pdf_meta = {
        "dpi": dpi,
        "page_size_in": [w_in, h_in],
        "page_size_mm": [w_in * 25.4, h_in * 25.4],
        "pixels_wh": [w_px, h_px],
    }
    return out.getvalue(), pdf_meta


def build_marker_sheet(
    *,
    count: int,
    dictionary_name: str = "DICT_4X4_250",
    marker_side_px: int = 160,
    gap_px: int = 24,
    pad_px: int = 32,
    cols: int | None = None,
    inverted: bool = False,
    padding_ring_px: int = 20,
    cut_outline_px: int = 1,
) -> tuple[bytes, dict]:
    """
    Full pipeline: resolve dictionary, optimize IDs, render PNG.

    Returned dict includes: dictionary, marker_ids, min_pairwise_hamming, render meta.
    """
    did = resolve_dictionary(dictionary_name)
    aruco_dict = cv2.aruco.getPredefinedDictionary(did)
    ids, vmin = select_marker_ids_for_distance(aruco_dict, count)
    png, rmeta = render_marker_sheet_png(
        aruco_dict,
        ids,
        marker_side_px=marker_side_px,
        gap_px=gap_px,
        pad_px=pad_px,
        cols=cols,
        label=True,
        inverted=inverted,
        padding_ring_px=padding_ring_px,
        cut_outline_px=cut_outline_px,
    )
    info = {
        "dictionary": dictionary_name.strip().upper(),
        "marker_ids": ids,
        "min_pairwise_hamming": vmin,
        **rmeta,
    }
    return png, info


def build_marker_sheet_pdf(
    *,
    count: int,
    dictionary_name: str = "DICT_4X4_250",
    marker_side_px: int = 160,
    gap_px: int = 24,
    pad_px: int = 32,
    cols: int | None = None,
    dpi: float = 300.0,
    inverted: bool = False,
    padding_ring_px: int = 20,
    cut_outline_px: int = 1,
) -> tuple[bytes, dict]:
    """
    Same as ``build_marker_sheet``, but returns a one-page PDF with page dimensions
    derived from raster size and ``dpi`` (see ``png_bytes_to_pdf_with_dpi``).
    """
    png, info = build_marker_sheet(
        count=count,
        dictionary_name=dictionary_name,
        marker_side_px=marker_side_px,
        gap_px=gap_px,
        pad_px=pad_px,
        cols=cols,
        inverted=inverted,
        padding_ring_px=padding_ring_px,
        cut_outline_px=cut_outline_px,
    )
    pdf, pdf_meta = png_bytes_to_pdf_with_dpi(png, dpi)
    info["export_dpi"] = pdf_meta["dpi"]
    info["page_size_mm"] = pdf_meta["page_size_mm"]
    return pdf, info
