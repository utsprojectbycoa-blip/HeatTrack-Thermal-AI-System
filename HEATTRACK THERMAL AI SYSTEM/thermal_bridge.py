"""
thermal_bridge.py - mini PC side of the Arduino Uno sensor bridge.

The Uno forwards raw I2C traffic between this PC and the MLX90640, and
reads the DHT22. This module:
  * SerialI2C  - looks like a CircuitPython I2C bus but talks to the Uno,
                 so Adafruit's tested MLX90640 driver runs unchanged on the PC
  * ThermalCamera - reads 24x32 temperature frames (deg C) with configurable
                 emissivity and reflected temperature
  * read_dht22 - air temperature and relative humidity

Install:  pip install pyserial numpy adafruit-circuitpython-mlx90640
"""

import struct
import threading
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np
import serial

import adafruit_mlx90640

REQ_START = 0xA5
RESP_START = 0x5A
MLX_ADDRESS = 0x33
STATUS_TEXT = {
    1: "I2C data too long",
    2: "I2C address not acknowledged (check wiring/power)",
    3: "I2C data not acknowledged",
    4: "I2C bus error",
    5: "I2C bus stuck (timeout): SDA/SCL miswired, shorted, or the camera has no power",
    10: "bad request",
    11: "short I2C read",
    12: "DHT22 read failed",
}


class BridgeError(OSError):
    """Raised for any bridge or I2C failure (OSError so the driver's
    device probe behaves the same as on a real I2C bus)."""


class UnoBridge:
    """Low-level request/response link to duck_sensor_bridge.ino."""

    def __init__(self, port: str, baud: int = 500000, timeout: float = 1.0):
        self.ser = serial.Serial(port, baud, timeout=timeout)
        self.lock = threading.Lock()
        time.sleep(2.0)  # opening the port resets the Uno; wait for boot
        self.ser.reset_input_buffer()
        self.request("P")

    def close(self) -> None:
        self.ser.close()

    def _read_exact(self, n: int) -> bytes:
        data = self.ser.read(n)
        if len(data) != n:
            raise BridgeError(f"Uno did not answer (got {len(data)}/{n} bytes)")
        return data

    def request(self, cmd: str, addr: int = 0, out: bytes = b"", in_len: int = 0) -> bytes:
        if len(out) > 8:
            raise BridgeError("outgoing I2C data longer than 8 bytes")
        packet = bytes([REQ_START, ord(cmd), addr, len(out)]) + bytes(out) + struct.pack(">H", in_len)
        with self.lock:
            self.ser.write(packet)
            start = self._read_exact(1)[0]
            if start != RESP_START:
                self.ser.reset_input_buffer()
                raise BridgeError("serial stream out of sync")
            (length,) = struct.unpack(">H", self._read_exact(2))
            data = self._read_exact(length) if length else b""
            status, checksum = self._read_exact(2)
        if status != 0:
            raise BridgeError(STATUS_TEXT.get(status, f"bridge error {status}"))
        if checksum != sum(data) & 0xFF:
            raise BridgeError("checksum mismatch")
        return data


class SerialI2C:
    """Minimal stand-in for busio.I2C, routed through the Uno."""

    def __init__(self, bridge: UnoBridge):
        self.bridge = bridge
        self._locked = False

    def try_lock(self) -> bool:
        if self._locked:
            return False
        self._locked = True
        return True

    def unlock(self) -> None:
        self._locked = False

    def writeto(self, address, buffer, *, start=0, end=None):
        out = bytes(buffer[start:end])
        self.bridge.request("W", address, out)

    def readfrom_into(self, address, buffer, *, start=0, end=None):
        end = len(buffer) if end is None else end
        data = self.bridge.request("R", address, b"", end - start)
        buffer[start:end] = data

    def writeto_then_readfrom(self, address, buffer_out, buffer_in, *,
                              out_start=0, out_end=None, in_start=0, in_end=None):
        out = bytes(buffer_out[out_start:out_end])
        in_end = len(buffer_in) if in_end is None else in_end
        data = self.bridge.request("X", address, out, in_end - in_start)
        buffer_in[in_start:in_end] = data


