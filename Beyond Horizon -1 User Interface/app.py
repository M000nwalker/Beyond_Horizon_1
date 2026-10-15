"""
Alt-Azimuth Telescope Mount Central Hub Backend
FastAPI server coordinating Stellarium HTTP API, LAN HTTP Target Transmitter,
Interactive Pannable Sky Map, Degree Telemetry, and Real-Time Active Sidereal Target Tracking.
"""

import asyncio
import math
import os
import sys
import time
import threading
from typing import Optional, List

import requests
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Initialize FastAPI App
app = FastAPI(title="Telescope Mount Control System", version="2.0.0")

# Mount Independent Canon EOS 60D Camera Control Router
try:
    from camera_backend import camera_router
    app.include_router(camera_router)
    print("[SYSTEM HUB] Independent Canon EOS 60D Camera Module mounted successfully.")
except Exception as e:
    print(f"[SYSTEM HUB] Warning: Failed to mount camera module: {e}")

# Enable CORS for local and network access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# ESP HARDWARE CONFIGURATION
# Edit the ESP_IP variable below whenever your ESP device's IP address changes.
# Every reference across Python, HTML, JS, and CSS will update dynamically from this single variable.
# =============================================================================
ESP_IP = "10.82.105.224"


# Global State Container
class SystemState:
    def __init__(self):
        # Stellarium API configuration
        self.stellarium_url = "http://localhost:8090"
        self.stellarium_connected = False

        # Telescope Telemetry in Explicit Degrees
        self.current_alt = 0.0
        self.current_az = 0.0
        self.target_alt = 0.0
        self.target_az = 0.0
        self.target_name = "None"
        self.is_calibrated = False
        self.calibration_mode = "NONE"
        self.calibrated_target_name = "Uncalibrated"

        # Real-Time Sidereal Tracking State
        self.tracking_enabled = False
        self.tracking_task: Optional[asyncio.Task] = None
        self.last_track_time = time.time()

        # Observer Site Data
        self.latitude = 23.8103
        self.longitude = 90.4125
        self.elevation = 15.0

        # Lock for thread safety
        self.lock = threading.Lock()

    @property
    def esp_ip(self) -> str:
        return ESP_IP

    @property
    def lan_target_url(self) -> str:
        return f"http://{ESP_IP}/target"

state = SystemState()

# Pydantic Request Schemas
class LocationSyncRequest(BaseModel):
    latitude: float
    longitude: float
    elevation: float
    timestamp: Optional[float] = None

class TargetSearchRequest(BaseModel):
    query: str

class GoToRequest(BaseModel):
    alt: float
    az: float
    target_name: Optional[str] = "Selected Target"

class SlewRequest(BaseModel):
    direction: str  # '+ALT', '-ALT', '+AZ', '-AZ', 'STOP'
    speed: float = 1.0

class MultiModeCalibrateRequest(BaseModel):
    mode: str  # 'OBJECT', 'CARDINAL', 'MANUAL'
    object_name: Optional[str] = None
    cardinal_dir: Optional[str] = None  # 'NORTH', 'EAST', 'SOUTH', 'WEST'
    elevation_preset: Optional[str] = None  # 'HORIZON', 'ZENITH'
    alt: Optional[float] = None
    az: Optional[float] = None

class TrackingToggleRequest(BaseModel):
    enable: bool


def send_lan_target_request(delta_alt: float, delta_az: float, target_alt: float = 0.0, target_az: float = 0.0) -> dict:
    """
    Transmits relative delta coordinates in degrees to the ESP endpoint:
    http://<ESP_IP>/target?alt={delta_alt}&az={delta_az}
    The ESP receives delta coordinates only (destination is not needed by ESP).
    Returns a safe dict regardless of ESP connectivity — never raises.
    """
    url = f"{state.lan_target_url}?alt={delta_alt:.4f}&az={delta_az:.4f}"
    console_output = f"[LAN HTTP TRANSMIT] >>> GET {url} (delta_alt={delta_alt:+.4f}°, delta_az={delta_az:+.4f}° | Target: Alt {target_alt:.3f}°, Az {target_az:.3f}°)"
    print(console_output, flush=True)

    try:
        res = requests.get(url, timeout=2.5)
        is_ok = 200 <= res.status_code < 300
        return {
            "status": "sent" if is_ok else "http_error",
            "url": url,
            "http_code": res.status_code,
            "response_text": res.text[:200] if res.text else "",
            "delta_alt": round(delta_alt, 4),
            "delta_az": round(delta_az, 4),
            "target_alt": round(target_alt, 3),
            "target_az": round(target_az, 3)
        }
    except BaseException as e:
        # Catches requests.exceptions.Timeout, ConnectionError, OSError, and any other error
        # so that an unreachable ESP never propagates an exception into endpoint handlers.
        err_type = type(e).__name__
        print(f"[LAN HTTP TRANSMIT ERROR] {err_type}: Could not reach ESP at {state.esp_ip} — {e}. Request logged: {url}", flush=True)
        return {
            "status": "esp_offline",
            "url": url,
            "error": f"{err_type}: {e}",
            "delta_alt": round(delta_alt, 4),
            "delta_az": round(delta_az, 4),
            "target_alt": round(target_alt, 3),
            "target_az": round(target_az, 3)
        }


