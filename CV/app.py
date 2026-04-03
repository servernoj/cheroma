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
    analyze_board_detection,
    debug_payload_for_json,
    extract_board,
    save_board_debug_images,
)
from vision.camera import probe_cameras, read_single_frame

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
        ``marker_side_px``, ``gap_px``, ``pad_px``, ``cols`` (optional layout).
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

    @app.get("/api/cameras/<int:index>/frame")
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

    @app.get("/api/cameras/<int:index>/frame/board")
    def camera_frame_board(index: int):
        """Capture one frame, detect board quad, return warped square JPEG (dev)."""
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

        warped, _corners = extract_board(frame, out_size=out_size)
        if warped is None:
            return jsonify(error="board outline not found", index=index), 422

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
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/cameras/<int:index>/frame/board/debug")
    def camera_frame_board_debug(index: int):
        """
        Capture one frame; return JSON detection stats. When VISION_BOARD_DEBUG_DIR is set,
        writes pipeline PNGs there (no base64 in the response).
        """
        try:
            warmup = int(request.args.get("warmup", "0"))
        except ValueError:
            warmup = 0

        ok, frame = read_single_frame(index, warmup_frames=max(0, warmup))
        if not ok or frame is None:
            return jsonify(error="could not capture frame", index=index), 503

        analysis = analyze_board_detection(frame)
        payload = debug_payload_for_json(analysis)
        payload["index"] = index
        payload["detection_ok"] = analysis.get("ok")

        debug_dir = os.environ.get("VISION_BOARD_DEBUG_DIR", "").strip()
        if debug_dir:
            payload["saved_files"] = save_board_debug_images(
                analysis, debug_dir, prefix=f"cam{index}"
            )
        else:
            payload["saved_files"] = []

        return jsonify(payload)

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