@dataclass
class DhtReading:
    temperature_c: float
    humidity_pct: float
    timestamp: float


# Camera refresh setting (sub-pages per second) -> MLX90640 register code
REFRESH_CODES = {0.5: 0, 1: 1, 2: 2, 4: 3, 8: 4, 16: 5, 32: 6, 64: 7}


class ThermalCamera:
    """MLX90640 read through the Uno. Frames are numpy arrays of shape
    (24, 32) in deg C, row 0 at the top as the sensor sees it.

    The sensor measures in two halves ("sub-pages", a chessboard of pixels).
    After the first frame, every read_frame() waits for just ONE new half and
    returns the full image (half the pixels fresh, half one sub-page older),
    so the image updates at the sub-page rate: refresh_hz times per second."""

    ROWS, COLS = 24, 32

    def __init__(self, bridge: UnoBridge, emissivity: float = 0.98,
                 refresh_hz: float = 8,
                 flip_horizontal: bool = False, flip_vertical: bool = False):
        if refresh_hz not in REFRESH_CODES:
            raise ValueError(f"refresh_hz must be one of {sorted(REFRESH_CODES)}")
        self.bus = SerialI2C(bridge)
        # Reads the sensor's EEPROM and extracts calibration (takes a few seconds)
        self.mlx = adafruit_mlx90640.MLX90640(self.bus, MLX_ADDRESS)
        # 8 Hz = up to 8 image updates/s; the Uno link manages about that.
        # Higher rates add sensor noise and the Uno can't keep up beyond ~8.
        self.mlx.refresh_rate = REFRESH_CODES[refresh_hz]
        self._primed = False
        self.emissivity = emissivity
        self.flip_horizontal = flip_horizontal
        self.flip_vertical = flip_vertical
        self._raw = [0] * 834
        self._buf = [0.0] * 768

    def read_frame(self, reflected_temp_c: Optional[float] = None) -> np.ndarray:
        """Return the newest full image. The first call reads both sub-pages;
        later calls wait for one new sub-page (half the pixels refresh).

        reflected_temp_c: temperature of the surroundings reflecting off the
        duck; pass the DHT22 air temperature. If None, uses the sensor's
        own ambient estimate minus the open-air shift (Adafruit default).
        """
        for _ in range(1 if self._primed else 2):
            if self.mlx._GetFrameData(self._raw) < 0:
                raise RuntimeError("frame data error")
            if reflected_temp_c is None:
                tr = self.mlx._GetTa(self._raw) - adafruit_mlx90640.OPENAIR_TA_SHIFT
            else:
                tr = reflected_temp_c
            self.mlx._CalculateTo(self._raw, self.emissivity, tr, self._buf)
        self._primed = True

        frame = np.array(self._buf, dtype=np.float32).reshape(self.ROWS, self.COLS)
        # Pixels marked defective at the factory come back as -273.15 C:
        # fill each with the average of its working neighbours
        bad = frame < -200
        if bad.any():
            for r, c in zip(*np.nonzero(bad)):
                patch = frame[max(r - 1, 0):r + 2, max(c - 1, 0):c + 2]
                good = patch[patch > -200]
                frame[r, c] = good.mean() if good.size else np.median(frame[~bad])
        if self.flip_horizontal:
            frame = frame[:, ::-1]
        if self.flip_vertical:
            frame = frame[::-1, :]
        return frame.copy()


def read_dht22(bridge: UnoBridge) -> DhtReading:
    data = bridge.request("H", in_len=5)
    ok, t_x10, h_x10 = struct.unpack(">BhH", data)
    if not ok:
        raise BridgeError("DHT22 read failed")
    return DhtReading(t_x10 / 10.0, h_x10 / 10.0, time.time())