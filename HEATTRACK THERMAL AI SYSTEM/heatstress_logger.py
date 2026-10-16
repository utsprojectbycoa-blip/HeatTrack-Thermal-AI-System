#!/usr/bin/env python3
"""
HeatTrack logger + bridge (mini PC)
===================================

  Arduino Uno (USB)     -> runs duck_sensor_bridge.ino: relays the MLX90640 thermal
                           camera and reads the DHT22
  Thermal camera        -> each duck YOLO sees is measured (duck_temperature.py)
  Every 10 minutes      -> one analytics row (interval 10) for that slot
  Every 30 minutes      -> one analytics row (interval 30) for the whole window
  Rating (both rows)    -> from the ducks' HIGHEST body-area temperature (thermal camera):
                              35.7 C or below LOW · 35.8-43.6 MODERATE · 43.7-44.9 HIGH ·
                              45.0 or above CRITICAL
                           STATUS: thermal camera only, from that level:
                              LOW NORMAL · MODERATE MILD · HIGH/CRITICAL HEAT STRESS
                           SEVERITY: thermal camera + DHT22 (see rate_thi): the level
                              moved by the THI of the highest air temperature + its
                              humidity: 84 or above up one, 74 or below down one
                              (45 C or above stays CRITICAL)
                           Same rule as the database (body_temp_thi_levels.sql).
                           No ducks / no valid thermal reading -> no row.
  Webcam + YOLO         -> live video (MJPEG) at http://localhost:8000/video, /thermal, /stats
  Cloudflare tunnel     -> public https address for the video, saved to devices.device_url

  Uploads use this device's own API key (HEATTRACK_DEVICE_API_KEY) through the
  Supabase functions ingest_environment / ingest_analytics / update_device_url /
  device_whoami, so the data lands on the account that claimed the device.
  No secret key is needed on this computer.

Settings (.env next to this file):
    HEATTRACK_SUPABASE_URL      https://<project>.supabase.co
    HEATTRACK_SUPABASE_KEY      the publishable / anon key (NOT the secret key)
    HEATTRACK_DEVICE_ID         e.g. HT-PDCK-001
    HEATTRACK_DEVICE_API_KEY    this device's API key
    HEATTRACK_SERIAL_PORT       optional, default COM7
    HEATTRACK_CAMERA_INDEX      optional, default 0

Keep thermal_bridge.py and duck_temperature.py next to this file, and flash
duck_sensor_bridge.ino onto the Uno. install_heattrack.ps1 installs everything
and starts the logger after every boot.

Run:
    python heatstress_logger.py                  (Ctrl + C to stop)

Useful options:
    python heatstress_logger.py --check          only check the settings and the device key
    python heatstress_logger.py --inspect        show what the severity model expects/returns
    python heatstress_logger.py --simulate --no-camera --interval 2
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
# The publishable (anon) key; NOT the secret key
SUPABASE_KEY = os.environ.get("HEATTRACK_SUPABASE_KEY", "").strip()
# This mini PC's Device ID and its API key (the ones used to sign up on the website)
DEVICE_CODE = (os.environ.get("HEATTRACK_DEVICE_ID")
               or os.environ.get("HEATTRACK_DEVICE_CODE") or "").strip().upper()
DEVICE_API_KEY = os.environ.get("HEATTRACK_DEVICE_API_KEY", "").strip()
# Files the logger writes while running live in their own folder, NOT next to the
# website: a live-reloading web server (e.g. VS Code Live Server) reloads the page
# whenever a file in the website folder changes, which looks like a sign-out.
DATA_DIR = Path(os.environ.get("HEATTRACK_DATA_DIR") or (Path.home() / "HeatTrack data"))
BATCH_COUNT = None                                 # optional environment.batch_count

SERIAL_PORT = os.environ.get("HEATTRACK_SERIAL_PORT", "COM7")
SERIAL_BAUD = 500000        # must match BAUD in duck_sensor_bridge.ino
DHT_READ_EVERY_SEC = 2      # the DHT22 can't update faster than every 2 s
# Readings outside the DHT22's real range are rejected (never saved or used)
DHT_TEMP_RANGE = (-40.0, 80.0)     # °C, DHT22 / AM2302 datasheet
DHT_HUM_RANGE = (0.0, 99.9)        # % RH; a steady 100.0 means the sensor is saturated
CAMERA_INDEX = int(os.environ.get("HEATTRACK_CAMERA_INDEX", "0"))  # 0 = built-in, 1 = usually USB webcam

STREAM_PORT = 8000
# Turn the webcam picture (before duck detection, so boxes and temperatures match):
#   "none", "vertical" (upside down), "horizontal" (mirror), "both" (rotate 180°)
WEBCAM_FLIP = os.environ.get("HEATTRACK_WEBCAM_FLIP", "horizontal").strip().lower()
_FLIP_CODES = {"vertical": 0, "horizontal": 1, "both": -1, "rotate180": -1}
STREAM_FPS = 20            # frames per second sent to viewers
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
# How Status and Severity are decided:
#   "thi"          = (default) STATUS from the body-area temperature levels below only;
#                    SEVERITY from those levels, raised or lowered by one level by the
#                    DHT22's THI (see rate_thi). Same rule as body_temp_thi_levels.sql.
#   "spectrum"     = body-area temperature only: exactly the levels below.
#                    The DHT22 is still read, saved and logged but does not change the rating.
#   "combined"     = the levels below, raised or lowered by one level by the DHT22's
#                    THI + the trained model (see rate_combined)
#   "spectrum+dht" = the same, but a higher DHT22 environment rating (heatstress_model_2.pkl)
#                    raises the result by one level
#   "model"        = heatstress_model_2.pkl only (see SEVERITY_TEMPERATURE)
SEVERITY_METHOD = os.environ.get("HEATTRACK_SEVERITY_METHOD", "thi").strip().lower()
SEVERITY_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"]
# With "model": which temperature goes into the model's "temperature" input:
#   "body" = highest duck body temperature (thermal camera), "air" = DHT22 air temperature
SEVERITY_TEMPERATURE = os.environ.get("HEATTRACK_SEVERITY_TEMPERATURE", "body").strip().lower()

# Status & Severity levels (same as the website's Status & Severity section), from
# the ducks' highest body-area temperature of the period:
#   35.7 C or below        -> LOW       -> NORMAL       (keep routine monitoring)
#   35.8 C to 43.6 C       -> MODERATE  -> MILD         (take preventive steps)
#   43.7 C to 44.9 C       -> HIGH      -> HEAT STRESS  (start cooling now)
#   45.0 C or above        -> CRITICAL  -> HEAT STRESS  (emergency action, call a vet)
# Each edge belongs to the LOWER level: 35.7 is LOW, anything above it is MODERATE;
# above 43.6 is HIGH; above 44.9 is CRITICAL.
SPECTRUM_BANDS = [(44.9, "CRITICAL"), (43.6, "HIGH"), (35.7, "MODERATE")]   # else LOW


def severity_from_spectrum(body_c):
    for edge, severity in SPECTRUM_BANDS:
        if body_c > edge:
            return severity
    return "LOW"


# ---- DHT22 support for "combined": Temperature-Humidity Index (THI) ----
# THI = 0.8*T + RH*(T - 14.3)/100 + 46.3   (T = air °C, RH = %; NRC 1971 form)
# Livestock Weather Safety Index zones for this THI:
#   74 or below = normal, 75-78 = alert, 79-83 = danger, 84 or above = emergency
THI_COOL_MAX = 74.0       # THI at or below this: comfortable air
THI_HOT_MIN = 84.0        # THI at or above this: emergency (hot) air


def thi_of(air_c, humidity):
    return 0.8 * air_c + humidity * (air_c - 14.3) / 100.0 + 46.3


def thi_zone(thi):
    if thi >= THI_HOT_MIN:
        return "emergency"
    if thi >= 79:
        return "danger"
    if thi >= 75:
        return "alert"
    return "normal"


def rate_thi(body_c, air_c, humidity):
    """DHT22 support: the body-area temperature level moved one level by the THI.

    1. Thermal camera: the ducks' highest body-area temperature -> starting level
       (35.7 / 43.6 / 44.9 °C).
    2. DHT22: air temperature + humidity -> THI = 0.8*T + RH*(T - 14.3)/100 + 46.3
    3. THI 84 or above (emergency) -> up one level   (hot, humid air)
       THI 74 or below (normal)    -> down one level (cool air)
       THI 75-83                   -> no change
       Never more than one level; 45 °C or above always stays CRITICAL.
    Without a DHT22 reading the temperature level is used as is.
    Returns (severity, explanation for the log)."""
    return rate_combined(body_c, air_c, humidity, model=None)


def rate_combined(body_c, air_c, humidity, model=None):
    """The thermal camera and the DHT22 decide the severity together.

    1. Thermal camera: the ducks' highest body temperature -> starting level
       (35.7 / 43.6 / 44.9 °C, the heat-stress levels).
    2. DHT22: air temperature + humidity -> THI, and the trained model's rating
       of the air (heatstress_model_2.pkl).
    3. RAISE one level when the air is hot: THI 84 or above (emergency),
       OR the trained model rates the air higher than the ducks' level.
       LOWER one level when the air is cool: THI 74 or below (normal)
       AND the trained model rates the air lower than the ducks' level.
       Raising needs one warning; lowering needs both to agree (safety first).
       Never more than one level; a duck at 45 °C or above always stays CRITICAL.
    Without a DHT22 reading the thermal level is used as is.
    Returns (severity, explanation for the log)."""
    base = severity_from_spectrum(body_c)
    how = f"thermal {body_c:.1f}°C = {base}"
    if air_c is None or humidity is None:
        return base, how + "; no DHT22 reading, thermal only"

    thi = round(thi_of(air_c, humidity), 1)      # 1 decimal, same as the database
    how += f"; DHT22 {air_c:.1f}°C / {humidity:.1f}% -> THI {thi:.1f} ({thi_zone(thi)})"
    env = None
    if model is not None:
        try:
            env, _ = model.predict(air_c, humidity)
            how += f", model {env}"
        except Exception as err:          # model problem: THI alone
            how += f", model skipped ({err})"

    b = SEVERITY_ORDER.index(base)
    e = SEVERITY_ORDER.index(env) if env else None
    if thi >= THI_HOT_MIN or (e is not None and e > b):
        if b < len(SEVERITY_ORDER) - 1:
            return SEVERITY_ORDER[b + 1], how + " -> hot air: raised one level"
        return base, how + " -> hot air (already CRITICAL)"
    if thi <= THI_COOL_MAX and (e is None or e < b):
        if base == "CRITICAL":
            return base, how + " -> cool air, but 45 °C or above stays CRITICAL"
        if b > 0:
            return SEVERITY_ORDER[b - 1], how + " -> cool air: lowered one level"
    return base, how + " -> no change"
SLOT_ROW_MINUTES = 10
SAMPLE_INTERVAL_SEC = SLOT_ROW_MINUTES * 60   # one analytics row per 10-minute slot
SAMPLES_PER_WINDOW = 3          # 3 x 10 min = 30-minute window
MAX_READING_AGE_SEC = 120       # a sample older than this counts as "sensor not responding"
# Ambient (barn) temperature: the DHT22 first. When the DHT22 has no good reading
# for MAX_READING_AGE_SEC (not answering, or out of range), the thermal camera's
# background temperature (median of the thermal image) is used instead, together
# with the last good DHT22 humidity (if it is not older than this):
AMBIENT_HUMIDITY_MAX_AGE_SEC = 60 * 60

# What goes into public.environment (the dashboard's temperature/humidity chart):
#   "every_reading" = every line the Arduino sends (live chart, like bridge.py did)
#   "every_sample"  = only the 10-minute samples
#   "off"           = nothing
ENVIRONMENT_LOG = "every_reading"
ENVIRONMENT_EVERY_SEC = 10      # with "every_reading": save at most one row this often

# Thermal camera (MLX90640 through the Uno)
THERMAL_EMISSIVITY = 0.98       # bare skin
# The thermal image is never flipped: it is used exactly as the camera sends it
# (HEATTRACK_THERMAL_FLIP in .env is ignored)
THERMAL_FLIP_H = False
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

# If it outputs words, they are translated to the 4-level scale the dashboard
# expects (LOW / MODERATE / HIGH / CRITICAL).
TEXT_SEVERITY = {
    "LOW": "LOW", "NORMAL": "LOW", "NONE": "LOW", "NO STRESS": "LOW", "SAFE": "LOW",
    "MODERATE": "MODERATE", "MILD": "MODERATE", "CAUTION": "MODERATE", "ALERT": "MODERATE",
    "HIGH": "HIGH", "SEVERE": "HIGH", "DANGER": "HIGH", "WARNING": "HIGH",
    "CRITICAL": "CRITICAL", "EXTREME": "CRITICAL", "EMERGENCY": "CRITICAL", "VERY SEVERE": "CRITICAL",
}

# Severity -> the `status` column the dashboard reads (NORMAL / MILD / HEAT STRESS)
STATUS_FROM_SEVERITY = {
    "LOW": "NORMAL",
    "MODERATE": "MILD",
    "HIGH": "HEAT STRESS",
    "CRITICAL": "HEAT STRESS",
}

HEADERS = {"apikey": SUPABASE_KEY}
if SUPABASE_KEY and not SUPABASE_KEY.startswith("sb_"):
    HEADERS["Authorization"] = f"Bearer {SUPABASE_KEY}"   # legacy anon key (JWT)

DRY_RUN = False   # set from --dry-run


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


# ======================= Supabase (device API key) =======================
# Every upload goes through a database function that checks this device's API
# key (stored hashed in public.devices) and files the data under the account
# that claimed the device. No secret key is needed or wanted on this computer.

# Problems an admin can fix in Supabase or .env: rows are kept and sent again later
FIXABLE = ("Could not find the function", "PGRST202", "schema cache", "Unauthorized device",
           "does not exist", "permission denied")


class DeviceRejected(Exception):
    """Supabase refused an upload. keep=True: worth sending again later."""

    def __init__(self, message, keep=False):
        super().__init__(message)
        self.keep = keep


def check_settings():
    """Stop with a clear message if the device settings are missing or unsafe."""
    missing = [name for name, value in (
        ("HEATTRACK_SUPABASE_URL", SUPABASE_URL),
        ("HEATTRACK_SUPABASE_KEY", SUPABASE_KEY),
        ("HEATTRACK_DEVICE_ID", DEVICE_CODE),
        ("HEATTRACK_DEVICE_API_KEY", DEVICE_API_KEY),
    ) if not value]
    if missing:
        where = ENV_FILE if ENV_LOADED else f"{ENV_FILE} (not found)"
        sys.exit("Missing settings: " + ", ".join(missing) + f"\nAdd them to {where}.")
    if not re.fullmatch(r"HT-PDCK-\d{3}", DEVICE_CODE) or DEVICE_CODE == "HT-PDCK-000":
        sys.exit(f"HEATTRACK_DEVICE_ID should look like HT-PDCK-001 (got {DEVICE_CODE!r}).")
    if SUPABASE_KEY.startswith("sb_secret_") or _is_service_role_jwt(SUPABASE_KEY):
        sys.exit("HEATTRACK_SUPABASE_KEY is a SECRET key. Use the publishable (anon) key: this device "
                 "only needs its own API key, and a secret key here could expose every account.")
    if os.environ.get("HEATTRACK_SUPABASE_SECRET_KEY"):
        log("NOTE: .env still has HEATTRACK_SUPABASE_SECRET_KEY. It isn't used anymore; "
            "delete that line so the secret key isn't stored on this computer.")


def _is_service_role_jwt(key):
    try:
        import base64
        payload = key.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("role") == "service_role"
    except Exception:
        return False


def rpc(fn, args):
    """Call a Supabase database function with this device's API key."""
    if DRY_RUN:
        log(f"DRY RUN -> {fn}: {json.dumps(args, default=str)}")
        return None
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/{fn}",
        headers={**HEADERS, "Content-Type": "application/json"},
        json={**args, "p_api_key": DEVICE_API_KEY},
        timeout=15,
    )
    if r.status_code >= 500:
        r.raise_for_status()              # server trouble: treated like being offline
    if r.status_code >= 400:
        try:
            info = r.json()
            message = info.get("message") or r.text
            if info.get("code"):
                message = f"{message} [{info['code']}]"
        except ValueError:
            message = r.text
        raise DeviceRejected(message, keep=any(k in message for k in FIXABLE))
    return r.json() if r.content else None


