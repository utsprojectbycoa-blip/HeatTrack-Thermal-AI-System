#!/usr/bin/env python3
"""
HeatTrack logger + bridge (laptop now, mini PC later)
=====================================================

  Arduino Uno (USB)     -> runs duck_sensor_bridge.ino: relays the MLX90640 thermal
                           camera and reads the DHT22 (newest values kept in memory;
                           readings can also be saved to public.environment)
  Thermal camera        -> every new thermal frame, each duck YOLO sees is measured
                           (duck_temperature.py); readings are pooled per 10 minutes
  Every 10 minutes      -> the highest temperature/humidity reading of the slot is kept
  Every 10 minutes      -> one public.analytics row (interval_minutes = 10) for that slot
  Every 30 minutes      -> one public.analytics row (interval_minutes = 30) with the HIGHEST
                           body temperature of the window; the highest air temperature (with
                           the humidity measured at that moment) goes into heatstress_model_2.pkl,
                           which predicts the SEVERITY
                           with the PEAK duck count and the window's body temperatures.
                           No ducks (or no valid thermal reading) in a window -> no row.
  Webcam                -> continuous live video (MJPEG) at http://localhost:8000/video
  YOLO model            -> finds ducks in the video, draws boxes + count on the stream
  Cloudflare tunnel     -> public https address for that video, saved to devices.device_url
                           so the HeatTrack website finds it automatically

Keep thermal_bridge.py and duck_temperature.py in the same folder as this file,
and flash duck_sensor_bridge.ino onto the Uno (it replaces the old DHT22 sketch).

Install once:
    pip install pyserial opencv-python requests ultralytics joblib scikit-learn pandas numpy
               adafruit-circuitpython-mlx90640
    winget install --id Cloudflare.cloudflared
    (or run install_heattrack.ps1 once: it installs cloudflared and starts the
     logger automatically after every boot)

Run:
    python heatstress_logger.py                  (Ctrl + C to stop)
                                                 finds its owner from DEVICE_CODE in the
                                                 devices table; waits if not claimed yet

Useful options:
    python heatstress_logger.py --inspect        show what the severity model expects/returns
    python heatstress_logger.py --simulate --dry-run --no-camera --interval 2
                                                 fast test: fake sensors + fake ducks, nothing saved
    python heatstress_logger.py --no-camera      sensor + analytics only
"""

import argparse
import csv
import json
import os
import random
import re
import subprocess
import sys
import threading
import time
from collections import Counter, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests

from duck_temperature import MeasureSettings, measure_ducks, webcam_box_to_thermal


def load_env_file(path):
    """Reads KEY=VALUE lines from .env into the environment (no extra package
    needed). Real environment variables win over the file."""
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return False
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)
    return True


ENV_FILE = Path(__file__).with_name(".env")
ENV_LOADED = load_env_file(ENV_FILE)

# ---------------- settings: come from .env ----------------
SUPABASE_URL = os.environ.get("HEATTRACK_SUPABASE_URL", "https://yrcsrbejeubfswvrezzd.supabase.co").rstrip("/")
# Secret key: keep ONLY on this computer (in .env, never in the website)
SUPABASE_SECRET_KEY = (os.environ.get("HEATTRACK_SUPABASE_SECRET_KEY")
                       or os.environ.get("SUPABASE_SECRET_KEY")
                       or "PASTE_YOUR_SECRET_KEY_HERE")
# This mini PC's Device ID: the same one the user types when signing up on the website
DEVICE_CODE = (os.environ.get("HEATTRACK_DEVICE_ID")
               or os.environ.get("HEATTRACK_DEVICE_CODE") or "HT-PDCK-001").strip()
# Files the logger writes while running live in their own folder, NOT next to the
# website: a live-reloading web server (e.g. VS Code Live Server) reloads the page
# whenever a file in the website folder changes, which looks like a sign-out.
DATA_DIR = Path(os.environ.get("HEATTRACK_DATA_DIR") or (Path.home() / "HeatTrack data"))
DEVICE_FILE = DATA_DIR / "device.json"     # cached owner (for offline starts)
BATCH_COUNT = None                                 # optional environment.batch_count

SERIAL_PORT = os.environ.get("HEATTRACK_SERIAL_PORT", "COM7")
SERIAL_BAUD = 500000        # must match BAUD in duck_sensor_bridge.ino
DHT_READ_EVERY_SEC = 2      # the DHT22 can't update faster than every 2 s
# Readings outside the DHT22's real range are rejected (never saved or used)
DHT_TEMP_RANGE = (-40.0, 80.0)     # °C, DHT22 / AM2302 datasheet
DHT_HUM_RANGE = (0.0, 99.9)        # % RH; a steady 100.0 means the sensor is saturated
CAMERA_INDEX = int(os.environ.get("HEATTRACK_CAMERA_INDEX", "1"))  # 0 = built-in, 1 = usually USB webcam

STREAM_PORT = 8000
STREAM_FPS = 12             # frames per second sent to viewers
FRAME_WIDTH, FRAME_HEIGHT = 640, 360
JPEG_QUALITY = 60


# Duck detection (YOLO)
MODEL_PATH = "weights.pt"      # your trained model, in the same folder as this file
DETECT_CONF = 0.75           # ignore detections below this confidence
DETECT_FPS = 4              # how often the model runs (the video stays at STREAM_FPS)
DETECT_IMGSZ = 640          # use the image size you trained with
# Only keep these class names (None = keep every class the model knows).
# Your duck model: e.g. ["duck"].  Default YOLO model as a stand-in: ["bird"].
DETECT_CLASSES = None

# Keep boxes steady (less flicker)
HOLD_SECONDS = 1.5          # keep a duck's box this long after the model last saw it
MIN_HITS = 2                # a new box must be seen this many times before it shows
                            # (1 = show immediately; 2 hides one-off false detections)
MATCH_IOU = 0.3             # how much boxes must overlap to count as the same duck
SMOOTHING = 0.5             # 0 = box jumps to new position, 0.9 = moves very smoothly

# Heat-stress severity (sklearn model)
SEVERITY_MODEL_PATH = "heatstress_model_2.pkl"
SLOT_ROW_MINUTES = 10
SAMPLE_INTERVAL_SEC = SLOT_ROW_MINUTES * 60   # one analytics row per 10-minute slot
SAMPLES_PER_WINDOW = 3          # 3 x 10 min = 30-minute window
MAX_READING_AGE_SEC = 120       # a sample older than this counts as "sensor not responding"

# What goes into public.environment (the dashboard's temperature/humidity chart):
#   "every_reading" = every line the Arduino sends (live chart, like bridge.py did)
#   "every_sample"  = only the 10-minute samples
#   "off"           = nothing
ENVIRONMENT_LOG = "every_reading"
ENVIRONMENT_EVERY_SEC = 10      # with "every_reading": save at most one row this often

# Thermal camera (MLX90640 through the Uno)
THERMAL_EMISSIVITY = 0.98       # bare skin
THERMAL_FLIP_H = False          # set so the thermal image faces the same way as the webcam
THERMAL_FLIP_V = False
# Camera refresh in sub-pages per second; the image updates this often.
# 8 is the most the Uno link handles well; 4 = less sensor noise, 16 = Uno can't keep up.
THERMAL_REFRESH_HZ = float(os.environ.get("HEATTRACK_THERMAL_HZ", "8"))
THERMAL_LOG_SEC = 10            # print a live thermal summary in the console this often (0 = off)
THERMAL_VIEW_SCALE = 20         # /thermal heat-map size: 32x24 pixels x this
# 3x3 webcam->thermal mapping from the alignment calibration (numpy .npy file).
# Until it exists, the webcam frame is simply scaled onto the 32x24 thermal grid,
# which is only right if both cameras are mounted together and see the same area.
ALIGNMENT_FILE = Path(__file__).with_name("thermal_alignment.npy")
CONFIRM_SECONDS = 1.5           # a high temperature / peak count must hold this long to count
# True: a duck seen only briefly (under CONFIRM_SECONDS) still counts, so its
# 10/30-minute period is saved. False: only ducks held for CONFIRM_SECONDS count.
ALLOW_BRIEF_DETECTIONS = True
MEASURE = MeasureSettings(core_offset_c=0.0)   # skin->core correction: fit from your data
SLOT_LOG_FILE = DATA_DIR / "slot_log.csv"   # 10-minute summaries (local)

PENDING_FILE = DATA_DIR / "pending_rows.jsonl"  # rows waiting to be saved (offline / refused)
PROGRESS_FILE = DATA_DIR / "interval_state.json"  # 10/30-minute progress, survives restarts
PROGRESS_EVERY_SEC = 60                           # how often progress is saved


def prepare_data_dir():
    """Create the data folder and move files left next to the script by older
    versions (queued rows included, so nothing is lost)."""
    import shutil
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name in ("device.json", "slot_log.csv", "pending_rows.jsonl"):
        old, new = Path(__file__).with_name(name), DATA_DIR / name
        if not old.exists():
            continue
        try:
            if new.exists() and name != "device.json":
                with new.open("a", encoding="utf-8") as dst:   # keep both histories
                    dst.write(old.read_text(encoding="utf-8"))
                old.unlink()
            elif new.exists():
                old.unlink()
            else:
                shutil.move(str(old), str(new))
        except OSError as e:
            print(f"Could not move {name} into {DATA_DIR}: {e}")
# ------------------------------------------------------

# If your severity model outputs numbers, this is how they map to severity.
# Run --inspect to see the model's classes and adjust if the order differs.
NUMERIC_SEVERITY = {0: "LOW", 1: "MODERATE", 2: "HIGH", 3: "CRITICAL"}