def send_lan_calibrate_request(cal_alt: float, cal_az: float) -> dict:
    """
    Informs the ESP of calibration position without commanding stepper motor motion:
    http://<ESP_IP>/calibrate?alt={cal_alt}&az={cal_az}
    Falls back gracefully if ESP firmware only supports /target.
    """
    cal_url = f"http://{ESP_IP}/calibrate?alt={cal_alt:.3f}&az={cal_az:.3f}"
    print(f"[LAN HTTP CALIBRATE] >>> GET {cal_url}", flush=True)
    try:
        res = requests.get(cal_url, timeout=2.5)
        is_ok = 200 <= res.status_code < 300
        return {
            "status": "calibrated" if is_ok else "http_error",
            "url": cal_url,
            "http_code": res.status_code,
            "response_text": res.text[:200] if res.text else "",
            "calibrated_alt": round(cal_alt, 3),
            "calibrated_az": round(cal_az, 3)
        }
    except BaseException as e:
        err_type = type(e).__name__
        print(f"[LAN HTTP CALIBRATE NOTICE] ESP at {ESP_IP} ({err_type}: {e}). Position calibrated locally.", flush=True)
        return {
            "status": "local_sync",
            "url": cal_url,
            "note": f"{err_type}: {e}",
            "calibrated_alt": round(cal_alt, 3),
            "calibrated_az": round(cal_az, 3)
        }



def update_telemetry_simulation(new_alt: float, new_az: float):
    with state.lock:
        state.current_alt = new_alt
        state.current_az = new_az


def get_live_object_coords(name: str):
    """Retrieves live Alt and Az for a target by name directly from Stellarium HTTP API."""
    try:
        info_url = f"{state.stellarium_url}/api/objects/info"
        r = requests.get(info_url, params={"name": name, "format": "json"}, timeout=2.0)
        if r.status_code == 200:
            info = r.json()
            alt = info.get("altitude")
            az = info.get("azimuth")
            if alt is not None and az is not None:
                return float(alt), float(az)
    except Exception as e:
        print(f"[STELLARIUM LIVE COORDS ERROR] Could not get coords for '{name}': {e}", flush=True)
    return None


# REAL-TIME ACTIVE SIDEREAL TARGET TRACKING BACKGROUND ENGINE
async def run_active_tracking_loop():
    """
    Accumulator-based sidereal tracking loop.

    Sidereal drift is only ~0.004 deg/second. Sending that every second results in
    the ESP printing '0.00' on its serial monitor. This accumulator pattern collects
    drift across multiple ticks and only dispatches to the ESP once the accumulated
    delta exceeds MIN_SEND_THRESHOLD degrees — ensuring every packet sent is legible.
    """
    MIN_SEND_THRESHOLD = 0.001  # degrees — matches ESP 4-digit hardware minimum (0.001°)

    acc_alt = 0.0
    acc_az  = 0.0
    new_target_alt = 0.0
    new_target_az  = 0.0

    print("[ACTIVE TRACKING ENGINE] Started Sidereal Tracking Task (accumulator mode).", flush=True)

    while state.tracking_enabled:
        await asyncio.sleep(1.0)
        if not state.tracking_enabled:
            break

        now = time.time()
        dt = now - state.last_track_time
        state.last_track_time = now

        az_drift_deg = 0.004167 * dt  # fallback sidereal Az rate ~15 arcsec/sec

        with state.lock:
            target_name_snapshot = state.target_name

        live_coords = get_live_object_coords(target_name_snapshot)

        tick_delta_alt = 0.0
        tick_delta_az  = 0.0

        with state.lock:
            if live_coords:
                new_target_alt = live_coords[0]
                new_target_az  = live_coords[1]
            else:
                new_target_alt = state.target_alt
                new_target_az  = (state.target_az + az_drift_deg) % 360.0

            # Delta = how much mount must move this tick
            tick_delta_alt = new_target_alt - state.current_alt
            raw_tick_az    = new_target_az  - state.current_az
            tick_delta_az  = (raw_tick_az + 180.0) % 360.0 - 180.0

            # Advance internal position registers
            state.target_alt  = new_target_alt
            state.target_az   = new_target_az
            state.current_alt = new_target_alt
            state.current_az  = new_target_az

        # Add this tick to the accumulator
        acc_alt += tick_delta_alt
        acc_az  += tick_delta_az

        print(f"[TRACKING TICK] tick=({tick_delta_alt:.4f}°, {tick_delta_az:.4f}°) acc=({acc_alt:.4f}°, {acc_az:.4f}°)", flush=True)

        # Only fire LAN request when accumulated delta is large enough to matter
        if abs(acc_alt) >= MIN_SEND_THRESHOLD or abs(acc_az) >= MIN_SEND_THRESHOLD:
            send_alt = acc_alt
            send_az  = acc_az
            acc_alt  = 0.0
            acc_az   = 0.0
            print(f"[ACTIVE TRACKING] DISPATCH dAlt={send_alt:.3f}° dAz={send_az:.3f}°", flush=True)
            send_lan_target_request(delta_alt=send_alt, delta_az=send_az,
                                    target_alt=new_target_alt, target_az=new_target_az)

    print("[ACTIVE TRACKING ENGINE] Stopped Sidereal Tracking Task.", flush=True)