def _explain(fn, message):
    if "Could not find the function" in message or "PGRST202" in message:
        log(f"Supabase has no matching {fn}() yet: run heattrack_device_ingest.sql in the "
            f"Supabase SQL Editor. The data is kept and sent again afterwards.")
    elif "Unauthorized device" in message:
        log("Supabase doesn't recognise HEATTRACK_DEVICE_API_KEY. Check the key in .env "
            "(the data is kept and sent again once it's right).")


def insert_reading(temp, hum):
    if not OWNER_ACTIVE:
        return
    rpc("ingest_environment", {"p_temperature": temp, "p_humidity": hum,
                               "p_batch_count": BATCH_COUNT, "p_recorded_at": now_iso()})


def _legacy_item(item):
    """Queue entries written by the secret-key version: analytics rows are
    converted, anything else is dropped."""
    if item.get("table") != "analytics":
        return None
    row = item.get("row") or {}
    return {"fn": "ingest_analytics", "args": {
        "p_status": row.get("status"), "p_severity": row.get("severity"),
        "p_lowest_body_temperature": row.get("lowest_body_temperature"),
        "p_highest_body_temperature": row.get("highest_body_temperature"),
        "p_average_body_temperature": row.get("average_body_temperature"),
        "p_duck_count": row.get("duck_count"), "p_batch_count": None,
        "p_recorded_at": row.get("timestamp"), "p_interval_minutes": row.get("interval_minutes"),
        "p_record_key": row.get("record_key") or row.get("batch_count"),
    }}


