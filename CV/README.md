# Vision server (Python + OpenCV + Flask)

REST API for camera capture and board / motion processing. Intended to run on a Raspberry Pi in production; development can use a Mac or Linux machine with a USB webcam.

## Requirements

- Python 3.10+ recommended (3.14+ tested)
- USB camera (or compatible capture device) when exercising the pipeline

## Setup on a new machine

From the repository root:

```bash
cd CV
python3 -m venv .venv
```

Activate the virtual environment:

- **macOS / Linux:** `source .venv/bin/activate`
- **Windows (cmd):** `.venv\Scripts\activate.bat`
- **Windows (PowerShell):** `.venv\Scripts\Activate.ps1`

Install dependencies:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

## Run the server

With the venv activated:

```bash
python app.py
```

By default the app listens on **127.0.0.1** port **5050**. Override with environment variables:

| Variable       | Default   | Description        |
|----------------|-----------|--------------------|
| `VISION_HOST`  | `127.0.0.1` | Bind address     |
| `VISION_PORT`  | `5050`    | Port               |
| `FLASK_DEBUG`  | `1`       | Set to `0` to disable Flask debug mode |
| `VISION_CAMERA_INDEX` | `0` | OpenCV camera index (see Webcam section) |
| `VISION_BOARD_DEBUG_DIR` | *(empty)* | If set, edge-based `find_board_corners` writes `overlay.png` there (contours + chosen quad). |
| `VISION_BOARD_CALIBRATION_FILE` | `CV/board_calibration.json` | Single global board quad (full-frame corners + frame size). |

Example:

```bash
VISION_HOST=0.0.0.0 VISION_PORT=5050 FLASK_DEBUG=0 python app.py
```

## Webcam on macOS (and Linux)

OpenCV does not use a device path like `/dev/video0` in your code on macOS. It opens cameras by **integer index**. Order is **not fixed** (built-in vs USB can swap). The backend on macOS is typically **AVFoundation**.

**macOS:** After unplugging a USB camera, the built-in camera may stay at **index 1** while **index 0** is empty. Probing **index 0** can then take **several seconds** before failing.

Use a working index when running your app or scripts:

```bash
export VISION_CAMERA_INDEX=1
```

**macOS privacy:** The process that runs Python needs camera permission (Terminal, iTerm2, **Cursor**, or **VS Code** if you run from the integrated terminal). Open **System Settings → Privacy & Security → Camera** and enable the app you use. If OpenCV prints “camera access has been denied,” grant access or run from a terminal app that is allowed.

**Programmatic access** in code:

```python
from vision import WebcamCapture

with WebcamCapture() as cam:  # uses VISION_CAMERA_INDEX, default 0
    ok, frame = cam.read()
```

## Check health

```bash
curl -s http://127.0.0.1:5050/health
```

Expected JSON: `{"status":"ok"}`

## Camera HTTP API (dev / test)

- **`GET /api/cameras`** — Runs `probe_cameras()`: one OpenCV index per device from `enumerate_cameras()`, keeping index and name aligned. JSON **`cameras`**: those that open and return a frame. If devices change while the process is running, restart the app so enumeration refreshes.

- **`GET /api/cameras/<index>`** — One **JPEG** frame from that index. Query: **`warmup`** (default `0`), **`quality`** (default `85`). Reopens the camera each request.

- **`GET /api/cameras/<index>/board`** — Warped **JPEG** using **saved calibration** only (no live edge detection). Query: **`warmup`**, **`quality`**, **`size`**. Returns **422** if calibration is missing or frame size does not match (recalibrate after resolution change).

- **`GET /api/cameras/<index>/board/calibration`** — Same JSON as a successful **POST** and the on-disk file: `ok`, and when calibrated `frame_width`, `frame_height`, `corners` (4×2). Returns `{"ok": false}` when none or invalid file. No capture. Calibration is global; the path index is not persisted.

- **`POST /api/cameras/<index>/board/calibration`** — Capture one frame from that index, run edge detection, **replace** stored calibration with one quad. OpenCV index is only used to open the device; it is not persisted. Returns **422** if no quad found.

- **`DELETE /api/cameras/<index>/board/calibration`** — Clear saved calibration (same global state for any index).

- **`GET /api/cameras/<index>/board-aruco`** — Dev endpoint (ArUco path); returns a JPEG (see `board_aruco`).

Examples:

```bash
curl -s http://127.0.0.1:5050/api/cameras | python3 -m json.tool
curl -s -o /tmp/cam0.jpg "http://127.0.0.1:5050/api/cameras/0"
curl -s http://127.0.0.1:5050/api/cameras/0/board/calibration | python3 -m json.tool
curl -s -X POST "http://127.0.0.1:5050/api/cameras/0/board/calibration"
curl -s -o /tmp/board.jpg "http://127.0.0.1:5050/api/cameras/0/board?size=800"
```

## API stubs (to be implemented)

- `POST /api/reset` — reseed baseline / flags before a game
- `POST /api/listening/start` — begin the window where moves are expected
- `POST /api/listening/stop` — end that window

The virtual environment directory `.venv/` is gitignored; create it on each machine using the steps above.