# STELLARIUM & SKY MAP DATA SERVICES
@app.get("/api/stellarium/status")
def get_stellarium_status():
    try:
        r = requests.get(f"{state.stellarium_url}/api/main/status", timeout=1.5)
        if r.status_code == 200:
            state.stellarium_connected = True
            return {"connected": True, "details": r.json()}
        else:
            state.stellarium_connected = False
            return {"connected": False, "status_code": r.status_code}
    except Exception as e:
        state.stellarium_connected = False
        return {"connected": False, "error": str(e)}


# Names of objects to query from Stellarium (curated list for sky map display)
STELLARIUM_SKYMAP_OBJECTS = [
    "Polaris", "Jupiter", "Mars", "Saturn", "Moon",
    "M 31", "M 42",
    "Sirius", "Vega", "Betelgeuse", "Arcturus", "Capella",
    "Aldebaran", "Antares", "Spica"
]

# Display name mapping for objects whose Stellarium catalog name differs from display name
STELLARIUM_DISPLAY_NAMES = {
    "M 31": "M31 (Andromeda)",
    "M 42": "M42 (Orion Nebula)"
}


def format_ra(ra_deg: float) -> str:
    ra_norm = (float(ra_deg) % 360.0 + 360.0) % 360.0
    ra_h = int(ra_norm / 15.0)
    ra_m = int((ra_norm / 15.0 - ra_h) * 60)
    ra_s = ((ra_norm / 15.0 - ra_h) * 60 - ra_m) * 60
    return f"{ra_h:02d}h {ra_m:02d}m {ra_s:04.1f}s"

def format_dec(dec_deg: float) -> str:
    val = float(dec_deg)
    sign = '-' if val < 0 else '+'
    abs_val = abs(val)
    d = int(abs_val)
    m = int((abs_val - d) * 60)
    s = ((abs_val - d) * 60 - m) * 60
    return f"{sign}{d:02d}° {m:02d}' {s:04.1f}\""


STAR_CATALOG = [
    # Circumpolar / North
    {"name": "Polaris", "type": "Star", "ra": 37.95, "dec": 89.26, "mag": 1.98},
    {"name": "Dubhe (Ursa Maj)", "type": "Star", "ra": 165.93, "dec": 61.75, "mag": 1.79},
    {"name": "Alioth (Ursa Maj)", "type": "Star", "ra": 193.51, "dec": 55.96, "mag": 1.77},
    {"name": "Capella", "type": "Star", "ra": 79.17, "dec": 45.99, "mag": 0.08},
    {"name": "Schedar (Cassiopeia)", "type": "Star", "ra": 10.13, "dec": 56.54, "mag": 2.24},

    # Summer / Autumn Quadrant
    {"name": "Vega", "type": "Star", "ra": 279.23, "dec": 38.78, "mag": 0.03},
    {"name": "Deneb", "type": "Star", "ra": 310.36, "dec": 45.28, "mag": 1.25},
    {"name": "Altair", "type": "Star", "ra": 297.70, "dec": 8.87, "mag": 0.77},
    {"name": "Antares", "type": "Star", "ra": 247.35, "dec": -26.43, "mag": 1.06},
    {"name": "Enif (Pegasus)", "type": "Star", "ra": 326.05, "dec": 9.87, "mag": 2.38},
    {"name": "Fomalhaut", "type": "Star", "ra": 344.41, "dec": -29.62, "mag": 1.17},

    # Winter Quadrant
    {"name": "Sirius", "type": "Star", "ra": 101.28, "dec": -16.71, "mag": -1.46},
    {"name": "Betelgeuse", "type": "Star", "ra": 88.79, "dec": 7.41, "mag": 0.50},
    {"name": "Rigel", "type": "Star", "ra": 78.63, "dec": -8.20, "mag": 0.18},
    {"name": "Aldebaran", "type": "Star", "ra": 68.98, "dec": 16.51, "mag": 0.85},
    {"name": "Procyon", "type": "Star", "ra": 114.83, "dec": 5.22, "mag": 0.34},
    {"name": "Pollux", "type": "Star", "ra": 116.33, "dec": 28.03, "mag": 1.14},

    # Spring Quadrant
    {"name": "Arcturus", "type": "Star", "ra": 213.91, "dec": 19.18, "mag": -0.05},
    {"name": "Spica", "type": "Star", "ra": 201.30, "dec": -11.16, "mag": 0.98},
    {"name": "Regulus", "type": "Star", "ra": 152.09, "dec": 11.97, "mag": 1.36},

    # Deep Sky Objects
    {"name": "M31 (Andromeda Galaxy)", "type": "Galaxy", "ra": 10.68, "dec": 41.27, "mag": 3.44},
    {"name": "M42 (Orion Nebula)", "type": "Nebula", "ra": 83.82, "dec": -5.39, "mag": 4.0},
    {"name": "M45 (Pleiades)", "type": "Cluster", "ra": 56.87, "dec": 24.11, "mag": 1.60}
]