def flush_pending():
    """Send uploads saved while offline (or while Supabase needed fixing)."""
    if not PENDING_FILE.exists():
        return
    lines = [l for l in PENDING_FILE.read_text().splitlines() if l.strip()]
    sent = dropped = 0
    for i, line in enumerate(lines):
        try:
            item = json.loads(line)
        except ValueError:
            dropped += 1
            continue
        if "fn" not in item:
            item = _legacy_item(item)
            if item is None:
                dropped += 1
                continue
        try:
            rpc(item["fn"], item["args"])
            sent += 1
        except DeviceRejected as e:
            if e.keep:                     # still needs fixing: keep this and the rest
                PENDING_FILE.write_text("\n".join(lines[i:]) + "\n")
                return
            log(f"Dropped a queued {item['fn']} upload: {e}")
            dropped += 1
        except requests.RequestException:
            PENDING_FILE.write_text("\n".join(lines[i:]) + "\n")
            return
    PENDING_FILE.unlink()
    if sent or dropped:
        log(f"Queued uploads: {sent} sent" + (f", {dropped} dropped" if dropped else ""))


def insert_or_queue(fn, args):
    """Upload now, or keep it for later. The API key is never written to the
    queue file (it's added again when the upload is sent)."""
    def queue():
        with PENDING_FILE.open("a") as f:
            f.write(json.dumps({"fn": fn, "args": args}, default=str) + "\n")
    try:
        flush_pending()
        rpc(fn, args)
        return True
    except DeviceRejected as e:
        print(f"Supabase said: {e}")
        if "not linked" in str(e):
            _device_unlinked()
            return False
        if e.keep:
            _explain(fn, str(e))
            queue()
        else:
            log(f"Supabase refused the {fn} upload: {e}")
        return False
    except requests.RequestException as e:
        log(f"Could not reach Supabase ({e}); saved the {fn} upload for later")
        queue()
        return False