# If it outputs words, they are translated to what the dashboard expects
# (CRITICAL / HIGH / MODERATE / LOW).
TEXT_SEVERITY = {
    "LOW": "LOW", "NORMAL": "LOW", "NONE": "LOW", "NO STRESS": "LOW", "SAFE": "LOW",
    "MODERATE": "MODERATE", "MILD": "MODERATE", "CAUTION": "MODERATE", "ALERT": "MODERATE",
    "HIGH": "HIGH", "SEVERE": "HIGH", "DANGER": "HIGH", "WARNING": "HIGH",
    "CRITICAL": "CRITICAL", "EXTREME": "CRITICAL", "EMERGENCY": "CRITICAL", "VERY SEVERE": "CRITICAL",
}

# Severity -> the `status` column the dashboard reads (HEAT STRESS / MILD / NORMAL)
STATUS_FROM_SEVERITY = {
    "CRITICAL": "HEAT STRESS",
    "HIGH": "HEAT STRESS",
    "MODERATE": "MILD",
    "LOW": "NORMAL",
}

HEADERS = {"apikey": SUPABASE_SECRET_KEY}
if not SUPABASE_SECRET_KEY.startswith("sb_"):
    HEADERS["Authorization"] = f"Bearer {SUPABASE_SECRET_KEY}"

DRY_RUN = False   # set from --dry-run
USER_ID = None    # filled in by resolve_identity() at startup
DEVICE_ID = None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


# ======================= Supabase =======================

def insert_row(table, row):
    if DRY_RUN:
        log(f"DRY RUN -> {table}: {json.dumps(row)}")
        return
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=row,
        timeout=10,
    )
    if r.status_code >= 400:
        print(f"Supabase said: {r.text}")
        if '"23514"' in r.text or "check constraint" in r.text:
            rule = re.search(r'constraint \\?"([a-z_]+)', r.text)
            log(f"A rule on the {table} table ({rule.group(1) if rule else 'check constraint'}) refuses "
                f"this row. Run fix_analytics_checks.sql in the Supabase SQL Editor; refused rows "
                f"are kept and sent again afterwards.")
        if "record_key" in r.text and "column" in r.text:
            log("The analytics table has no record_key column yet: run analytics_batch_numbers.sql "
                "in the Supabase SQL Editor. Rows are kept and sent again afterwards.")
        if "interval_minutes" in r.text:
            log("The analytics table has no interval_minutes column yet: run analytics_interval.sql "
                "in the Supabase SQL Editor. Rows are kept in pending_rows.jsonl until then.")
    r.raise_for_status()


def insert_reading(temp, hum):
    if not OWNER_ACTIVE:
        return
    row = {"userid": USER_ID, "device_id": DEVICE_ID, "timestamp": now_iso(),
           "temperature": temp, "humidity": hum}
    if BATCH_COUNT is not None:
        row["batch_count"] = BATCH_COUNT
    insert_row("environment", row)


def flush_pending():
    """Send analytics rows that were saved while the internet was down."""
    if not PENDING_FILE.exists():
        return
    lines = [l for l in PENDING_FILE.read_text().splitlines() if l.strip()]
    for i, line in enumerate(lines):
        item = json.loads(line)
        try:
            insert_row(item["table"], item["row"])
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 409:
                continue      # already saved earlier (same record_key): drop the copy
            PENDING_FILE.write_text("\n".join(lines[i:]) + "\n")
            return
        except requests.RequestException:
            PENDING_FILE.write_text("\n".join(lines[i:]) + "\n")
            return
    PENDING_FILE.unlink()
    if lines:
        log(f"Sent {len(lines)} queued row(s)")


def insert_or_queue(table, row):
    try:
        flush_pending()
        insert_row(table, row)
        return True
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else "?"
        log(f"Supabase refused the {table} row (HTTP {code}); kept in {PENDING_FILE} "
            f"and it will be sent again automatically once the problem is fixed")
        with PENDING_FILE.open("a") as f:
            f.write(json.dumps({"table": table, "row": row}) + "\n")
        return False
    except requests.RequestException as e:
        log(f"Could not reach Supabase ({e}); saved the {table} row for later")
        with PENDING_FILE.open("a") as f:
            f.write(json.dumps({"table": table, "row": row}) + "\n")
        return False


def publish_stream_url(url):
    """Save the live video address on this device's row in public.devices
    (device_url + url_updated_at). None = offline."""
    if DRY_RUN:
        log(f"DRY RUN -> devices.device_url: {url}")
        return
    try:
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/devices",
            headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
            params={"device_code": f"eq.{DEVICE_CODE}"},
            json={"device_url": url, "url_updated_at": now_iso()},
            timeout=10,
        )
        if r.status_code >= 400:
            print(f"Could not save the stream address: {r.text}")
    except requests.RequestException as e:
        print(f"Could not save the stream address: {e}")


# ======================= Identity =======================
# The mini PC knows only its own DEVICE_CODE (e.g. HT-PDCK-001). At startup
# it looks that code up in public.devices:
#   devices.id       -> DEVICE_ID (written to environment.device_id)
#   devices.owner_id -> USER_ID   (set when a user signs up with this device)
# Nothing to log in to, nothing that expires. If no one owns the device yet,
# the logger waits (24/7) and starts the moment a user signs up with it.
# device.json caches the answer so the logger can also start offline.

PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000"
OWNER_POLL_SEC = 5              # how often to check while the device is unclaimed
OWNER_REMIND_SEC = 10 * 60      # repeat the "waiting" message this often

OWNER_ACTIVE = True     # False while no account owns this device: no rows are written
_waiting = threading.Lock()


def load_identity():
    try:
        data = json.loads(DEVICE_FILE.read_text())
        if data.get("user_id") and data.get("device_id") and data.get("device_code") == DEVICE_CODE:
            return data
    except (OSError, ValueError):
        pass
    return None


def save_identity(data):
    tmp = DEVICE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, DEVICE_FILE)      # never leaves a half-written file


def set_identity(data):
    global USER_ID, DEVICE_ID
    USER_ID, DEVICE_ID = data["user_id"], data["device_id"]


def fetch_device():
    """This device's row from public.devices, or None if the code isn't registered.
    Raises requests.RequestException when Supabase can't be reached."""
    r = requests.get(f"{SUPABASE_URL}/rest/v1/devices", headers=HEADERS,
                     params={"select": "id,owner_id,device_name", "device_code": f"eq.{DEVICE_CODE}"},
                     timeout=10)
    if r.status_code >= 400:
        print(f"Supabase said: {r.text}")
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None


def _identity_from_row(row):
    data = {"device_code": DEVICE_CODE, "device_id": row["id"], "user_id": row["owner_id"],
            "device_name": row.get("device_name") or ""}
    saved = load_identity() or {}
    if any(saved.get(k) != v for k, v in data.items()):   # rewrite only on a change
        save_identity({**data, "checked_at": now_iso()})
    return data


def wait_for_owner():
    """Block until this device has an owner; returns the identity."""
    with _waiting:
        next_note = 0.0
        while True:
            try:
                row = fetch_device()
            except requests.RequestException as e:
                log(f"Can't reach Supabase ({e}); retrying in 10 s")
                time.sleep(10)
                continue
            if row is None:
                if time.monotonic() >= next_note:
                    log(f"Device {DEVICE_CODE} is not in the devices table. Check DEVICE_CODE "
                        f"in the settings; checking again every {OWNER_POLL_SEC} s")
                    next_note = time.monotonic() + OWNER_REMIND_SEC
            elif row.get("owner_id"):
                data = _identity_from_row(row)
                log(f"Device {DEVICE_CODE} belongs to account {data['user_id']}; logging for it")
                return data
            elif time.monotonic() >= next_note:
                log(f"Device {DEVICE_CODE} has no owner yet. It will start automatically as soon as "
                    f"someone signs up on the HeatTrack website with this Device ID.")
                next_note = time.monotonic() + OWNER_REMIND_SEC
            time.sleep(OWNER_POLL_SEC)


def resolve_identity():
    """Run before anything else starts. Waits for an owner rather than log without one."""
    if not DEVICE_CODE or DEVICE_CODE.startswith("HT-PDCK-XXX"):
        sys.exit("Set DEVICE_CODE in the settings (e.g. HT-PDCK-001) first.")
    try:
        row = fetch_device()
    except requests.RequestException as e:
        cached = load_identity()
        if cached:
            log(f"Offline ({e}); using the saved owner of {DEVICE_CODE}")
            set_identity(cached)
            return
        log(f"Offline ({e}) and no saved owner yet")
        row = None
    if row and row.get("owner_id"):
        data = _identity_from_row(row)
        log(f"Device {DEVICE_CODE} ({data['device_name'] or data['device_id']}) "
            f"belongs to account {data['user_id']}")
        set_identity(data)
        return
    set_identity(wait_for_owner())


def _wait_in_background():
    def work():
        global OWNER_ACTIVE
        set_identity(wait_for_owner())
        OWNER_ACTIVE = True
        log("Logging resumed")
    if not _waiting.locked():
        threading.Thread(target=work, daemon=True).start()


def recheck_owner():
    """Every 30-minute window: re-read the owner from public.devices.
    Follows a change of owner; stops writing if the device was released.
    Returns True if rows may be written."""
    global OWNER_ACTIVE
    if DRY_RUN or not OWNER_ACTIVE:
        return OWNER_ACTIVE
    try:
        row = fetch_device()
    except requests.RequestException:
        return True                  # offline: keep going, rows are queued
    if row and row.get("owner_id"):
        if row["owner_id"] != USER_ID or row["id"] != DEVICE_ID:
            log(f"Device {DEVICE_CODE} now belongs to account {row['owner_id']}; switching")
        set_identity(_identity_from_row(row))
        return True
    log(f"Device {DEVICE_CODE} no longer has an owner; no rows will be written until it is claimed again")
    OWNER_ACTIVE = False
    _wait_in_background()
    return False


