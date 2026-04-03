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
| `VISION_BOARD_DEBUG_DIR` | *(empty)* | If set, `GET .../frame/board/debug` writes PNG artifacts under this directory and lists them in `saved_files`. |

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

- **`GET /api/cameras/<index>/frame`** — One **JPEG** frame from that index. Query: **`warmup`** (default `0`), **`quality`** (default `85`). Reopens the camera each request.

- **`GET /api/cameras/<index>/frame/board`** — Same capture, then **detect the largest quadrilateral** (assumed board outline), **perspective-warp** to a square. Query: **`warmup`**, **`quality`**, **`size`** (output side in pixels, default **800**, max **4096**). Returns **422** if no quad is found. Works best with a **clear board edge** vs background; tune later via `vision.board.find_board_corners` parameters in code.

- **`GET /api/cameras/<index>/frame/board/debug`** — Same frame; **JSON** with detection stats (`reason`, contour counts, quad areas, etc.). If **`VISION_BOARD_DEBUG_DIR`** is set (e.g. `/tmp/board-debug`), writes numbered PNGs per step: **`01_small_bgr`** … **`06_overlay`** (see `save_board_debug_images` in `vision/board.py`) and lists paths in **`saved_files`**. No image data in the response body.

Examples:

```bash
curl -s http://127.0.0.1:5050/api/cameras | python3 -m json.tool
curl -s -o /tmp/cam0.jpg "http://127.0.0.1:5050/api/cameras/0/frame"
curl -s -o /tmp/board.jpg "http://127.0.0.1:5050/api/cameras/0/frame/board?size=800"
VISION_BOARD_DEBUG_DIR=/tmp/board-debug curl -s "http://127.0.0.1:5050/api/cameras/0/frame/board/debug" | python3 -m json.tool
```

## API stubs (to be implemented)

- `POST /api/reset` — reseed baseline / flags before a game
- `POST /api/listening/start` — begin the window where moves are expected
- `POST /api/listening/stop` — end that window

The virtual environment directory `.venv/` is gitignored; create it on each machine using the steps above.
