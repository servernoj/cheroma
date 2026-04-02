"""
USB / built-in camera access via OpenCV VideoCapture.

On macOS the default backend is usually AVFoundation; on Linux, V4L2.
Devices are selected by integer index (0 = first camera, 1 = second, ...).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import cv2
from cv2_enumerate_cameras import enumerate_cameras
import numpy as np


def _warmup_reads(cap: cv2.VideoCapture, n: int = 5) -> None:
    """Discard a few frames so auto-exposure can settle (helps first read succeed)."""
    for _ in range(n):
        cap.read()


@dataclass
class CameraProbeResult:
    index: int
    name: str
    backend_name: str


def read_single_frame(index: int, warmup_frames: int = 3) -> tuple[bool, np.ndarray | None]:
    """
    Open the device at ``index``, optionally discard warmup frames, read one frame, close.
    For dev/preview HTTP endpoints; not for high-FPS loops (reopens each time).
    """
    cap = cv2.VideoCapture(index)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter.fourcc('M','J','P','G'))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
    if not cap.isOpened():
        return False, None
    try:
        if warmup_frames > 0:
            _warmup_reads(cap, warmup_frames)
        return cap.read()
    finally:
        cap.release()


def probe_cameras() -> list[CameraProbeResult]:
    results: list[CameraProbeResult] = []
    names = [ci.name for ci in enumerate_cameras()]
    for i in range(len(names)):
        cap = cv2.VideoCapture(i)
        frame_ok = False
        backend = "n/a"
        if cap.isOpened():
            backend = cap.getBackendName()    
            name = names[i]        
            ok, frame = cap.read()
            frame_ok = bool(ok and frame is not None and frame.size > 0)
            if frame_ok:
                results.append(
                    CameraProbeResult(
                        index=i,
                        name = name,
                        backend_name=backend,
                    )
                )
        cap.release()        
    return results


def camera_index_from_env() -> int:
    raw = os.environ.get("VISION_CAMERA_INDEX", "0")
    try:
        return int(raw, 10)
    except ValueError:
        return 0


class WebcamCapture:
    """
    Context-manager friendly wrapper around cv2.VideoCapture.

    Usage:
        with WebcamCapture() as cam:
            ok, frame = cam.read()
    """

    def __init__(self, index: int | None = None) -> None:
        self._index = camera_index_from_env() if index is None else index
        self._cap: cv2.VideoCapture | None = None

    @property
    def index(self) -> int:
        return self._index

    def open(self) -> bool:
        if self._cap is not None:
            return self._cap.isOpened()
        self._cap = cv2.VideoCapture(self._index)
        return self._cap.isOpened()

    def release(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def read(self) -> tuple[bool, np.ndarray | None]:
        if self._cap is None or not self._cap.isOpened():
            return False, None
        return self._cap.read()

    def get(self, prop_id: int) -> float:
        if self._cap is None:
            return 0.0
        return float(self._cap.get(prop_id))

    def set(self, prop_id: int, value: float) -> bool:
        if self._cap is None:
            return False
        return bool(self._cap.set(prop_id, value))

    def __enter__(self) -> WebcamCapture:
        if not self.open():
            raise RuntimeError(
                f"Could not open camera index {self._index}. "
                "Call GET /api/cameras with the server running and set VISION_CAMERA_INDEX."
            )
        return self

    def __exit__(self, *args: Any) -> None:
        self.release()