# ---- Local IP + Wi-Fi name -> devices.local_ip / wifi_name (for SSH) ----
NETWORK_CHECK_SEC = 60


def current_network():
    """(local IPv4 used for the internet, Wi-Fi name or None)."""
    import socket
    ip = None
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))          # no data is sent; picks the outgoing interface
            ip = s.getsockname()[0]
    except OSError:
        pass
    wifi = None
    if os.name == "nt":
        try:
            out = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True,
                                 text=True, errors="ignore", timeout=10,
                                 creationflags=0x08000000).stdout
            m = re.search(r"^\s*SSID\s*:\s*(.+)$", out, re.M)
            wifi = m.group(1).strip() if m else None
        except (OSError, subprocess.SubprocessError):
            pass
    return ip, wifi


def network_reporter():
    """Report the local IP / Wi-Fi to Supabase at start and whenever they change."""
    def work():
        sent = None
        while True:
            ip, wifi = current_network()
            if ip and (ip, wifi) != sent:
                try:
                    rpc("update_device_network", {"p_local_ip": ip, "p_wifi_name": wifi})
                    log(f"Network: local IP {ip}" + (f" on Wi-Fi '{wifi}'" if wifi else "") + " (saved to Supabase)")
                    sent = (ip, wifi)
                except DeviceRejected as e:
                    if "Could not find the function" in str(e) or "PGRST202" in str(e):
                        log(f"Network: local IP {ip}" + (f" on Wi-Fi '{wifi}'" if wifi else "")
                            + " (run device_network.sql in Supabase to save it there)")
                        sent = (ip, wifi)
                    else:
                        log(f"Could not save the local IP: {e}")
                except requests.RequestException:
                    pass                          # offline: try again next round
            time.sleep(NETWORK_CHECK_SEC)
    if not DRY_RUN:
        threading.Thread(target=work, daemon=True).start()