def get_dynamic_solar_system_objects(t: float) -> List[dict]:
    d = (t - 946728000.0) / 86400.0
    jup_lon = (34.0 + 0.0831 * d) % 360.0
    sat_lon = (345.0 + 0.0334 * d) % 360.0
    mars_lon = (65.0 + 0.524 * d) % 360.0
    moon_lon = (180.0 + 13.176 * d) % 360.0

    eps = math.radians(23.44)
    bodies = [
        {"name": "Jupiter", "type": "Planet", "lon": jup_lon, "lat": 1.3, "mag": -2.2},
        {"name": "Saturn", "type": "Planet", "lon": sat_lon, "lat": -2.5, "mag": 0.7},
        {"name": "Mars", "type": "Planet", "lon": mars_lon, "lat": 1.8, "mag": 0.5},
        {"name": "Moon", "type": "Satellite", "lon": moon_lon, "lat": 5.1, "mag": -11.0}
    ]

    out = []
    for b in bodies:
        lam = math.radians(b["lon"])
        bet = math.radians(b["lat"])
        sin_dec = math.sin(bet) * math.cos(eps) + math.cos(bet) * math.sin(eps) * math.sin(lam)
        dec_rad = math.asin(max(-1.0, min(1.0, sin_dec)))

        y = math.sin(lam) * math.cos(eps) - math.tan(bet) * math.sin(eps)
        x = math.cos(lam)
        ra_rad = math.atan2(y, x)
        ra_deg = (math.degrees(ra_rad) + 360.0) % 360.0
        dec_deg = math.degrees(dec_rad)

        out.append({
            "name": b["name"],
            "type": b["type"],
            "ra": ra_deg,
            "dec": dec_deg,
            "mag": b["mag"]
        })
    return out

def calculate_catalog_positions(lat_deg: float, lon_deg: float) -> List[dict]:
    t = time.time()
    d = (t - 946728000.0) / 86400.0
    lst = (280.46061837 + 360.98564736629 * d + lon_deg) % 360.0

    results = []
    lat_rad = math.radians(lat_deg)

    all_bodies = STAR_CATALOG + get_dynamic_solar_system_objects(t)

    for item in all_bodies:
        ra_deg = item["ra"]
        dec_deg = item["dec"]

        ha = (lst - ra_deg + 360.0) % 360.0
        ha_rad = math.radians(ha)
        dec_rad = math.radians(dec_deg)

        sin_alt = math.sin(dec_rad) * math.sin(lat_rad) + math.cos(dec_rad) * math.cos(lat_rad) * math.cos(ha_rad)
        alt_rad = math.asin(max(-1.0, min(1.0, sin_alt)))
        alt_deg = math.degrees(alt_rad)

        cos_az = (math.sin(dec_rad) - math.sin(lat_rad) * sin_alt) / (math.cos(lat_rad) * math.cos(alt_rad) + 1e-9)
        cos_az = max(-1.0, min(1.0, cos_az))
        az_deg = math.degrees(math.acos(cos_az))
        if math.sin(ha_rad) > 0:
            az_deg = 360.0 - az_deg

        results.append({
            "name": item["name"],
            "type": item["type"],
            "ra_str": format_ra(ra_deg),
            "dec_str": format_dec(dec_deg),
            "altitude": round(alt_deg, 3),
            "azimuth": round(az_deg, 3),
            "magnitude": item["mag"]
        })
    return results