# ======================== Camera ========================

class Camera:
    """Reads the webcam non-stop and keeps the newest JPEG for all viewers."""

    def __init__(self):
        import cv2
        self.cv2 = cv2
        self.cond = threading.Condition()
        self.jpeg = None
        self.frame_id = 0
        self.fps = None           # measured frames per second sent to viewers
        self._last_at = 0.0
        self.running = True
        self.raw_lock = threading.Lock()
        self.raw = None           # newest unmodified frame (for the detector)
        self.detector = None      # set in main() if the model loads
        self.connected = False    # webcam opened (False = not plugged in / not found)
        self._session_at = 0.0    # when the webcam was (re)found; frames are expected after this
        threading.Thread(target=self._loop, daemon=True).start()

    def status(self):
        """For the website: 'absent' (no webcam), 'connecting' (found, first
        frames on the way), 'streaming', or 'problem' (found but no frames)."""
        now = time.time()
        if self._last_at and now - self._last_at < 5:
            return "streaming"
        if not self.connected:
            return "absent"
        if self._last_at and self._last_at >= self._session_at:
            return "problem"          # was sending, then stopped
        return "connecting" if now - self._session_at < 10 else "problem"

    def latest_raw(self):
        with self.raw_lock:
            return None if self.raw is None else self.raw.copy()

    def _open(self):
        cv2 = self.cv2
        backend = cv2.CAP_DSHOW if os.name == "nt" else cv2.CAP_ANY
        cam = cv2.VideoCapture(CAMERA_INDEX, backend)
        cam.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
        cam.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
        cam.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if cam.isOpened():
            print(f"Webcam {CAMERA_INDEX} opened")
            if not self.connected:        # newly found (a re-open after read errors keeps the old time)
                self._session_at = time.time()
            self.connected = True
        else:
            print(f"Webcam {CAMERA_INDEX} not found. Retrying...")
            self.connected = False
        return cam

    def _loop(self):
        cv2 = self.cv2
        cam = self._open()
        interval = 1.0 / STREAM_FPS
        next_frame = 0.0
        fails = 0
        while self.running:
            ok, frame = cam.read() if cam.isOpened() else (False, None)
            if not ok:
                fails += 1
                time.sleep(0.1)
                if fails >= 30:           # ~3 s without frames: reopen the camera
                    cam.release()
                    time.sleep(1)
                    cam = self._open()
                    fails = 0
                continue
            fails = 0

            # Read every frame (keeps it current), but only encode STREAM_FPS per second
            now = time.time()
            if now < next_frame:
                continue
            next_frame = now + interval

            with self.raw_lock:
                self.raw = frame
            if self.detector:
                frame = self.detector.draw(frame.copy())

            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            if ok:
                t_now = time.time()
                if self._last_at:
                    rate = 1.0 / max(t_now - self._last_at, 1e-3)
                    self.fps = rate if self.fps is None else 0.8 * self.fps + 0.2 * rate
                self._last_at = t_now
                with self.cond:
                    self.jpeg = buf.tobytes()
                    self.frame_id += 1
                    self.cond.notify_all()
        cam.release()

    def wait_frame(self, last_id, timeout=5):
        with self.cond:
            self.cond.wait_for(lambda: self.frame_id != last_id, timeout=timeout)
            return self.jpeg, self.frame_id


# ====================== Detection =======================