def publish_stream_url(url):
    """Tell the website where this device's live video is (None = offline)."""
    try:
        rpc("update_device_url", {"p_url": url})
    except DeviceRejected as e:
        print(f"Could not save the stream address: {e}")
        _explain("update_device_url", str(e))
    except requests.RequestException as e:
        print(f"Could not save the stream address: {e}")


# ======================= Device check =======================
# Which account owns this device is decided in Supabase from the API key:
# device_whoami() says which device the key belongs to and whether an account
# has claimed it. Until one has, nothing is uploaded and the logger waits.

OWNER_POLL_SEC = 30             # how often to check while the device is unclaimed
OWNER_REMIND_SEC = 10 * 60      # repeat the "waiting" message this often
OWNER_ACTIVE = True             # False while no account owns this device: nothing is uploaded
_waiting = threading.Lock()


def device_whoami():
    """{'device_code': ..., 'linked': bool} or None if the key is unknown.
    Raises requests.RequestException when Supabase can't be reached."""
    info = rpc("device_whoami", {})
    if isinstance(info, list):            # set-returning version of the function
        info = info[0] if info else None
    return info


def verify_device(wait=True):
    """Run before anything else starts. Returns True once the device is
    linked (or Supabase can't be reached right now)."""
    reminded = 0.0
    while True:
        try:
            info = device_whoami()
        except DeviceRejected as e:
            if "Could not find the function" in str(e) or "PGRST202" in str(e):
                sys.exit("Supabase has no device_whoami() function. Run heattrack_devices.sql and "
                         "heattrack_device_ingest.sql in the Supabase SQL Editor first.")
            sys.exit(f"Supabase refused the device check: {e}")
        except requests.RequestException as e:
            log(f"Could not reach Supabase to check the device ({e}); continuing, uploads are queued")
            return True
        if not info:
            sys.exit("HEATTRACK_DEVICE_API_KEY is not registered in Supabase (devices table). "
                     "Check the key in .env.")
        if str(info.get("device_code", "")).upper() != DEVICE_CODE:
            sys.exit(f"This API key belongs to {info.get('device_code')}, but HEATTRACK_DEVICE_ID "
                     f"is {DEVICE_CODE}. Fix one of them in .env.")
        if info.get("linked"):
            log(f"Device {DEVICE_CODE} is linked to an account: uploads go to that account")
            return True
        if not wait:
            log(f"Device {DEVICE_CODE} has no owner yet")
            return False
        if time.time() - reminded >= OWNER_REMIND_SEC:
            log(f"Device {DEVICE_CODE} has no owner yet. Nothing is uploaded until someone signs up "
                f"on the HeatTrack website with {DEVICE_CODE} and its API key; checking every "
                f"{OWNER_POLL_SEC} s.")
            reminded = time.time()
        time.sleep(OWNER_POLL_SEC)