@app.get("/api/skymap/objects")
def get_skymap_objects():
    """Queries Stellarium HTTP API for live positions of sky map objects.
    Falls back to LST-calculated celestial catalog positions if Stellarium is offline."""
    t = time.time()

    if not state.stellarium_connected:
        try:
            r = requests.get(f"{state.stellarium_url}/api/main/status", timeout=1.2)
            if r.status_code == 200:
                state.stellarium_connected = True
        except Exception:
            state.stellarium_connected = False

    if state.stellarium_connected:
        response_list = []
        for obj_name in STELLARIUM_SKYMAP_OBJECTS:
            try:
                info_url = f"{state.stellarium_url}/api/objects/info"
                r = requests.get(info_url, params={"name": obj_name, "format": "json"}, timeout=1.5)
                if r.status_code == 200:
                    info = r.json()
                    alt = info.get("altitude")
                    az = info.get("azimuth")
                    ra = info.get("ra", 0.0)
                    dec = info.get("dec", 0.0)
                    mag = info.get("vmag", info.get("mag", 0.0))
                    obj_type = info.get("object-type", info.get("type", "Celestial Body"))
                    display_name = info.get("localized-name", STELLARIUM_DISPLAY_NAMES.get(obj_name, obj_name))

                    if alt is not None and az is not None:
                        response_list.append({
                            "name": display_name,
                            "type": obj_type,
                            "ra_str": format_ra(ra),
                            "dec_str": format_dec(dec),
                            "altitude": round(float(alt), 3),
                            "azimuth": round(float(az), 3),
                            "magnitude": round(float(mag), 3)
                        })
            except Exception:
                pass

        if response_list:
            return {
                "timestamp": t,
                "source": "stellarium_live",
                "observer": {"latitude": state.latitude, "longitude": state.longitude, "elevation": state.elevation},
                "telescope_reticle": {"altitude": round(state.current_alt, 3), "azimuth": round(state.current_az, 3)},
                "target_reticle": {"altitude": round(state.target_alt, 3), "azimuth": round(state.target_az, 3)},
                "objects": response_list
            }

    # Fallback to local astronomical LST calculation engine
    catalog_objects = calculate_catalog_positions(state.latitude, state.longitude)
    return {
        "timestamp": t,
        "source": "lst_engine_fallback",
        "observer": {"latitude": state.latitude, "longitude": state.longitude, "elevation": state.elevation},
        "telescope_reticle": {"altitude": round(state.current_alt, 3), "azimuth": round(state.current_az, 3)},
        "target_reticle": {"altitude": round(state.target_alt, 3), "azimuth": round(state.target_az, 3)},
        "objects": catalog_objects
    }


@app.post("/api/stellarium/search")
def search_stellarium_target(req: TargetSearchRequest):
    """Searches Stellarium for a target object. NO fallback — returns error if Stellarium unavailable."""
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query cannot be empty")

    # Direct coordinate search parsing (e.g., "41.2760, 107.4875" or "41.2760 107.4875")
    import re
    coord_match = re.match(r'^(?:alt[:\s]*)?(-?\d+(?:\.\d+)?)[,\s]+(?:az[:\s]*)?(-?\d+(?:\.\d+)?)$', query, re.IGNORECASE)
    if coord_match:
        try:
            parsed_alt = float(coord_match.group(1))
            parsed_az = float(coord_match.group(2))
            return {
                "found": True,
                "name": f"Coord ({parsed_alt:.4f}°, {parsed_az:.4f}°)",
                "type": "Direct Coordinates",
                "ra_str": "--",
                "dec_str": "--",
                "ra_deg": 0.0,
                "dec_deg": 0.0,
                "altitude": round(parsed_alt, 4),
                "azimuth": round(parsed_az, 4),
                "magnitude": 0.0,
                "source": "coordinate_input"
            }
        except ValueError:
            pass

    if not state.stellarium_connected:
        # Try a quick connection check
        try:
            r = requests.get(f"{state.stellarium_url}/api/main/status", timeout=1.5)
            if r.status_code == 200:
                state.stellarium_connected = True
            else:
                return {
                    "found": False,
                    "error": f"Stellarium not connected (HTTP {r.status_code}). Start Stellarium with Remote Control plugin on port 8090."
                }
        except Exception as e:
            return {
                "found": False,
                "error": f"Cannot reach Stellarium at {state.stellarium_url}: {e}"
            }

    try:
        find_url = f"{state.stellarium_url}/api/objects/find"
        r_find = requests.get(find_url, params={"str": query}, timeout=2.0)
        if r_find.status_code != 200:
            return {
                "found": False,
                "error": f"Stellarium find API returned HTTP {r_find.status_code} for query '{query}'."
            }

        find_results = r_find.json()
        if not find_results:
            return {
                "found": False,
                "error": f"No object matching '{query}' found in Stellarium's database."
            }

        target_name = find_results[0] if isinstance(find_results, list) else query
        info_url = f"{state.stellarium_url}/api/objects/info"
        r_info = requests.get(info_url, params={"name": target_name, "format": "json"}, timeout=2.0)
        if r_info.status_code != 200:
            return {
                "found": False,
                "error": f"Stellarium info API returned HTTP {r_info.status_code} for object '{target_name}'."
            }

        info = r_info.json()
        ra = info.get("ra")
        dec = info.get("dec")
        alt = info.get("altitude")
        az = info.get("azimuth")
        mag = info.get("vmag", info.get("mag", 0.0))

        if alt is None or az is None:
            return {
                "found": False,
                "error": f"Stellarium returned incomplete data for '{target_name}' (missing altitude/azimuth)."
            }

        ra_val = float(ra) if ra is not None else 0.0
        dec_val = float(dec) if dec is not None else 0.0

        return {
            "found": True,
            "name": info.get("localized-name", target_name),
            "type": info.get("object-type", info.get("type", "Celestial Body")),
            "ra_str": format_ra(ra_val),
            "dec_str": format_dec(dec_val),
            "ra_deg": round(ra_val, 4),
            "dec_deg": round(dec_val, 4),
            "altitude": round(float(alt), 4),
            "azimuth": round(float(az), 4),
            "magnitude": round(float(mag), 4),
            "source": "stellarium_live"
        }

    except Exception as e:
        print(f"[STELLARIUM SEARCH ERROR] Query for '{query}' failed: {e}", flush=True)
        state.stellarium_connected = False
        return {
            "found": False,
            "error": f"Stellarium query failed: {e}"
        }


