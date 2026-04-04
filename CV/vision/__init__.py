"""Vision pipeline: capture, board detection, motion (to be expanded)."""

from .board import (
    analyze_board_detection,
    debug_payload_for_json,
    extract_board,
    find_board_corners,
    save_board_debug_images,
    warp_board_square,
)

from .camera import (
    WebcamCapture,
    probe_cameras,
    read_single_frame,
)

__all__ = [
    "WebcamCapture",
    "analyze_board_detection",
    "debug_payload_for_json",
    "extract_board",
    "find_board_corners",
    "probe_cameras",
    "read_single_frame",
    "save_board_debug_images",
    "warp_board_square",
]