def _device_unlinked():
    """Supabase says no account owns this device (anymore): pause uploads
    and resume as soon as one does."""
    global OWNER_ACTIVE
    if not OWNER_ACTIVE or _waiting.locked():
        return
    OWNER_ACTIVE = False
    log(f"Device {DEVICE_CODE} is no longer linked to an account; uploads paused until it is claimed")

    def work():
        global OWNER_ACTIVE
        with _waiting:
            verify_device(wait=True)
            OWNER_ACTIVE = True
            log("Uploads resumed")
    threading.Thread(target=work, daemon=True).start()


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

            if WEBCAM_FLIP in _FLIP_CODES:          # HEATTRACK_WEBCAM_FLIP
                frame = cv2.flip(frame, _FLIP_CODES[WEBCAM_FLIP])

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

    # Box colors (BGR) follow each duck's status, same thresholds as the Status &
    # Severity levels and the website (LIVE_TEMP_LEVELS in script.js):
    # green Low (35.7 C or below), yellow Moderate (above 35.7), orange High
    # (above 43.6), red Critical (above 44.9)
    STATUS_COLORS = {"normal": (128, 222, 74), "mild": (36, 191, 251),
                     "moderate": (22, 115, 249), "severe": (68, 68, 239)}
    NO_READING_COLOR = (160, 160, 160)   # grey: no body temperature for this duck
    MILD_C, MODERATE_C, SEVERE_C = 35.7, 43.6, 44.9

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
                status = ("severe" if t > self.SEVERE_C else "moderate" if t > self.MODERATE_C
                          else "mild" if t > self.MILD_C else "normal")
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
            if OWNER_ACTIVE and not DRY_RUN:
                log(f"{temp:.1f}°C  {hum:.1f}%  saved")
        except DeviceRejected as e:
            if "not linked" in str(e):
                _device_unlinked()
            else:
                log(f"Sensor reading refused: {e}")
                _explain("ingest_environment", str(e))
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
        self._last_humidity = None        # (humidity, time) of the last good DHT22 reading
        self.ambient_source = "dht22"     # "dht22" | "thermal" | None (shown in the log and /stats)
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
            self._last_humidity = (d.humidity_pct, time.time())
            if self._air_peak is None or d.temperature_c > self._air_peak[0]:
                self._air_peak = (d.temperature_c, d.humidity_pct)
        self._note_ambient_source("dht22")
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
                        self._thermal_ambient_tick()
                    if cam is None and now >= self._next_thermal_try:
                        self._next_thermal_try = now + 60
                        cam = self._start_thermal(bridge)
                    if cam is None:
                        time.sleep(0.2)
                        continue
                    air = self.read_dht()        # reflected temperature: DHT22 only
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

    def read_dht(self):
        """Newest DHT22 (temp, hum), or None if it hasn't answered recently."""
        with self.lock:
            if self.latest is None or time.time() - self.latest[2] > MAX_READING_AGE_SEC:
                return None
            return self.latest[0], self.latest[1]

    def thermal_ambient(self):
        """Background temperature of the newest thermal frame (median of all
        pixels, so a few warm ducks hardly move it), or None."""
        with self.lock:
            frame, at = self.frame, self._last_frame_at
        if frame is None or not at or time.time() - at > 10:
            return None
        return round(float(np.median(frame)), 2)

    def _note_ambient_source(self, source):
        if source != self.ambient_source:
            if source == "thermal":
                log("DHT22 has no good reading: ambient temperature now from the thermal camera "
                    "(background of the thermal image), humidity = last good DHT22 value")
            elif source == "dht22":
                log("DHT22 is back: ambient temperature from the DHT22 again")
            else:
                log("No ambient temperature: DHT22 not responding and no thermal frame/humidity to fall back on")
            self.ambient_source = source

    def read(self):
        """Ambient (temp, hum): the DHT22 when it has a good recent reading; otherwise
        the thermal camera's background temperature with the last good DHT22
        humidity. None when neither is available."""
        dht = self.read_dht()
        if dht is not None:
            return dht
        ambient = self.thermal_ambient()
        with self.lock:
            hum = self._last_humidity
        if ambient is not None and hum and time.time() - hum[1] <= AMBIENT_HUMIDITY_MAX_AGE_SEC:
            self._note_ambient_source("thermal")
            return ambient, hum[0]
        self._note_ambient_source(None)
        return None

    def _thermal_ambient_tick(self):
        """While the DHT22 is out: keep the air peak and the environment chart
        going with the thermal-camera ambient temperature."""
        if self.read_dht() is not None:
            return
        air = self.read()
        if air is None:
            return
        with self.lock:
            if self._air_peak is None or air[0] > self._air_peak[0]:
                self._air_peak = (air[0], air[1])
        if ENVIRONMENT_LOG == "every_reading" and time.time() - self._last_env_save >= ENVIRONMENT_EVERY_SEC:
            self._last_env_save = time.time()
            save_environment_async(air[0], air[1])

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
        body = SEVERITY_TEMPERATURE != "air"
        print(f"\nSeverity uses: {'BODY temperature (thermal camera)' if body else 'AIR temperature (DHT22)'}"
              " + humidity (DHT22)")
        print("Sample predictions (temp °C, humidity %):")
        samples = ([(38, 60), (39, 70), (40, 70), (41, 75), (42, 80), (43, 85)] if body
                   else [(28, 60), (32, 70), (35, 75), (38, 80), (41, 85)])
        for t, h in samples:
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
    if not samples and SEVERITY_METHOD == "model":
        log(f"{label}: no air temperature/humidity reading; nothing saved")
        return None

    # Highest air temperature in the period, with the humidity read at that moment
    peak = max(samples, key=lambda s: s["temperature"]) if samples else None

    # Highest body temperature that held for CONFIRM_SECONDS; falls back to the raw max
    highest = max(h[0] for h in highs) if highs else max(temps)

    if SEVERITY_METHOD == "model":
        # Severity model: body (thermal camera) or air (DHT22) temperature + DHT22 humidity
        if SEVERITY_TEMPERATURE == "air":
            model_temp, source = peak["temperature"], "air (DHT22)"
        else:
            model_temp, source = highest, "body (thermal camera)"
        severity, raw = model.predict(model_temp, peak["humidity"])
        how = f"model: {source} {model_temp:.1f}°C + {peak['humidity']:.1f}%"
    elif SEVERITY_METHOD == "thi":
        # Body-area temperature level, raised or lowered one level by the DHT22's THI
        severity, how = rate_thi(highest, peak["temperature"] if peak else None,
                                 peak["humidity"] if peak else None)
    elif SEVERITY_METHOD == "combined":
        # Thermal camera (starting level) + DHT22 (THI and the trained model) together
        severity, how = rate_combined(highest, peak["temperature"] if peak else None,
                                      peak["humidity"] if peak else None, model)
    else:
        # MAIN: Thermal Color Spectrum band of the highest body temperature (thermal camera)
        severity = body_severity = severity_from_spectrum(highest)
        how = f"severity levels: body {highest:.1f}°C = {body_severity}"
        # SUPPORT: DHT22 environment rating; a hotter/more humid environment raises
        # the result by one level at most, and never lowers it
        if SEVERITY_METHOD != "spectrum" and peak is not None:
            try:
                env_severity, _ = model.predict(peak["temperature"], peak["humidity"])
                how += f"; DHT22 {peak['temperature']:.1f}°C / {peak['humidity']:.1f}% = {env_severity}"
                b, e = SEVERITY_ORDER.index(body_severity), SEVERITY_ORDER.index(env_severity)
                if e > b:
                    severity = SEVERITY_ORDER[min(b + 1, len(SEVERITY_ORDER) - 1)]
                    how += " (raised one level)"
            except Exception as err:          # model problem: keep the body temperature result
                how += f"; DHT22 support skipped ({err})"
        elif SEVERITY_METHOD != "spectrum":
            how += "; no DHT22 reading, body temperature only"
    # Status: thermal camera only (the body-area temperature level). With "thi" the
    # severity can differ by one level (the DHT22's THI); the other methods keep
    # the status that goes with their severity.
    if SEVERITY_METHOD == "thi":
        status = STATUS_FROM_SEVERITY[severity_from_spectrum(highest)]
    else:
        status = STATUS_FROM_SEVERITY[severity]
    air = f"air {peak['temperature']:.1f}°C / {peak['humidity']:.1f}%" if peak else "no air reading"
    log(f"{label}: highest body {highest:.1f}°C ({len(temps)} readings, peak {peak_count} duck(s){note}); "
        f"{air}; {how} -> severity {severity}, status {status} (thermal)")

    # Timestamped at the slot's / window's own mark (also for rows saved late)
    now = datetime.fromtimestamp(at, timezone.utc) if at else datetime.now(timezone.utc)
    # Arguments for ingest_analytics(); Supabase fills in the account and device
    return {
        "p_status": status,
        "p_severity": severity,
        "p_lowest_body_temperature": round(min(temps), 2),
        "p_highest_body_temperature": round(highest, 2),
        "p_average_body_temperature": round(sum(temps) / len(temps), 2),
        "p_duck_count": peak_count,
        "p_batch_count": None,                  # numbered 1, 2, 3 ... by the database
        "p_recorded_at": now.isoformat(),
        "p_interval_minutes": interval_minutes,
        # This row's own unique ID, so a row sent twice is never saved twice
        "p_record_key": f"{DEVICE_CODE}-{now:%Y%m%d-%H%M%S}-{interval_minutes}m",
    }