@app.post("/api/stellarium/location")
def sync_location_to_stellarium(req: LocationSyncRequest):
    with state.lock:
        state.latitude = req.latitude
        state.longitude = req.longitude
        state.elevation = req.elevation

    payload = {
        "latitude": req.latitude,
        "longitude": req.longitude,
        "altitude": req.elevation,
        "name": "User Observer Site",
        "planet": "Earth"
    }

    results = {"browser_data": req.dict(), "stellarium_pushed": False}

    if state.stellarium_connected:
        try:
            r = requests.post(f"{state.stellarium_url}/api/location/setlocationfields", data=payload, timeout=3.0)
            if r.status_code in [200, 204]:
                results["stellarium_pushed"] = True
                results["status_code"] = r.status_code
        except Exception as e:
            results["error"] = str(e)
            print(f"[STELLARIUM LOCATION SYNC ERROR] Could not update Stellarium: {e}", flush=True)

    print(f"[GPS LOCATION SYNC] Lat: {req.latitude:.6f}, Lon: {req.longitude:.6f}, Alt: {req.elevation}m, Timestamp: {req.timestamp}", flush=True)
    return results


# HARDWARE & TELEMETRY STATUS ENDPOINT
@app.get("/api/config")
def get_system_config():
    """
    Returns the single-source-of-truth ESP hardware configuration.
    The frontend fetches this on startup so every IP reference stays in sync with
    the ESP_IP variable defined at line 48 of app.py.
    """
    return {
        "esp_ip": ESP_IP,
        "lan_target_url": f"http://{ESP_IP}/target"
    }


@app.get("/api/hardware/status")
def get_hardware_status():
    with state.lock:
        # NOTE: Do NOT snap current = target here.
        # The tracking loop manages current position correctly.
        # Snapping here destroys delta information and causes all-zero ESP transmissions.
        delta_alt = round(state.target_alt - state.current_alt, 3)
        raw_delta_az = state.target_az - state.current_az
        delta_az = round((raw_delta_az + 180.0) % 360.0 - 180.0, 3)

        return {
            "stellarium_connected": state.stellarium_connected,
            "esp_ip": ESP_IP,
            "lan_target_url": f"http://{ESP_IP}/target",
            "current_alt_deg": round(state.current_alt, 3),
            "current_az_deg": round(state.current_az, 3),
            "target_alt_deg": round(state.target_alt, 3),
            "target_az_deg": round(state.target_az, 3),
            "required_delta_alt_deg": delta_alt,
            "required_delta_az_deg": delta_az,
            "target_name": state.target_name,
            "is_calibrated": state.is_calibrated,
            "calibration_mode": state.calibration_mode,
            "calibrated_target_name": state.calibrated_target_name,
            "tracking_enabled": state.tracking_enabled
        }



