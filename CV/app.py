"""
Vision server: Flask REST API for chess board capture / motion detection.
Camera and OpenCV pipeline to be wired in later.
"""

from __future__ import annotations

import os
from dataclasses import asdict

import cv2
from flask import Flask, Response, jsonify, request

from vision.aruco_sheet import (
    build_marker_sheet,
    build_marker_sheet_pdf,
    list_dictionary_names,
)
from vision.board import (
    clear_stored_calibration,
    extract_board,
    find_board_corners,
    get_stored_calibration,
    get_stored_calibration_record,
    set_stored_calibration,
)
from vision.camera import probe_cameras, read_single_frame
from vision.board_aruco import (
    extract_board as extract_board_aruco
)

from dotenv import load_dotenv
load_dotenv() 

def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    @app.get("/api/aruco/marker-sheet")
    def aruco_marker_sheet():
        """
        Return a **PDF** (default) or **PNG** with ``count`` ArUco markers chosen to
        maximize minimum pairwise Hamming distance on inner bit grids (exact search
        for small search space, greedy fallback when the combination count is large).

        PDF page size is ``pixels / dpi`` inches so **100% / actual-size** print
        matches physical dimensions for the given ``dpi``.

        Query: ``count`` (required), ``dictionary`` (default DICT_4X4_250),
        ``format`` (``pdf`` default, or ``png``), ``dpi`` (PDF only, default 300),
        ``marker_side_px``, ``gap_px``, ``pad_px``, ``cols`` (optional layout),
        ``inverted`` (``0``/``1``, default ``0``),
        ``padding_ring_px`` (default 20) — opposite-color rim around each marker,
        ``cut_outline_px`` (0–4, default 1) — black cutting line on the outer edge when pad is white.
        """
        raw = request.args.get("count")
        if raw is None or str(raw).strip() == "":
            return (
                jsonify(
                    error="missing count",
                    hint="use ?count=4",
                    dictionaries=list_dictionary_names(),
                ),
                400,
            )
        try:
            count = int(raw)
        except ValueError:
            return jsonify(error="count must be an integer"), 400

        dictionary = request.args.get("dictionary", "DICT_4X4_50").strip()
        try:
            marker_side_px = int(request.args.get("marker_side_px", "300"))
            gap_px = int(request.args.get("gap_px", "100"))
            pad_px = int(request.args.get("pad_px", "100"))
        except ValueError:
            return jsonify(error="marker_side_px, gap_px, pad_px must be integers"), 400

        cols_raw = request.args.get("cols")
        cols = None
        if cols_raw is not None and str(cols_raw).strip() != "":
            try:
                cols = int(cols_raw)
            except ValueError:
                return jsonify(error="cols must be an integer"), 400
            if cols < 1:
                return jsonify(error="cols must be >= 1"), 400

        inv_raw = request.args.get("inverted", "0").strip().lower()
        inverted = inv_raw in ("1", "true", "yes", "on")
        try:
            padding_ring_px = int(request.args.get("padding_ring_px", "20"))
            cut_outline_px = int(request.args.get("cut_outline_px", "1"))
        except ValueError:
            return jsonify(error="padding_ring_px and cut_outline_px must be integers"), 400
        if padding_ring_px < 0 or padding_ring_px > 400:
            return jsonify(error="padding_ring_px must be between 0 and 400"), 400
        if cut_outline_px < 0 or cut_outline_px > 4:
            return jsonify(error="cut_outline_px must be between 0 and 4"), 400

        fmt = request.args.get("format", "pdf").strip().lower()
        if fmt not in ("pdf", "png"):
            return jsonify(error="format must be pdf or png"), 400

        dpi = 300.0
        if fmt == "pdf":
            try:
                dpi = float(request.args.get("dpi", "300"))
            except ValueError:
                return jsonify(error="dpi must be a number"), 400
            if dpi < 36 or dpi > 1200:
                return jsonify(error="dpi must be between 36 and 1200"), 400

        try:
            if fmt == "pdf":
                body, info = build_marker_sheet_pdf(
                    count=count,
                    dictionary_name=dictionary,
                    marker_side_px=max(32, min(2048, marker_side_px)),
                    gap_px=max(0, min(200, gap_px)),
                    pad_px=max(8, min(400, pad_px)),
                    cols=cols,
                    dpi=dpi,
                    inverted=inverted,
                    padding_ring_px=padding_ring_px,
                    cut_outline_px=cut_outline_px,
                )
                mime = "application/pdf"
            else:
                body, info = build_marker_sheet(
                    count=count,
                    dictionary_name=dictionary,
                    marker_side_px=max(32, min(2048, marker_side_px)),
                    gap_px=max(0, min(200, gap_px)),
                    pad_px=max(8, min(400, pad_px)),
                    cols=cols,
                    inverted=inverted,
                    padding_ring_px=padding_ring_px,
                    cut_outline_px=cut_outline_px,
                )
                mime = "image/png"
        except ValueError as e:
            return jsonify(error=str(e), dictionaries=list_dictionary_names()), 422

        ids = info["marker_ids"]
        headers = {
            "Cache-Control": "no-store",
            "X-Aruco-Dictionary": info["dictionary"],
            "X-Aruco-Min-Pairwise-Hamming": str(info["min_pairwise_hamming"]),
            "X-Aruco-Marker-Ids": ",".join(str(i) for i in ids),
            "X-Aruco-Format": fmt,
            "X-Aruco-Padding-Ring-Px": str(info.get("padding_ring_px", "")),
            "X-Aruco-Cut-Outline-Px": str(info.get("cut_outline_px", "")),
            "X-Aruco-Total-Tile-Side-Px": str(info.get("total_tile_side_px", "")),
            "X-Aruco-Inverted": "1" if info.get("inverted") else "0",
        }
        if fmt == "pdf":
            headers["X-Aruco-Export-Dpi"] = str(info.get("export_dpi", dpi))
            wmm, hmm = info.get("page_size_mm", (0, 0))
            headers["X-Aruco-Page-Size-Mm"] = f"{wmm:.2f}x{hmm:.2f}"
        return Response(
            body,
            mimetype=mime,
            headers=headers,
        )

    @app.get("/api/cameras")
    def list_cameras():
        """Probe a range of indices; return only cameras that open and yield a frame."""
        return jsonify(cameras=[asdict(ci) for ci in probe_cameras()])

    @app.get("/api/cameras/<int:index>")
    def camera_frame(index: int):
        """Return one JPEG frame from the given capture index (dev/test)."""
        try:
            warmup = int(request.args.get("warmup", "0"))
        except ValueError:
            warmup = 3
        try:
            quality = int(request.args.get("quality", "85"))
        except ValueError:
            quality = 85
        ok, frame = read_single_frame(index, warmup_frames=max(0, warmup))
        if not ok or frame is None:
            return jsonify(error="could not capture frame", index=index), 503
        enc_ok, buf = cv2.imencode(
            ".jpg",
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), min(100, max(1, quality))],
        )
        if not enc_ok:
            return jsonify(error="encode failed", index=index), 500
        return Response(
            buf.tobytes(),
            mimetype="image/jpeg",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/cameras/<int:index>/board-aruco")
    def camera_board_aruco(index: int):
        ok, frame = read_single_frame(index)
        if not ok or frame is None:
            return jsonify(error="could not capture frame", index=index), 503
        enc_ok, buf = cv2.imencode(
            ".jpg",
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), 100],
        )
        if not enc_ok:
            return jsonify(error="encode failed", index=index), 500
        warped, _corners = extract_board_aruco(frame)
        return Response(
            buf.tobytes(),
            mimetype="image/jpeg",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/cameras/<int:index>/board/calibration")
    def board_calibration_get(index: int):
        """
        Same JSON shape as successful POST (and on-disk file): ``ok``, ``frame_width``,
        ``frame_height``, ``corners``. Index is for URL consistency only.
        """
        record = get_stored_calibration_record()
        if record is None:
            return jsonify(ok=False)
        return jsonify(ok=True, **record)

    @app.delete("/api/cameras/<int:index>/board/calibration")
    def board_calibration_delete(index: int):
        """Remove persisted board calibration. Index is for URL consistency only."""
        cleared = clear_stored_calibration()
        return jsonify(ok=True, cleared=cleared, index=index)

    @app.post("/api/cameras/<int:index>/board/calibration")
    def board_calibration_post(index: int):
        """
        Capture one frame from ``index``, run edge-based board detection, and
        persist a single global quad (not keyed by camera).
        """
        try:
            warmup = int(request.args.get("warmup", "0"))
        except ValueError:
            warmup = 0

        ok, frame = read_single_frame(index, warmup_frames=max(0, warmup))
        if not ok or frame is None:
            return jsonify(error="could not capture frame", index=index), 503

        h, w = frame.shape[:2]
        corners = find_board_corners(frame)
        if corners is None:
            return jsonify(
                error="board outline not found",
                hint="adjust lighting/board edge visibility or VISION_BOARD_DEBUG_DIR",
            ), 422

        payload = set_stored_calibration(corners, w, h)
        return jsonify(ok=True, **payload)

    @app.get("/api/cameras/<int:index>/board")
    def camera_board(index: int):
        """
        Perspective-warped square JPEG using **persisted calibration** only.
        Requires POST ``/api/cameras/<index>/board/calibration`` first; returns
        **422** if missing or frame size does not match stored calibration.
        """
        try:
            warmup = int(request.args.get("warmup", "0"))
        except ValueError:
            warmup = 0
        try:
            quality = int(request.args.get("quality", "85"))
        except ValueError:
            quality = 85
        try:
            out_size = int(request.args.get("size", "800"))
        except ValueError:
            out_size = 800
        out_size = max(128, min(4096, out_size))

        ok, frame = read_single_frame(index, warmup_frames=max(0, warmup))
        if not ok or frame is None:
            return jsonify(error="could not capture frame", index=index), 503

        fh, fw = frame.shape[:2]
        cal_corners, cal_status = get_stored_calibration(fw, fh)
        if cal_status != "ok" or cal_corners is None:
            return (
                jsonify(
                    error="board calibration unavailable",
                    hint="POST /api/cameras/<index>/board/calibration first",
                ),
                422,
            )

        warped, _ = extract_board(frame, out_size=out_size, corners=cal_corners)
        if warped is None:
            return jsonify(error="warp failed", index=index), 500

        enc_ok, buf = cv2.imencode(
            ".jpg",
            warped,
            [int(cv2.IMWRITE_JPEG_QUALITY), min(100, max(1, quality))],
        )
        if not enc_ok:
            return jsonify(error="encode failed", index=index), 500
        return Response(
            buf.tobytes(),
            mimetype="image/jpeg",
            headers={
                "Cache-Control": "no-store",
                "X-Board-Warp-Source": "calibration",
            },
        )

    @app.post("/api/reset")
    def reset():
        # TODO: set flag to reseed prev on next capture interval; optional baseline
        return jsonify(ok=True)

    @app.post("/api/listening/start")
    def listening_start():
        # TODO: open listening window; begin polling loop
        return jsonify(ok=True)

    @app.post("/api/listening/stop")
    def listening_stop():
        # TODO: stop polling loop
        return jsonify(ok=True)

    return app


app = create_app()


if __name__ == "__main__":
    host = os.environ.get("VISION_HOST", "0.0.0.0")
    port = int(os.environ.get("VISION_PORT", "5050"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host=host, port=port, debug=debug)