def save_analytics(args):
    if args:
        insert_or_queue("ingest_analytics", args)


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
        "version": 1, "interval": interval, "device_id": DEVICE_CODE,
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
    if data.get("version") != 1 or data.get("interval") != interval or data.get("device_id") != DEVICE_CODE:
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
    p.add_argument("--check", action="store_true", help="only check the settings and the device key")
    args = p.parse_args()

    if args.inspect:
        SeverityModel(args.severity_model).describe()
        return

    prepare_data_dir()
    log(f"Data files (slot_log.csv, pending_rows.jsonl, logs): {DATA_DIR}")
    if ENV_LOADED:
        log(f"Settings from {ENV_FILE.name}: device {DEVICE_CODE}, serial {SERIAL_PORT}, camera {CAMERA_INDEX}")
    else:
        log(f"WARNING: no {ENV_FILE.name} found in {ENV_FILE.parent}; using built-in defaults "
            f"(device {DEVICE_CODE}, serial {SERIAL_PORT}, camera {CAMERA_INDEX})")

    # Fake data must never reach the real account
    if args.simulate and not args.dry_run:
        log("--simulate implies --dry-run: nothing will be saved")
    DRY_RUN = (args.dry_run or args.simulate) and not args.check
    if args.check:
        # Used by install_heattrack.ps1: settings + device key, then stop
        check_settings()
        linked = verify_device(wait=False)
        print("CHECK OK" + ("" if linked else " (device not linked to an account yet)"))
        return
    if DRY_RUN:
        log("Test mode: nothing is uploaded")
    else:
        check_settings()
        verify_device(wait=True)

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
    network_reporter()

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