# MOUNT MOTION, TRACKING & DEGREE-BASED CALIBRATION ENDPOINTS
@app.post("/api/mount/goto")
def execute_goto(req: GoToRequest):
    try:
        with state.lock:
            # Constrain altitude to physical horizon/zenith limits [0.0, 90.0]
            target_alt = max(0.0, min(90.0, req.alt))
            # Normalize target azimuth to standard single revolution [0.0, 360.0)
            target_az = (req.az % 360.0 + 360.0) % 360.0

            prev_alt = state.current_alt
            prev_az  = state.current_az

            delta_alt = target_alt - prev_alt

            # Cable-Safe Azimuth Path:
            # Raw difference first — positive = clockwise, negative = counter-clockwise.
            # We do NOT do shortest-path wrapping here so wire tangle protection on the
            # ESP can clamp the final position. The ESP will NOT cross 0/360; if the
            # resulting position exceeds the AZ boundary the ESP will stop at the limit.
            # Python also enforces single-revolution bounds so delta is always safe:
            #   prev_az in [0, 360), target_az in [0, 360)
            #   => delta_az in (-360, +360), which the ESP's boundary clamp handles.
            delta_az = target_az - prev_az

            state.target_alt = target_alt
            state.target_az  = target_az
            state.target_name = req.target_name or "Target Object"
            # Update tracked position AFTER queuing (mirrors what ESP will do)
            state.current_alt = target_alt
            state.current_az  = target_az

        # Detailed goto log so operator always knows previous vs new vs delta
        print(
            f"[GOTO] {req.target_name or 'Target'}  "
            f"prev=({prev_alt:.3f}°, {prev_az:.3f}°)  "
            f"target=({target_alt:.3f}°, {target_az:.3f}°)  "
            f"delta=({delta_alt:+.3f}°, {delta_az:+.3f}°)",
            flush=True
        )

        # send_lan_target_request sends DELTA coordinates only to the ESP
        res = send_lan_target_request(
            delta_alt=delta_alt,
            delta_az=delta_az,
            target_alt=target_alt,
            target_az=target_az
        )

        if res.get("status") == "esp_offline":
            print(
                f"[GOTO] ESP offline — delta logged locally only. "
                f"Target: {req.target_name} Alt={target_alt:.3f}° Az={target_az:.3f}°",
                flush=True
            )

        return {
            "status": "success",
            "action": "GOTO",
            "prev_alt_deg":   round(prev_alt,   4),
            "prev_az_deg":    round(prev_az,    4),
            "target_alt_deg": round(target_alt, 4),
            "target_az_deg":  round(target_az,  4),
            "delta_alt_deg":  round(delta_alt,  4),
            "delta_az_deg":   round(delta_az,   4),
            "response": res,
        }
    except Exception as e:
        print(f"[GOTO ERROR] Unexpected error in goto endpoint: {e}", flush=True)
        raise HTTPException(status_code=500, detail=f"GoTo internal error: {e}")


@app.post("/api/mount/reset")
def reset_mount_state():
    """
    Zeros the Python backend's tracked position to (0°, 0°) and
    synchronises the ESP via /calibrate so both sides agree on origin.
    Use this any time state drift is suspected (e.g. after a failed goto
    or when the dashboard shows a stale position).
    """
    with state.lock:
        state.current_alt = 0.0
        state.current_az  = 0.0
        state.target_alt  = 0.0
        state.target_az   = 0.0
        state.target_name = "Origin (Reset)"
        state.is_calibrated = False
        state.calibration_mode = "NONE"
        state.calibrated_target_name = "Uncalibrated"

    # Sync ESP
    res = send_lan_calibrate_request(cal_alt=0.0, cal_az=0.0)
    print("[RESET] Backend state zeroed to (0°, 0°) and ESP synced via /calibrate.", flush=True)
    return {
        "status": "reset",
        "message": "Backend position reset to Alt=0° Az=0°",
        "esp_sync": res
    }



@app.post("/api/mount/slew")
def execute_slew(req: SlewRequest):
    try:
        step_delta = req.speed if req.speed < 1.0 else 0.5 * req.speed
        delta_alt = 0.0
        delta_az = 0.0

        with state.lock:
            direction = req.direction.upper()
            if direction == "+ALT":
                delta_alt = min(step_delta, max(0.0, 90.0 - state.current_alt))
                state.current_alt += delta_alt
            elif direction == "-ALT":
                delta_alt = -min(step_delta, max(0.0, state.current_alt))
                state.current_alt += delta_alt
            elif direction == "+AZ":
                delta_az = min(step_delta, max(0.0, 360.0 - state.current_az))
                state.current_az += delta_az
            elif direction == "-AZ":
                delta_az = -min(step_delta, max(0.0, state.current_az))
                state.current_az += delta_az

            state.target_alt = state.current_alt
            state.target_az = state.current_az
            curr_alt = state.current_alt
            curr_az = state.current_az

        res = send_lan_target_request(delta_alt=delta_alt, delta_az=delta_az, target_alt=curr_alt, target_az=curr_az)

        return {
            "status": "success",
            "action": "SLEW",
            "delta_alt_deg": round(delta_alt, 4),
            "delta_az_deg": round(delta_az, 4),
            "response": res,
            "current_alt_deg": round(state.current_alt, 4),
            "current_az_deg": round(state.current_az, 4)
        }
    except Exception as e:
        print(f"[SLEW ERROR] Unexpected error in slew endpoint: {e}", flush=True)
        raise HTTPException(status_code=500, detail=f"Slew internal error: {e}")


