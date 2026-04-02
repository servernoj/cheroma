"""Vision pipeline: capture, board detection, motion (to be expanded)."""

from .camera import WebcamCapture, probe_cameras, read_single_frame

__all__ = ["WebcamCapture", "probe_cameras", "read_single_frame"]