class Detector:
    """Runs the YOLO model on the newest frame in the background."""

    # Box colors (BGR) follow each duck's status, same colors and thresholds as the
    # website (LIVE_TEMP_LEVELS in script.js): above 34 C = Mild, above 37 C = Heat Stress
    STATUS_COLORS = {"normal": (128, 222, 74), "mild": (36, 191, 251), "stress": (113, 113, 248)}
    NO_READING_COLOR = (160, 160, 160)   # grey: no body temperature for this duck
    MILD_C, STRESS_C = 34.0, 37.0

    def __init__(self, cam):
        from ultralytics import YOLO   # imported here so streaming works even if missing
        import cv2
        self.cv2 = cv2
        self.model = YOLO(MODEL_PATH)
        self.names = self.model.names  # class id -> name, from your training
        self.cam = cam
        self.lock = threading.Lock()
        self.tracks = []               # ducks being followed between detections
        print(f"Model loaded: {MODEL_PATH}  classes: {list(self.names.values())}")
        print(f"Detection settings: DETECT_CONF={DETECT_CONF}  DETECT_FPS={DETECT_FPS}  "
              f"DETECT_CLASSES={DETECT_CLASSES}  HOLD_SECONDS={HOLD_SECONDS}  MIN_HITS={MIN_HITS}")
        if len(self.names) == 80 and "person" in self.names.values():
            print("NOTE: this is the default YOLO model (80 everyday objects), not a duck-trained model.")
        if DETECT_CLASSES:
            missing = [c for c in DETECT_CLASSES if c not in self.names.values()]
            if missing:
                print(f"WARNING: DETECT_CLASSES has names this model doesn't know: {missing}")
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        interval = 1.0 / DETECT_FPS
        while True:
            start = time.time()
            frame = self.cam.latest_raw()
            if frame is None:
                time.sleep(0.2)
                continue
            try:
                result = self.model.predict(frame, conf=DETECT_CONF, imgsz=DETECT_IMGSZ, verbose=False)[0]
                boxes = []
                for b in result.boxes:
                    x1, y1, x2, y2 = (int(v) for v in b.xyxy[0].tolist())
                    cls = int(b.cls[0])
                    name = self.names.get(cls, str(cls))
                    conf = float(b.conf[0])
                    if conf < DETECT_CONF:
                        continue   # double-check the confidence threshold
                    if DETECT_CLASSES and name not in DETECT_CLASSES:
                        continue   # e.g. ignore "person"
                    boxes.append((x1, y1, x2, y2, name, conf))
                with self.lock:
                    self._update_tracks(boxes, time.time())
            except Exception as e:
                print(f"Detection error: {e}")
                time.sleep(1)
            time.sleep(max(0, interval - (time.time() - start)))

    @staticmethod
    def _iou(a, b):
        ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
        ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
        inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        if inter == 0:
            return 0.0
        area_a = (a[2] - a[0]) * (a[3] - a[1])
        area_b = (b[2] - b[0]) * (b[3] - b[1])
        return inter / float(area_a + area_b - inter)

    def _update_tracks(self, boxes, now):
        """Match new detections to existing ducks so boxes don't blink out."""
        unmatched = list(range(len(self.tracks)))
        for x1, y1, x2, y2, name, conf in boxes:
            best, best_iou = None, MATCH_IOU
            for i in unmatched:
                t = self.tracks[i]
                if t["name"] != name:
                    continue
                iou = self._iou(t["box"], (x1, y1, x2, y2))
                if iou >= best_iou:
                    best, best_iou = i, iou
            if best is None:
                self.tracks.append({"box": (x1, y1, x2, y2), "name": name, "conf": conf,
                                    "last_seen": now, "hits": 1})
            else:
                t = self.tracks[best]
                a = SMOOTHING
                t["box"] = tuple(int(a * o + (1 - a) * n) for o, n in zip(t["box"], (x1, y1, x2, y2)))
                t["conf"], t["last_seen"] = conf, now
                t["hits"] += 1
                unmatched.remove(best)
        # Forget ducks not seen for HOLD_SECONDS
        self.tracks = [t for t in self.tracks if now - t["last_seen"] <= HOLD_SECONDS]

    def current(self):
        now = time.time()
        with self.lock:
            return [(*t["box"], t["name"], t["conf"]) for t in self.tracks
                    if t["hits"] >= MIN_HITS and now - t["last_seen"] <= HOLD_SECONDS]

    def draw(self, frame):
        cv2 = self.cv2
        boxes = self.current()
        for x1, y1, x2, y2, name, conf in boxes:
            reading = collector.reading_for((x1, y1, x2, y2)) if collector else None
            if reading is not None and reading.valid:
                t = reading.estimated_body_c
                status = "stress" if t > self.STRESS_C else "mild" if t > self.MILD_C else "normal"
                color = self.STATUS_COLORS[status]
            else:
                color = self.NO_READING_COLOR
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            label = f"{name} {conf:.2f}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            ty = max(y1, th + 6)
            cv2.rectangle(frame, (x1, ty - th - 6), (x1 + tw + 6, ty), color, -1)
            cv2.putText(frame, label, (x1 + 3, ty - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

            # Body temperature from the thermal camera, inside the box's bottom-left
            # (tag in the box's own color, white text; grey tag when there is no reading)
            if reading is not None:
                if reading.valid:
                    temp_text, bg = f"{reading.estimated_body_c:.1f} C", color
                else:
                    temp_text, bg = SHORT_REASON.get(reading.reason.split(" (")[0], "no reading"), (90, 90, 90)
                (tw2, th2), _ = cv2.getTextSize(temp_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                by = max(y2 - 4, th2 + 8)
                cv2.rectangle(frame, (x1 + 2, by - th2 - 6), (x1 + tw2 + 10, by + 2), bg, -1)
                cv2.putText(frame, temp_text, (x1 + 6, by - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                            (255, 255, 255), 1, cv2.LINE_AA)

        return frame


SHORT_REASON = {
    "touches frame edge": "at edge",
    "too small in thermal image": "too far",
    "overlaps another duck": "overlap",
    "no valid pixels": "no reading",
}


def render_thermal_jpeg(cv2, vmin=None, vmax=None, hud=True):
    """Heat map of the newest thermal frame with the duck boxes and temperatures.
    vmin/vmax fix the color scale (e.g. 25-45 C to match the website's legend);
    otherwise it stretches from the coldest to the hottest spot. hud=False
    leaves out the min/max text bar (the website shows its own)."""
    frame, results, age = collector.snapshot() if collector else (None, [], None)
    s = THERMAL_VIEW_SCALE
    if frame is None:
        img = np.zeros((24 * s, 32 * s, 3), np.uint8)
        cv2.putText(img, "Waiting for the thermal camera...", (20, 12 * s),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
    else:
        lo, hi = float(frame.min()), float(frame.max())
        c_lo = vmin if vmin is not None else lo
        c_hi = vmax if vmax is not None else hi
        norm = ((frame - c_lo) / max(c_hi - c_lo, 0.5) * 255).clip(0, 255).astype(np.uint8)
        img = cv2.applyColorMap(cv2.resize(norm, (32 * s, 24 * s), interpolation=cv2.INTER_CUBIC),
                                cv2.COLORMAP_INFERNO)
        info = f"min {lo:.1f} C   max {hi:.1f} C"
        if age is not None and age > 5:
            info += f"   (no new frame for {age:.0f} s)"
        if hud:
            cv2.rectangle(img, (0, 0), (32 * s, 30), (0, 0, 0), -1)
            cv2.putText(img, info, (10, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        for _, r in results:
            if r.thermal_box is None:
                continue
            x1, y1, x2, y2 = (int(round(v * s)) for v in r.thermal_box)
            color = (255, 255, 255) if r.valid else (160, 160, 160)   # white box + text; grey = no reading
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
            text = (f"{r.estimated_body_c:.1f} C" if r.valid
                    else SHORT_REASON.get(r.reason.split(" (")[0], "no reading"))
            top = 50 if hud else 22
            cv2.putText(img, text, (x1 + 4, y1 - 6 if y1 > top else y1 + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        color, 2, cv2.LINE_AA)
            if r.valid and r.hottest_pixel:
                py, px = r.hottest_pixel
                cv2.drawMarker(img, (px * s + s // 2, py * s + s // 2), (255, 255, 255),
                               cv2.MARKER_CROSS, 14, 2)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return buf.tobytes() if ok else None


def start_detector(cam):
    if not os.path.exists(MODEL_PATH):
        print(f"Model file '{MODEL_PATH}' not found. Streaming without detection.")
        return None
    try:
        return Detector(cam)
    except ImportError:
        print("ultralytics is not installed. Run:  pip install ultralytics")
    except Exception as e:
        print(f"Could not load the model: {e}")
    return None


camera = None


class StreamHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/video":
            self._stream()
        elif path == "/stats":
            self._stats()
        elif path == "/thermal":
            self._thermal_stream(self.path)
        elif path == "/":
            self._text(200, "HeatTrack stream is running. Video: /video   Thermal view: /thermal")
        else:
            self._text(404, "Not found")

    def do_OPTIONS(self):
        # Browser pre-check before the website reads /stats
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _stats(self):
        """Live detection numbers for the website's HUD."""
        det = camera.detector if camera else None
        boxes = det.current() if det else []
        classes = {}
        for *_, name, _conf in boxes:
            classes[name] = classes.get(name, 0) + 1
        rgb_status = camera.status() if camera else "absent"
        sensor = collector.sensor if collector else None
        if sensor is None:
            thermal_status = "connecting"
        elif hasattr(sensor, "camera_status"):
            thermal_status = sensor.camera_status()
        else:                          # --simulate
            thermal_status = "streaming" if collector.last_time and time.time() - collector.last_time < 10 else "connecting"
        body = json.dumps({
            "model_loaded": det is not None,
            "ducks": len(boxes),
            "classes": classes,
            "thermal": collector.live() if collector else None,
            "video_fps": round(camera.fps, 1) if rgb_status == "streaming" and camera.fps else None,
            # absent | connecting | streaming | problem: the website shows
            # "Camera not connected" / "Connecting to camera..." / the picture /
            # "Camera not responding..." from these
            "cameras": {"rgb": rgb_status, "thermal": thermal_status},
            "time": time.time(),
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _text(self, code, msg):
        body = msg.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.end_headers()
        last = None
        try:
            while True:
                jpeg, fid = camera.wait_frame(last)
                if jpeg is None or fid == last:
                    continue
                last = fid
                self.wfile.write(
                    b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                    + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n"
                )
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass  # viewer closed the page

    def _thermal_stream(self, full_path="/thermal"):
        """/thermal                    auto color scale, with min/max text bar
           /thermal?min=25&max=45&hud=0  fixed scale for the website's legend, no bar"""
        try:
            import cv2
        except ImportError:
            self._text(500, "opencv-python is needed for /thermal")
            return
        from urllib.parse import parse_qs, urlparse
        q = parse_qs(urlparse(full_path).query)

        def num(key):
            try:
                return float(q[key][0])
            except (KeyError, ValueError, IndexError):
                return None
        vmin, vmax, hud = num("min"), num("max"), q.get("hud", ["1"])[0] != "0"
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        try:
            sent_for, sent_at = None, 0.0
            while True:
                # Send each new thermal image as soon as it exists (and a refresh
                # every 2 s while waiting, so the "waiting" picture stays alive)
                measured = collector.last_time if collector else None
                if measured != sent_for or time.time() - sent_at > 2:
                    jpeg = render_thermal_jpeg(cv2, vmin, vmax, hud)
                    if jpeg:
                        self.wfile.write(
                            b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                            + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n"
                        )
                    sent_for, sent_at = measured, time.time()
                time.sleep(0.03)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass

    def log_message(self, *args):
        pass  # keep the console quiet


# ======================== Tunnel ========================

def find_cloudflared():
    """cloudflared.exe from the settings, PATH, or the usual install folders."""
    import shutil
    candidates = [os.environ.get("HEATTRACK_CLOUDFLARED"), shutil.which("cloudflared")]
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA", "")
        candidates += [
            DATA_DIR / "cloudflared.exe",                       # downloaded by the installer
            Path(__file__).with_name("cloudflared.exe"),
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "cloudflared" / "cloudflared.exe",
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "cloudflared" / "cloudflared.exe",
            Path(local) / "Microsoft" / "WinGet" / "Links" / "cloudflared.exe",
        ]
    for c in candidates:
        if c and Path(c).is_file():
            return str(c)
    return None


class Tunnel:
    """Keeps a Cloudflare quick tunnel to the local stream running, for as long
    as the logger runs. Every new public address is saved to devices.device_url;
    if cloudflared exits or the address stops answering, it starts a new one."""

    START_TIMEOUT = 60          # s to get an address before trying again
    CHECK_EVERY = 120           # s between "is the public address reachable?" checks
    FAILS_BEFORE_RESTART = 3

    def __init__(self):
        self.running = True
        self.proc = None
        self.url = None
        self._missing_noted = False
        threading.Thread(target=self._supervise, daemon=True).start()

    def stop(self):
        self.running = False
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()

    def _launch(self, exe):
        flags = 0x08000000 if os.name == "nt" else 0          # CREATE_NO_WINDOW
        return subprocess.Popen(
            [exe, "tunnel", "--no-autoupdate", "--url", f"http://localhost:{STREAM_PORT}"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="ignore", creationflags=flags,
        )

    def _supervise(self):
        backoff = 5
        while self.running:
            exe = find_cloudflared()
            if not exe:
                if not self._missing_noted:
                    print("cloudflared is not installed, so the stream only works on this computer:")
                    print(f"   http://localhost:{STREAM_PORT}/video")
                    print("Install it with install_heattrack.ps1 or:  winget install --id Cloudflare.cloudflared")
                    self._missing_noted = True
                time.sleep(60)                  # it may get installed while running
                continue
            try:
                self.proc = self._launch(exe)
            except OSError as e:
                log(f"Could not start cloudflared ({e}); retrying in {backoff} s")
                time.sleep(backoff)
                backoff = min(backoff * 2, 300)
                continue

            got_url = threading.Event()
            threading.Thread(target=self._read_output, args=(self.proc, got_url), daemon=True).start()
            if not got_url.wait(self.START_TIMEOUT):
                log("Cloudflare tunnel gave no address within a minute (no internet yet?); retrying")
                self.proc.terminate()
            else:
                backoff = 5
                self._watch_health(self.proc)

            # The tunnel ended: tell the website, then start a fresh one
            if self.url:
                self.url = None
                publish_stream_url(None)
            if self.running:
                time.sleep(backoff)
                backoff = min(backoff * 2, 300)

    def _read_output(self, proc, got_url):
        for line in proc.stdout:
            m = re.search(r"https://([a-z0-9-]+)\.trycloudflare\.com", line)
            if m and m.group(1) != "api" and not got_url.is_set():
                self.url = m.group(0) + "/video"
                print(f"Live stream online: {self.url}")
                publish_stream_url(self.url)
                got_url.set()

    def _watch_health(self, proc):
        """Wait while the tunnel runs; restart it if its address stops answering."""
        fails, next_check = 0, time.time() + self.CHECK_EVERY
        while self.running and proc.poll() is None:
            time.sleep(1)
            if time.time() < next_check or not self.url:
                continue
            next_check = time.time() + self.CHECK_EVERY
            try:
                ok = requests.get(self.url.replace("/video", "/"), timeout=15).ok
            except requests.RequestException:
                ok = False
            fails = 0 if ok else fails + 1
            if fails >= self.FAILS_BEFORE_RESTART:
                log("The public stream address stopped answering; starting a new tunnel")
                proc.terminate()
                break
        if proc.poll() is None and not self.running:
            proc.terminate()
        if self.running:
            log("Cloudflare tunnel stopped; starting a new one")


# ======================== Sensors ========================

def save_environment_async(temp, hum):
    """Save to public.environment without blocking the sensor thread."""
    def work():
        try:
            insert_reading(temp, hum)
            log(f"{temp:.1f}°C  {hum:.1f}%  saved")
        except requests.RequestException as e:
            log(f"Sensor insert failed: {e}")
    threading.Thread(target=work, daemon=True).start()


def dht_problem(temp, hum):
    """Why a DHT22 reading can't be real, or None if it looks fine."""
    if temp >= 124.9 and hum >= 99.9:
        return ("sensor at its maximum on both values: usually power wired backwards "
                "(the sensor heats up) or a damaged sensor")
    if not DHT_TEMP_RANGE[0] <= temp <= DHT_TEMP_RANGE[1]:
        return f"temperature outside {DHT_TEMP_RANGE[0]:g} to {DHT_TEMP_RANGE[1]:g} C"
    if not DHT_HUM_RANGE[0] <= hum <= DHT_HUM_RANGE[1]:
        return "humidity at 100 %: sensor wet, saturated or damaged"
    return None


class BridgeSensor:
    """Talks to duck_sensor_bridge.ino on the Uno. One background thread reads
    thermal frames continuously and the DHT22 every DHT_READ_EVERY_SEC, so the
    serial port has a single owner. Keeps the newest of each in memory."""

    def __init__(self):
        self.lock = threading.Lock()
        self.latest = None            # (temp, hum, time.time())
        self.frame = None             # newest thermal frame, (24, 32) °C
        self.frame_id = 0
        self.thermal_ok = False
        self.thermal_state = "connecting to the Uno"   # shown in the live summary
        self.thermal_phase = "connecting"   # absent | connecting | ready | streaming | problem (see camera_status)
        self._ready_at = time.time()
        self.thermal_fps = None                        # measured image updates per second
        self._last_frame_at = None
        self._last_env_save = 0.0
        self._last_dht_warning = 0.0
        self._air_peak = None          # highest (temp, hum) since take_air_peak()
        self._next_thermal_try = 0.0
        threading.Thread(target=self._loop, daemon=True).start()

    def _connect(self):
        from thermal_bridge import UnoBridge
        while True:
            try:
                bridge = UnoBridge(SERIAL_PORT, SERIAL_BAUD)
                log(f"Uno bridge connected on {SERIAL_PORT}")
                return bridge
            except Exception as e:
                log(f"Uno not available ({e}). Is duck_sensor_bridge.ino flashed? Retrying in 5 s...")
                self.thermal_phase = "absent"
                time.sleep(5)

    def _start_thermal(self, bridge):
        from thermal_bridge import MLX_ADDRESS, BridgeError, ThermalCamera
        # Quick check first, so the log says WHY the camera isn't there
        try:
            bridge.request("W", MLX_ADDRESS)
        except BridgeError as e:
            if "did not answer" in str(e):
                log("The Uno froze while talking to the thermal camera. This happens when SDA/SCL "
                    "are miswired or the camera has no power. Check the wiring, and flash the "
                    "updated duck_sensor_bridge.ino so the Uno can't freeze. Retrying in 60 s.")
                self.thermal_phase = "problem"
                raise                      # reconnect (resets the Uno)
            log(f"Thermal camera not answering at 0x{MLX_ADDRESS:02X}: {e}. "
                f"Retrying in 60 s, DHT22 continues")
            self.thermal_state = f"not answering ({e}); retrying every 60 s"
            self.thermal_phase = "absent"
            return None
        try:
            log("Reading thermal camera calibration...")
            self.thermal_state = "reading calibration"
            self.thermal_phase = "connecting"
            cam = ThermalCamera(bridge, emissivity=THERMAL_EMISSIVITY, refresh_hz=THERMAL_REFRESH_HZ,
                                flip_horizontal=THERMAL_FLIP_H, flip_vertical=THERMAL_FLIP_V)
            log("Thermal camera ready; waiting for the first frame...")
            self.thermal_state = "ready, waiting for the first frame"
            self.thermal_phase = "ready"
            self._ready_at = time.time()
            return cam
        except Exception as e:  # e.g. camera not wired: keep the DHT22 running
            log(f"Thermal camera not found ({e}); retrying in 60 s, DHT22 continues")
            self.thermal_state = f"calibration failed ({e}); retrying every 60 s"
            self.thermal_phase = "absent"
            return None

    def _read_dht(self, bridge):
        from thermal_bridge import BridgeError, read_dht22
        try:
            d = read_dht22(bridge)
        except BridgeError as e:
            if "DHT22" in str(e):
                log("Arduino reports a DHT22 read error")
                return
            raise
        problem = dht_problem(d.temperature_c, d.humidity_pct)
        if problem:
            # Keep the last good reading; after MAX_READING_AGE_SEC it counts as missing
            if time.time() - self._last_dht_warning >= 60:
                self._last_dht_warning = time.time()
                log(f"DHT22 reading rejected: {d.temperature_c:.1f} C, {d.humidity_pct:.1f} % ({problem})")
            return
        with self.lock:
            self.latest = (d.temperature_c, d.humidity_pct, time.time())
            if self._air_peak is None or d.temperature_c > self._air_peak[0]:
                self._air_peak = (d.temperature_c, d.humidity_pct)
        if ENVIRONMENT_LOG == "every_reading" and time.time() - self._last_env_save >= ENVIRONMENT_EVERY_SEC:
            self._last_env_save = time.time()
            save_environment_async(d.temperature_c, d.humidity_pct)

    def _loop(self):
        while True:
            bridge = self._connect()
            cam, next_dht = None, 0.0
            try:
                while True:
                    now = time.time()
                    if now >= next_dht:
                        next_dht = now + DHT_READ_EVERY_SEC
                        self._read_dht(bridge)
                    if cam is None and now >= self._next_thermal_try:
                        self._next_thermal_try = now + 60
                        cam = self._start_thermal(bridge)
                    if cam is None:
                        time.sleep(0.2)
                        continue
                    air = self.read()
                    frame = cam.read_frame(reflected_temp_c=air[0] if air else None)
                    t_now = time.time()
                    if self._last_frame_at is not None:
                        rate = 1.0 / max(t_now - self._last_frame_at, 1e-3)
                        self.thermal_fps = rate if self.thermal_fps is None else 0.8 * self.thermal_fps + 0.2 * rate
                    self._last_frame_at = t_now
                    with self.lock:
                        self.frame = frame
                        self.frame_id += 1
                        self.thermal_ok = True
                    if self.frame_id == 1:
                        log(f"First thermal frame received after {time.time() - self._ready_at:.1f} s "
                            f"(scene {frame.min():.1f}-{frame.max():.1f} C)")
                    self.thermal_state = "streaming"
                    self.thermal_phase = "streaming"
            except Exception as e:  # serial unplugged, I2C error, ...
                log(f"Uno connection lost ({e}). Reconnecting...")
                self._last_frame_at = None
                self.thermal_fps = None
                with self.lock:
                    self.thermal_ok = False
                self.thermal_state = f"Uno connection lost ({e}); reconnecting"
                if self.thermal_phase != "problem":
                    self.thermal_phase = "connecting"
                try:
                    bridge.close()
                except Exception:
                    pass
                time.sleep(2)

    def read(self):
        """Newest (temp, hum), or None if the DHT22 hasn't answered recently."""
        with self.lock:
            if self.latest is None or time.time() - self.latest[2] > MAX_READING_AGE_SEC:
                return None
            return self.latest[0], self.latest[1]

    def peek_air_peak(self):
        with self.lock:
            return self._air_peak

    def merge_air_peak(self, peak):
        with self.lock:
            if peak and (self._air_peak is None or peak[0] > self._air_peak[0]):
                self._air_peak = (peak[0], peak[1])

    def take_air_peak(self):
        """Highest air reading since the last call (with the humidity measured
        at that moment), then start over. Falls back to the newest reading."""
        with self.lock:
            peak, self._air_peak = self._air_peak, None
        return peak if peak is not None else self.read()

    def latest_frame(self):
        """(frame_id, frame) of the newest thermal frame, or (id, None)."""
        with self.lock:
            return self.frame_id, self.frame


def _thermal_camera_status(self):
    """For the website: 'absent' (Uno or camera not found), 'connecting'
    (starting up), 'streaming', or 'problem' (found but no frames)."""
    now = time.time()
    if self._last_frame_at and now - self._last_frame_at < 10:
        return "streaming"
    phase = self.thermal_phase
    if phase == "streaming":
        return "problem"              # was sending, then stopped
    if phase == "ready":
        return "connecting" if now - self._ready_at < 20 else "problem"
    return phase


BridgeSensor.camera_status = _thermal_camera_status


class FakeSensor:
    """--simulate: random air readings and thermal frames with a warm spot
    wherever a (real or fake) duck box is."""

    def __init__(self):
        self.frame_id = 0
        self.thermal_ok = True
        self.thermal_fps = 2.0
        self.air = (32.0, 70.0)
        self._next_frame = 0.0
        self._frame = None

    def read(self):
        self.air = (round(random.uniform(28, 42), 1), round(random.uniform(50, 90), 1))
        return self.air

    def latest_frame(self):
        if time.time() >= self._next_frame:          # ~2 frames/s like the real bridge
            self._next_frame = time.time() + 0.5
            frame = np.random.normal(self.air[0] - 3, 0.4, (24, 32)).astype(np.float32)
            for box in collector.duck_boxes() if collector else []:
                tb = collector.to_thermal(box[:4])
                c1, r1 = int(np.ceil(tb[0])), int(np.ceil(tb[1]))
                c2, r2 = int(np.floor(tb[2])), int(np.floor(tb[3]))
                frame[max(r1, 0):max(r2, 0), max(c1, 0):max(c2, 0)] = random.uniform(38, 43)
            self._frame = frame
            self.frame_id += 1
        return self.frame_id, self._frame


class FakeDetector:
    """--simulate --no-camera: a few random duck boxes in a 640x360 'webcam' view."""

    def __init__(self):
        self._boxes, self._next = [], 0.0

    def current(self):
        if time.time() >= self._next:
            self._next = time.time() + 5
            self._boxes = []
            for _ in range(random.choice([0, 1, 2, 3, 4])):
                x, y = random.randint(40, 480), random.randint(40, 230)
                self._boxes.append((x, y, x + 110, y + 90, "duck", 0.9))
        return list(self._boxes)


# ========== Body temperature (thermal camera) ==========

def _held_value(history, now, value):
    """Adds value to a (time, value) history and returns the lowest value seen
    over the last CONFIRM_SECONDS, i.e. a level that was held the whole time.
    None until the history covers that long, or if any reading was missing."""
    history.append((now, value))
    # Drop old entries, but always keep one at or beyond CONFIRM_SECONDS so the
    # history spans the full period whatever the frame timing
    while len(history) >= 2 and now - history[1][0] >= CONFIRM_SECONDS:
        history.popleft()
    if len(history) < 3 or now - history[0][0] < CONFIRM_SECONDS:
        return None
    values = [v for _, v in history]
    return None if any(v is None for v in values) else min(values)


class ThermalCollector:
    """Each new thermal frame: measure every duck the detector currently sees
    and pool the readings. take_slot() hands over and resets the pool every
    10 minutes."""

    def __init__(self, sensor, detector, frame_size=None):
        self.sensor = sensor
        self.detector = detector
        self.frame_size = frame_size      # (w, h) of webcam frames when no camera
        self.lock = threading.Lock()
        self.homography = None
        if ALIGNMENT_FILE.exists():
            self.homography = np.load(ALIGNMENT_FILE)
            log(f"Loaded webcam->thermal alignment from {ALIGNMENT_FILE.name}")
        else:
            log("No thermal_alignment.npy yet: scaling the webcam view onto the thermal grid")
        self.latest_air = None
        self.last_frame = None
        self.last_results = []
        self.last_time = 0.0
        self._reset()
        threading.Thread(target=self._loop, daemon=True).start()
        if THERMAL_LOG_SEC:
            threading.Thread(target=self._console_loop, daemon=True).start()

    def _reset(self):
        self.readings = []                        # one "high" value per valid duck reading
        self.frames_with_ducks = 0
        self.max_seen = 0                         # most ducks in any single frame (unconfirmed)
        self.rejects = Counter()
        self.peak_count = 0
        self.highest = None                       # (temp, time) held for CONFIRM_SECONDS
        self._recent_counts = deque()             # (time, duck count)
        self._recent_max = deque()                # (time, hottest valid reading or None)

    def duck_boxes(self):
        return self.detector.current() if self.detector else []

    def to_thermal(self, box):
        if self.homography is not None:
            return webcam_box_to_thermal(box, self.homography)
        w, h = self._webcam_size()
        sx, sy = 32.0 / w, 24.0 / h
        return (box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy)

    def _webcam_size(self):
        raw = camera.latest_raw() if camera else None
        if raw is not None:
            return raw.shape[1], raw.shape[0]
        return self.frame_size or (FRAME_WIDTH, FRAME_HEIGHT)

    def _loop(self):
        last_id = None
        while True:
            fid, frame = self.sensor.latest_frame()
            if frame is None or fid == last_id:
                time.sleep(0.05)
                continue
            last_id = fid
            try:
                self._process(frame)
            except Exception as e:
                log(f"Thermal measurement error: {e}")

    def _process(self, frame):
        boxes = self.duck_boxes()
        thermal_boxes = [self.to_thermal(b[:4]) for b in boxes]
        results = measure_ducks(frame, thermal_boxes, MEASURE) if thermal_boxes else []
        valid = [r.estimated_body_c for r in results if r.valid]
        with self.lock:
            # Kept for the live displays (stream labels, /thermal, console)
            self.last_frame = frame
            self.last_results = [(b[:4], r) for b, r in zip(boxes, results)]
            self.last_time = time.time()
            now = time.time()
            # Peak count: the count must hold for CONFIRM_SECONDS
            held = _held_value(self._recent_counts, now, len(boxes))
            if held is not None:
                self.peak_count = max(self.peak_count, held)
            if boxes:
                self.frames_with_ducks += 1
            self.max_seen = max(self.max_seen, len(boxes))
            for r in results:
                if not r.valid:
                    self.rejects[r.reason.split(" (")[0]] += 1
            self.readings.extend(valid)
            # Highest: the hottest duck must stay that hot for CONFIRM_SECONDS
            confirmed = _held_value(self._recent_max, now, max(valid) if valid else None)
            if confirmed is not None:
                if self.highest is None or confirmed > self.highest[0]:
                    self.highest = (confirmed, datetime.now(timezone.utc))

    def peek_slot(self):
        """Summary of the pool so far, without starting a new one."""
        with self.lock:
            return {
                "peak_count": self.peak_count,
                "readings": list(self.readings),
                "highest": self.highest,
                "frames_with_ducks": self.frames_with_ducks,
                "max_seen": self.max_seen,
                "rejects": dict(self.rejects),
            }

    def merge_slot(self, slot):
        """Add a saved pool (from before a restart) into the current one."""
        with self.lock:
            self.readings.extend(slot.get("readings") or [])
            self.frames_with_ducks += slot.get("frames_with_ducks", 0)
            self.max_seen = max(self.max_seen, slot.get("max_seen", 0))
            self.peak_count = max(self.peak_count, slot.get("peak_count", 0))
            self.rejects.update(slot.get("rejects") or {})
            h = slot.get("highest")
            if h and (self.highest is None or h[0] > self.highest[0]):
                self.highest = h

    def take_slot(self):
        """Summary of the pool since the last call, then start a new pool."""
        with self.lock:
            slot = {
                "peak_count": self.peak_count,
                "readings": list(self.readings),
                "highest": self.highest,
                "frames_with_ducks": self.frames_with_ducks,
                "max_seen": self.max_seen,
                "rejects": dict(self.rejects),
            }
            self._reset()
        return slot

    def live(self):
        with self.lock:
            frame = self.last_frame
            return {"readings": len(self.readings), "peak_count": self.peak_count,
                    "highest_c": self.highest[0] if self.highest else None,
                    "scene_min_c": round(float(frame.min()), 1) if frame is not None else None,
                    "scene_max_c": round(float(frame.max()), 1) if frame is not None else None,
                    "ducks_now": [r.estimated_body_c if r.valid else None for _, r in self.last_results],
                    "measured_at": self.last_time or None,
                    "fps": round(self.sensor.thermal_fps, 1) if getattr(self.sensor, "thermal_fps", None) else None}

    def snapshot(self):
        """(frame, [(webcam_box, reading)], age_seconds) for the displays."""
        with self.lock:
            age = time.time() - self.last_time if self.last_time else None
            return self.last_frame, list(self.last_results), age

    def reading_for(self, box):
        """Latest reading for a webcam box (matched by overlap), or None if stale."""
        with self.lock:
            if not self.last_time or time.time() - self.last_time > 3:
                return None
            best, best_iou = None, 0.3
            for b, r in self.last_results:
                ix = max(0, min(box[2], b[2]) - max(box[0], b[0]))
                iy = max(0, min(box[3], b[3]) - max(box[1], b[1]))
                inter = ix * iy
                union = ((box[2] - box[0]) * (box[3] - box[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)
                iou = inter / union if union > 0 else 0
                if iou > best_iou:
                    best, best_iou = r, iou
            return best

    def _console_loop(self):
        """Live feedback every THERMAL_LOG_SEC so you can see the camera working."""
        last_msg, last_at = None, 0.0
        while True:
            time.sleep(THERMAL_LOG_SEC)
            frame, results, age = self.snapshot()
            if frame is None:
                # No frame yet: say what the camera is doing (repeat at most every 30 s)
                msg = f"Thermal: {getattr(self.sensor, 'thermal_state', 'no frames yet')}"
                if msg != last_msg or time.time() - last_at >= 30:
                    log(msg)
                    last_msg, last_at = msg, time.time()
                continue
            if age is not None and age > 10:
                log(f"Thermal: no new frame for {age:.0f} s")
                continue
            fps = getattr(self.sensor, "thermal_fps", None)
            line = f"Thermal: {fps:.1f} fps | scene {frame.min():.1f}-{frame.max():.1f} C" if fps else \
                   f"Thermal: scene {frame.min():.1f}-{frame.max():.1f} C"
            if not results:
                line += " | no ducks detected"
            else:
                temps = [r.estimated_body_c for _, r in results if r.valid]
                line += f" | ducks {len(results)}, measured {len(temps)}"
                if temps:
                    line += f" (hottest {max(temps):.1f} C)"
                skipped = Counter(r.reason.split(" (")[0] for _, r in results if not r.valid)
                if skipped:
                    line += " | skipped: " + ", ".join(f"{k} x{v}" for k, v in skipped.items())
            log(line)


collector = None


def slot_status(slot):
    if slot["peak_count"] == 0 and slot["frames_with_ducks"] == 0:
        return "no ducks detected"
    if not slot["readings"]:
        return "ducks detected, no valid thermal reading"
    return "valid"


def write_slot_log(slot, air):
    """10-minute summary, kept locally for training the model later."""
    new = not SLOT_LOG_FILE.exists()
    with SLOT_LOG_FILE.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["timestamp", "batch_count", "status", "peak_duck_count", "valid_readings",
                        "highest_body_c", "highest_body_time", "average_body_c",
                        "air_temperature_c", "humidity_pct", "rejected"])
        readings = slot["readings"]
        w.writerow([
            now_iso(), BATCH_COUNT, slot_status(slot), slot["peak_count"], len(readings),
            round(slot["highest"][0], 2) if slot["highest"] else "",
            slot["highest"][1].isoformat() if slot["highest"] else "",
            round(sum(readings) / len(readings), 2) if readings else "",
            air[0] if air else "", air[1] if air else "",
            json.dumps(slot["rejects"]) if slot["rejects"] else "",
        ])


# ================ Heat-stress severity model ================

class SeverityModel:
    def __init__(self, path):
        obj = joblib.load(path)
        self.label_encoder = None
        # Accept a bare model, or a dict like {"model": ..., "label_encoder": ...}
        if isinstance(obj, dict):
            self.model = obj.get("model") or obj.get("clf") or obj.get("pipeline")
            self.label_encoder = obj.get("label_encoder") or obj.get("encoder")
            if self.model is None:
                raise ValueError(f"Pickle is a dict without a 'model' key: {list(obj)}")
        else:
            self.model = obj
        self.features = list(getattr(self.model, "feature_names_in_", []))

    def _row(self, temperature, humidity):
        # Build the input with the same column names the model was trained on.
        if not self.features:
            return [[temperature, humidity]]  # trained without names: assume [temp, humidity]
        values = {}
        for name in self.features:
            key = name.lower()
            if "temp" in key:
                values[name] = temperature
            elif "hum" in key or key in ("rh", "relative_humidity"):
                values[name] = humidity
            else:
                raise ValueError(
                    f"Model expects feature '{name}', which isn't temperature or humidity. "
                    f"All features: {self.features}"
                )
        return pd.DataFrame([values], columns=self.features)

    def predict(self, temperature, humidity):
        raw = self.model.predict(self._row(temperature, humidity))[0]
        if self.label_encoder is not None:
            raw = self.label_encoder.inverse_transform([raw])[0]
        return self.normalize(raw), raw

    @staticmethod
    def normalize(raw):
        if isinstance(raw, (int, float)) or str(raw).strip().lstrip("-").isdigit():
            sev = NUMERIC_SEVERITY.get(int(raw))
        else:
            sev = TEXT_SEVERITY.get(str(raw).strip().upper().replace("_", " "))
        if sev is None:
            raise ValueError(f"Unknown model output {raw!r}; add it to NUMERIC_SEVERITY or TEXT_SEVERITY")
        return sev

    def describe(self):
        print("Model type     :", type(self.model).__name__)
        print("Features       :", self.features or "(no names stored — assumed [temperature, humidity])")
        print("Classes        :", list(getattr(self.model, "classes_", [])) or "(not available)")
        if self.label_encoder is not None:
            print("Label encoder  :", list(self.label_encoder.classes_))
        print("\nSample predictions (temp °C, humidity %):")
        for t, h in [(28, 60), (32, 70), (35, 75), (38, 80), (41, 85)]:
            try:
                sev, raw = self.predict(t, h)
                print(f"  {t:>4}  {h:>4}  ->  raw={raw!r:<14} severity={sev}")
            except Exception as e:  # show the problem instead of crashing
                print(f"  {t:>4}  {h:>4}  ->  ERROR: {e}")


# ============ One 30-minute window -> one analytics row ============

def build_analytics_row(model, samples, slots, interval_minutes, at=None):
    """One analytics row for a 10-minute slot or a 30-minute window.
    samples: the highest air reading of each slot; slots: the thermal summaries."""
    label = f"{interval_minutes}-minute"
    confirmed = max(s["peak_count"] for s in slots)
    brief_max = max(s.get("max_seen", 0) for s in slots)
    temps = [t for s in slots for t in s["readings"]]
    highs = [s["highest"] for s in slots if s["highest"]]

    # Duck count: the confirmed peak (held CONFIRM_SECONDS); if there was none,
    # the most ducks seen in one frame (brief detections), when allowed
    if confirmed >= 1:
        peak_count, note = confirmed, ""
    elif ALLOW_BRIEF_DETECTIONS and brief_max >= 1:
        peak_count, note = brief_max, " (brief detection)"
    else:
        brief = brief_max >= 1
        log(f"{label}: no ducks detected" + (" (only brief, unconfirmed detections)" if brief else "")
            + "; nothing saved")
        return None
    # A body temperature is still required (the analytics columns need one)
    if not temps:
        log(f"{label}: ducks detected but no valid thermal reading; nothing saved")
        return None
    if not samples:
        log(f"{label}: no air temperature/humidity reading; nothing saved")
        return None

    # Highest air temperature in the period, with the humidity read at that moment
    peak = max(samples, key=lambda s: s["temperature"])
    severity, raw = model.predict(peak["temperature"], peak["humidity"])

    # Highest body temperature that held for CONFIRM_SECONDS; falls back to the raw max
    highest = max(h[0] for h in highs) if highs else max(temps)
    log(f"{label}: highest body {highest:.1f}°C ({len(temps)} readings, peak {peak_count} duck(s){note}); "
        f"highest air {peak['temperature']:.1f}°C / {peak['humidity']:.1f}% -> {severity}")

    # Timestamped at the slot's / window's own mark (also for rows saved late)
    now = datetime.fromtimestamp(at, timezone.utc) if at else datetime.now(timezone.utc)
    return {
        "userid": USER_ID,
        "device_id": DEVICE_ID,
        "timestamp": now.isoformat(),
        "status": STATUS_FROM_SEVERITY[severity],
        "severity": severity,
        "lowest_body_temperature": round(min(temps), 2),
        "highest_body_temperature": round(highest, 2),
        "average_body_temperature": round(sum(temps) / len(temps), 2),
        "duck_count": peak_count,
        "interval_minutes": interval_minutes,
        # batch_count (1, 2, 3 ...) is assigned by the database; record_key is
        # this row's own unique ID, so a row sent twice is never saved twice
        "record_key": f"{DEVICE_ID[:8]}-{now:%Y%m%d-%H%M%S}-{interval_minutes}m",
    }


def save_analytics(row):
    if row and recheck_owner():
        insert_or_queue("analytics", row)


def _next_boundary(interval, after):
    """Next clock time that is a whole multiple of `interval` seconds
    (10:00, 10:10, 10:20 ... for 600 s)."""
    return (int(after // interval) + 1) * interval


# ---- Progress file: lets the 10/30-minute schedule survive a restart ----
# Saved every minute: the slots already finished in the current 30-minute
# window and everything collected so far in the current 10-minute slot.

def _slot_to_json(slot):
    s = dict(slot)
    if s.get("highest"):
        s["highest"] = [s["highest"][0], s["highest"][1].isoformat()]
    return s


def _slot_from_json(s):
    s = dict(s)
    if s.get("highest"):
        s["highest"] = (s["highest"][0], datetime.fromisoformat(s["highest"][1]))
    s.setdefault("max_seen", 0)
    s.setdefault("rejects", {})
    return s


def _empty_slot():
    return {"peak_count": 0, "readings": [], "highest": None, "frames_with_ducks": 0,
            "max_seen": 0, "rejects": {}}


def _slot_has_data(slot):
    return bool(slot and (slot.get("frames_with_ducks") or slot.get("readings")))


def save_progress(interval, slot_end, window_end, samples, slots, sensor):
    if DRY_RUN:
        return
    peek_air = getattr(sensor, "peek_air_peak", None)
    # Highest air reading of this slot so far; the latest reading if there is none yet
    air = (peek_air() if peek_air else None) or sensor.read()
    data = {
        "version": 1, "interval": interval, "device_id": DEVICE_ID,
        "slot_end": slot_end, "window_end": window_end, "saved_at": time.time(),
        "samples": samples, "slots": [_slot_to_json(s) for s in slots],
        "partial": _slot_to_json(collector.peek_slot()),
        "partial_air": list(air) if air else None,
    }
    try:
        tmp = PROGRESS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        os.replace(tmp, PROGRESS_FILE)
    except OSError as e:
        log(f"Could not save progress ({e})")


def load_progress(interval):
    try:
        data = json.loads(PROGRESS_FILE.read_text())
    except (OSError, ValueError):
        return None
    if data.get("version") != 1 or data.get("interval") != interval or data.get("device_id") != DEVICE_ID:
        return None
    return data


def resume_progress(model, interval, window_len, sensor, slot_end, window_end):
    """After a restart: finish whatever was interrupted. Returns the samples and
    slots that belong to the current 30-minute window."""
    data = load_progress(interval)
    if not data:
        return [], []
    now = time.time()
    old_slot_end, old_window_end = data["slot_end"], data["window_end"]
    if old_slot_end > slot_end:                     # clock went backwards: ignore it
        return [], []
    samples = list(data.get("samples") or [])
    slots = [_slot_from_json(s) for s in data.get("slots") or []]
    partial = _slot_from_json(data.get("partial") or _empty_slot())
    partial_air = data.get("partial_air")

    if old_slot_end == slot_end:
        # Restarted inside the same 10-minute slot: keep collecting into it
        collector.merge_slot(partial)
        merge_air = getattr(sensor, "merge_air_peak", None)
        if merge_air and partial_air:
            merge_air(tuple(partial_air))
        if _slot_has_data(partial) or slots:
            log(f"Resumed after a restart: keeping the data collected since "
                f"{datetime.fromtimestamp(old_slot_end - interval):%H:%M}")
        return (samples, slots) if old_window_end == window_end else ([], [])

    # The slot that was running ended while the logger was down: save it now,
    # timestamped at its own mark
    stamp = datetime.fromtimestamp(old_slot_end).strftime("%H:%M")
    slot_samples = [{"temperature": partial_air[0], "humidity": partial_air[1]}] if partial_air else []
    if _slot_has_data(partial):
        log(f"Resumed after a restart: saving the {stamp} slot that was interrupted")
        try:
            save_analytics(build_analytics_row(model, slot_samples, [partial], SLOT_ROW_MINUTES,
                                               at=old_slot_end))
        except Exception as e:
            log(f"Catch-up {SLOT_ROW_MINUTES}-minute row failed: {e}")
    slots.append(partial)
    samples += slot_samples

    if old_window_end <= now:
        # Its 30-minute window also ended while down: save that row too
        if any(_slot_has_data(s) for s in slots):
            log(f"Resumed after a restart: saving the "
                f"{datetime.fromtimestamp(old_window_end):%H:%M} 30-minute window")
            try:
                save_analytics(build_analytics_row(model, samples, slots,
                                                   SLOT_ROW_MINUTES * SAMPLES_PER_WINDOW, at=old_window_end))
            except Exception as e:
                log(f"Catch-up 30-minute row failed: {e}")
        return [], []
    return (samples, slots) if old_window_end == window_end else ([], [])


def analytics_loop(model, sensor, interval, once=False):
    """Slots end on the clock (:00, :10, :20 ... for 10-minute slots).
    Every slot  -> one 10-minute analytics row (also a short first slot).
    At :00 and :30 -> one 30-minute analytics row with the highest body
    temperature and the highest air temperature of the window.
    Progress is saved every minute, so a restart resumes where it stopped."""
    window_len = interval * SAMPLES_PER_WINDOW
    # Rows are always labelled 10 and 30 (also in tests with short --interval),
    # so the website can tell slot rows from window rows
    slot_minutes, window_minutes = SLOT_ROW_MINUTES, SLOT_ROW_MINUTES * SAMPLES_PER_WINDOW
    checkpoint_every = min(PROGRESS_EVERY_SEC, interval / 4)

    now = time.time()
    slot_end = _next_boundary(interval, now)
    window_end = _next_boundary(window_len, now)
    collector.take_slot()          # start clean ...
    _take_air_peak(sensor)
    samples, slots = resume_progress(model, interval, window_len, sensor, slot_end, window_end)  # ... then resume

    if interval == SLOT_ROW_MINUTES * 60:
        log(f"Saving a 10-minute analytics row at :00, :10, :20 ... and a 30-minute row at :00 and :30; "
            f"next slot ends at {datetime.fromtimestamp(slot_end):%H:%M}")
    else:
        log(f"TEST TIMING: {interval:g} s slots stand in for 10 minutes ({window_len:g} s "
            f"for 30); next slot ends at {datetime.fromtimestamp(slot_end):%H:%M:%S}")

    while True:
        try:
            # Wait for the slot to end, saving progress (and retrying queued rows) as we go
            while time.time() < slot_end:
                time.sleep(max(0.0, min(checkpoint_every, slot_end - time.time())))
                save_progress(interval, slot_end, window_end, samples, slots, sensor)
                retry_pending()

            ended_at = slot_end
            # Normally the next mark; after a long stall, the first mark still ahead
            slot_end = _next_boundary(interval, max(time.time(), ended_at))

            reading = _take_air_peak(sensor)
            thermal = collector.take_slot()
            slots.append(thermal)
            slot_no = len(slots)
            stamp = f"{datetime.fromtimestamp(ended_at):%H:%M}"
            if reading is None:
                log(f"[{stamp}] slot {slot_no}: no recent air reading")
            else:
                t, h = reading
                samples.append({"temperature": t, "humidity": h})
                log(f"[{stamp}] slot {slot_no}: highest air {t:.1f}°C, {h:.1f}%")
                if ENVIRONMENT_LOG == "every_sample":
                    try:
                        insert_reading(t, h)
                    except requests.RequestException as e:
                        log(f"Environment insert failed: {e}")
            hi = f"{thermal['highest'][0]:.1f}°C" if thermal["highest"] else "-"
            brief_note = (f" (brief: {thermal['max_seen']})"
                          if thermal.get("max_seen", 0) > thermal["peak_count"] else "")
            log(f"   ducks: peak {thermal['peak_count']}{brief_note}, {len(thermal['readings'])} body readings, "
                f"highest {hi} -> {slot_status(thermal)}"
                + (f"  (rejected: {thermal['rejects']})" if thermal["rejects"] else ""))
            try:
                write_slot_log(thermal, reading)
            except OSError as e:
                log(f"Could not write {SLOT_LOG_FILE.name}: {e}")
            if not getattr(sensor, "thermal_ok", True):
                log("   thermal camera is not delivering frames")

            # 10-minute row for this slot
            try:
                slot_samples = [samples[-1]] if reading is not None else []
                save_analytics(build_analytics_row(model, slot_samples, [thermal], slot_minutes, at=ended_at))
            except Exception as e:
                log(f"{slot_minutes}-minute row failed: {e}")

            # 30-minute row at :00 and :30 (from the slots collected since the last one)
            window_closed = ended_at >= window_end
            if window_closed:
                try:
                    save_analytics(build_analytics_row(model, samples, slots, window_minutes, at=ended_at))
                except Exception as e:
                    log(f"{window_minutes}-minute row failed: {e}")
                samples, slots = [], []
                window_end = _next_boundary(window_len, ended_at)

            save_progress(interval, slot_end, window_end, samples, slots, sensor)
            if once and window_closed:
                return
        except Exception as e:
            # Never let one bad moment stop the schedule
            log(f"Interval loop error ({type(e).__name__}: {e}); carrying on")
            time.sleep(5)


def retry_pending():
    """Send rows queued during an outage as soon as Supabase is reachable again."""
    if DRY_RUN or not PENDING_FILE.exists():
        return
    try:
        flush_pending()
    except Exception as e:
        log(f"Could not resend queued rows yet ({type(e).__name__})")


def _take_air_peak(sensor):
    """Highest air reading since the last call (falls back to the newest)."""
    take = getattr(sensor, "take_air_peak", None)
    return take() if take else sensor.read()



# ========================= Main =========================

def main():
    global camera, collector, DRY_RUN

    p = argparse.ArgumentParser(description="HeatTrack logger + bridge")
    p.add_argument("--severity-model", default=SEVERITY_MODEL_PATH)
    p.add_argument("--interval", type=float, default=SAMPLE_INTERVAL_SEC, help="seconds between samples")
    p.add_argument("--inspect", action="store_true", help="print severity-model info and sample predictions")
    p.add_argument("--simulate", action="store_true", help="fake temperature/humidity instead of the Arduino")
    p.add_argument("--dry-run", action="store_true", help="print rows instead of saving them")
    p.add_argument("--no-camera", action="store_true",
                   help="skip webcam, YOLO, stream and tunnel (with --simulate: fake ducks)")
    p.add_argument("--once", action="store_true", help="stop after one 30-minute window")
    args = p.parse_args()

    if args.inspect:
        SeverityModel(args.severity_model).describe()
        return

    prepare_data_dir()
    log(f"Data files (device.json, slot_log.csv, pending_rows.jsonl): {DATA_DIR}")
    if ENV_LOADED:
        log(f"Settings from {ENV_FILE.name}: device {DEVICE_CODE}, serial {SERIAL_PORT}, camera {CAMERA_INDEX}")
    else:
        log(f"WARNING: no {ENV_FILE.name} found in {ENV_FILE.parent}; using built-in defaults "
            f"(device {DEVICE_CODE}, serial {SERIAL_PORT}, camera {CAMERA_INDEX})")

    # Fake data must never reach the real account
    if args.simulate and not args.dry_run:
        log("--simulate implies --dry-run: nothing will be saved")
    DRY_RUN = args.dry_run or args.simulate
    if not DRY_RUN:
        if SUPABASE_SECRET_KEY.startswith("PASTE_"):
            where = ENV_FILE.name if ENV_LOADED else f"{ENV_FILE.name} (not found next to this script)"
            sys.exit(f"Add HEATTRACK_SUPABASE_SECRET_KEY to {where} first.")
        if SUPABASE_SECRET_KEY.startswith("sb_publishable_"):
            sys.exit("HEATTRACK_SUPABASE_SECRET_KEY holds the publishable key; it needs the secret key "
                     "(Supabase > Project Settings > API Keys > Secret keys).")

    if DRY_RUN:
        set_identity({"user_id": PLACEHOLDER_ID, "device_id": PLACEHOLDER_ID})
        log("Test mode: using placeholder user and device ids")
    else:
        resolve_identity()

    model = SeverityModel(args.severity_model)
    sensor = FakeSensor() if args.simulate else BridgeSensor()

    server = tunnel = None
    if not args.no_camera:
        camera = Camera()
        camera.detector = start_detector(camera)
        server = ThreadingHTTPServer(("127.0.0.1", STREAM_PORT), StreamHandler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f"Local stream: http://localhost:{STREAM_PORT}/video   thermal view: http://localhost:{STREAM_PORT}/thermal")
        tunnel = Tunnel()

    detector = camera.detector if camera else (FakeDetector() if args.simulate else None)
    if detector is None:
        log("No duck detector running: body temperature can't be measured, so no analytics rows")
    collector = ThermalCollector(sensor, detector)

    try:
        analytics_loop(model, sensor, args.interval, once=args.once)
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        if camera:
            publish_stream_url(None)      # website shows "No camera connected"
            camera.running = False
        if tunnel:
            tunnel.stop()
        if server:
            server.shutdown()


if __name__ == "__main__":
    main()