@app.post("/api/mount/tracking/toggle")
async def toggle_tracking(req: TrackingToggleRequest):
    with state.lock:
        state.tracking_enabled = req.enable
        state.last_track_time = time.time()

    if req.enable:
        state.tracking_task = asyncio.create_task(run_active_tracking_loop())
        print("[ACTIVE TRACKING] Sidereal tracking enabled by user.", flush=True)
    else:
        print("[ACTIVE TRACKING] Sidereal tracking disabled.", flush=True)

    return {"tracking_enabled": state.tracking_enabled}


@app.post("/api/mount/calibrate")
def execute_multi_mode_calibration(req: MultiModeCalibrateRequest):
    cal_mode = req.mode.upper()
    target_alt = 0.0
    target_az = 0.0
    description = ""
    cal_target_name = "Uncalibrated"

    if cal_mode == "OBJECT":
        obj_name = req.object_name or "Selected Celestial Object"
        if req.alt is not None and req.az is not None:
            target_alt = float(req.alt)
            target_az = float(req.az)
        else:
            search_res = search_stellarium_target(TargetSearchRequest(query=obj_name))
            if not search_res.get("found"):
                raise HTTPException(status_code=400, detail=search_res.get("error", f"Object '{obj_name}' not found in Stellarium database."))
            target_alt = float(search_res["altitude"])
            target_az = float(search_res["azimuth"])

        cal_target_name = obj_name
        description = f"Aligned to Star/Object [{obj_name}] (Alt {target_alt:.3f}°, Az {target_az:.3f}°)"

    elif cal_mode == "CARDINAL":
        heading = (req.cardinal_dir or "NORTH").upper()
        elevation = (req.elevation_preset or "HORIZON").upper()

        cardinal_az_map = {"NORTH": 0.0, "EAST": 90.0, "SOUTH": 180.0, "WEST": 270.0}
        target_az = float(cardinal_az_map.get(heading, 0.0))
        target_alt = 0.0 if elevation == "HORIZON" else 90.0

        cal_target_name = f"Cardinal {heading} ({elevation})"
        description = f"Aligned to Cardinal Heading [{heading}] ({target_az:.3f}°) & Elevation [{elevation}] ({target_alt:.3f}°)"

    elif cal_mode == "MANUAL":
        target_alt = float(req.alt) if req.alt is not None else 0.0
        target_az = float(req.az) if req.az is not None else 0.0
        cal_target_name = f"Manual (Alt {target_alt:.3f}°, Az {target_az:.3f}°)"
        description = f"Aligned to Direct Manual Entry (Alt {target_alt:.3f}°, Az {target_az:.3f}°)"

    else:
        raise HTTPException(status_code=400, detail="Invalid calibration mode. Use 'OBJECT', 'CARDINAL', or 'MANUAL'")

    with state.lock:
        delta_alt = target_alt - state.current_alt
        raw_delta_az = target_az - state.current_az
        delta_az = (raw_delta_az + 180.0) % 360.0 - 180.0

        state.current_alt = target_alt
        state.current_az = target_az
        state.target_alt = target_alt
        state.target_az = target_az
        state.is_calibrated = True
        state.calibration_mode = cal_mode
        state.calibrated_target_name = cal_target_name

    # Inform ESP of calibration coordinates without commanding unwanted motor motion
    res = send_lan_calibrate_request(cal_alt=target_alt, cal_az=target_az)

    return {
        "status": "success",
        "mode": cal_mode,
        "calibrated_target_name": cal_target_name,
        "description": description,
        "delta_alt_deg": round(delta_alt, 4),
        "delta_az_deg": round(delta_az, 4),
        "response": res,
        "calibrated_alt_deg": round(target_alt, 4),
        "calibrated_az_deg": round(target_az, 4)
    }


# STATIC FILES & SINGLE PAGE DASHBOARD MOUNTING
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    @app.get("/", response_class=HTMLResponse)
    @app.get("/index.html", response_class=HTMLResponse)
    def serve_index():
        index_path = os.path.join(static_dir, "index.html")
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as f:
                content = f.read()
            # Dynamically substitute configured ESP_IP into HTML output
            content = content.replace("{{ESP_IP}}", ESP_IP)
            return HTMLResponse(content=content)
        raise HTTPException(status_code=404, detail="index.html not found")

    # NOTE: Only mount /static for CSS/JS/images — do NOT mount / as StaticFiles
    # because that would serve index.html raw (bypassing the ESP_IP substitution above).
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


if __name__ == "__main__":
    print("==========================================================================")
    print("  ALT-AZIMUTH TELESCOPE MOUNT CONTROL SYSTEM - CENTRAL HUB (FASTAPI)")
    print("==========================================================================")
    print("  Dashboard UI: http://localhost:8000")
    print("  Interactive Sky Map API: http://localhost:8000/api/skymap/objects")
    print(f"  LAN Target GET URL: http://{ESP_IP}/target?alt={{delta_alt}}&az={{delta_az}}")
    print("  Stellarium API Target: http://localhost:8090")
    print("==========================================================================")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
