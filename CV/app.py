"""
Vision server: Flask REST API for chess board capture / motion detection.
Camera and OpenCV pipeline to be wired in later.
"""

from __future__ import annotations

import os
from dataclasses import asdict

import cv2
from flask import Flask, Response, jsonify, request

from vision.camera import (
    probe_cameras,
    read_single_frame
)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)), 10)
    except ValueError:
        return default


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/health")
    def health():
        return jsonify(status="ok")

    @app.get("/api/cameras")
    def list_cameras():
        """Probe a range of indices; return only cameras that open and yield a frame."""
        return jsonify(cameras=[asdict(ci) for ci in probe_cameras()])

    @app.get("/api/camera/<int:index>/frame")
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
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host=host, port=port, debug=debug)
