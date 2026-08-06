"""
Alt-Azimuth Telescope Mount Central Hub Backend
FastAPI server coordinating Stellarium HTTP API, ESP32 Serial Motor Controller, OpenCV Simulated DSLR Camera,
Interactive Pannable Sky Map, Degree-Based Motor Commands, and Real-Time Active Sidereal Target Tracking.
"""

import asyncio
import math
import os
import sys
import time
import threading
from typing import Optional, List

import cv2
import numpy as np
import requests
import serial
import serial.tools.list_ports
import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Initialize FastAPI App
app = FastAPI(title="Telescope Mount Control System", version="1.2.0")

# Enable CORS for local and network access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State Container
class SystemState:
    def __init__(self):
        # Stellarium API configuration
        self.stellarium_url = "http://localhost:8090"
        self.stellarium_connected = False

        # ESP32 Serial Controller state
        self.esp32_port = "COM3"
        self.esp32_baud = 115200
        self.esp32_connected = False
        self.serial_inst: Optional[serial.Serial] = None

        # Telescope Telemetry in Explicit Degrees (No step assumptions)
        self.current_alt = 0.0
        self.current_az = 0.0
        self.target_alt = 58.4
        self.target_az = 142.8
        self.target_name = "Jupiter"
        self.is_calibrated = False
        self.calibration_mode = "NONE"
        self.calibrated_target_name = "Uncalibrated"

        # Real-Time Sidereal Tracking State
        self.tracking_enabled = False
        self.tracking_task: Optional[asyncio.Task] = None
        self.last_track_time = time.time()

        # Camera & Live View State
        self.camera_connected = False
        self.camera_iso = "800"
        self.camera_shutter = "1/10"
        
        # Intervalometer State
        self.intervalometer_running = False
        self.intervalometer_current_frame = 0
        self.intervalometer_total_frames = 0
        self.intervalometer_exposure_sec = 1.0
        self.intervalometer_delay_sec = 2.0
        self.intervalometer_status_msg = "Idle"
        self.intervalometer_task: Optional[asyncio.Task] = None

        # Observer Site Data
        self.latitude = 23.810300
        self.longitude = 90.412500
        self.elevation = 15.0

        # Lock for thread safety
        self.lock = threading.Lock()

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

class SerialConfigRequest(BaseModel):
    port: str
    baud: int = 115200

class CameraConfigRequest(BaseModel):
    iso: str
    shutter: str

class IntervalometerRequest(BaseModel):
    frames: int
    exposure: float
    delay: float

class CameraConnectRequest(BaseModel):
    connect: bool = True


def send_esp32_packet(packet: str) -> dict:
    """
    Transmits a packet over Serial to the ESP32.
    If physical connection fails or port is closed, gracefully catches the exception,
    prints the exact outgoing packet to terminal console, and logs mock response.
    """
    packet_str = packet.strip() + "\n"
    console_output = f"[ESP32 SERIAL TRANSMIT] >>> {packet_str.strip()}"
    print(console_output, flush=True)

    with state.lock:
        if state.esp32_connected and state.serial_inst and state.serial_inst.is_open:
            try:
                state.serial_inst.write(packet_str.encode('utf-8'))
                return {"status": "sent", "mode": "hardware", "packet": packet_str.strip()}
            except Exception as e:
                print(f"[ESP32 ERROR] Serial write failed: {e}. Falling back to terminal log output.", flush=True)
                state.esp32_connected = False
                if state.serial_inst:
                    try:
                        state.serial_inst.close()
                    except Exception:
                        pass
                state.serial_inst = None
                return {"status": "failed_fallback_mock", "mode": "mock", "packet": packet_str.strip(), "error": str(e)}
        else:
            print(f"[ESP32 MOCK ACTIVE] Executed hardware simulation for packet: {packet_str.strip()}", flush=True)
            return {"status": "mocked", "mode": "mock", "packet": packet_str.strip()}


def update_telemetry_simulation(new_alt: float, new_az: float):
    with state.lock:
        state.current_alt = new_alt
        state.current_az = new_az


def get_live_object_coords(name: str):
    """Retrieves live calculated Alt and Az for a target by name from sky motion model."""
    try:
        skymap = get_skymap_objects()
        for obj in skymap.get("objects", []):
            if obj["name"].lower() == name.lower():
                return obj["altitude"], obj["azimuth"]
    except Exception:
        pass
    return None


# REAL-TIME ACTIVE SIDEREAL TARGET TRACKING BACKGROUND ENGINE
async def run_active_tracking_loop():
    """
    Background 1Hz async tracking loop.
    Calculates live celestial position drift for Alt-Az mount,
    updates target and telescope positions 1:1, and transmits degree tracking packets over serial.
    """
    print("[ACTIVE TRACKING ENGINE] Started 1Hz Sidereal Tracking Task.", flush=True)
    while state.tracking_enabled:
        await asyncio.sleep(1.0)
        if not state.tracking_enabled:
            break

        now = time.time()
        dt = now - state.last_track_time
        state.last_track_time = now

        az_drift_deg = 0.004167 * dt

        # Safely read target name under lock before releasing for skymap call
        with state.lock:
            target_name_snapshot = state.target_name

        # Query live sky coordinates OUTSIDE the lock to avoid holding lock
        # during potentially slow skymap computation.
        live_coords = get_live_object_coords(target_name_snapshot)

        # Initialize before lock block so variables are in scope after with-block
        should_send = False
        packet = ""

        with state.lock:
            if live_coords:
                state.target_alt, state.target_az = live_coords[0], live_coords[1]
            else:
                # Fallback: apply basic azimuthal drift if target not in sky database
                state.target_az = (state.target_az + az_drift_deg) % 360.0

            # Active tracking locks mount position to target coordinates exactly
            state.current_alt = state.target_alt
            state.current_az  = state.target_az
            packet = f"TRACK:ALT:{state.current_alt:.4f}:AZ:{state.current_az:.4f}:DRIFT_AZ:{az_drift_deg:.6f}"
            should_send = True

        # Send packet outside the lock to avoid deadlock
        if should_send:
            send_esp32_packet(packet)

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


@app.get("/api/skymap/objects")
def get_skymap_objects():
    t = time.time()
    sky_rotation_offset = (t / 240.0) % 360.0

    objects_db = [
        {"name": "Polaris", "type": "Star", "ra": "02h 31m 49.1s", "dec": "+89° 15' 51\"", "base_alt": 23.8, "base_az": 0.5, "mag": 2.0},
        {"name": "Jupiter", "type": "Planet", "ra": "02h 15m 12.0s", "dec": "+12° 30' 45\"", "base_alt": 58.4, "base_az": 142.8, "mag": -2.4},
        {"name": "Mars", "type": "Planet", "ra": "05h 42m 00.0s", "dec": "+24° 15' 10\"", "base_alt": 35.2, "base_az": 210.5, "mag": 0.8},
        {"name": "Saturn", "type": "Planet", "ra": "22h 10m 30.0s", "dec": "-11° 20' 05\"", "base_alt": 42.1, "base_az": 175.3, "mag": 0.6},
        {"name": "Moon", "type": "Satellite", "ra": "14h 22m 05.0s", "dec": "-18° 40' 12\"", "base_alt": 31.6, "base_az": 128.4, "mag": -11.2},
        {"name": "M31 (Andromeda)", "type": "Galaxy", "ra": "00h 42m 44.3s", "dec": "+41° 16' 09\"", "base_alt": 67.5, "base_az": 45.2, "mag": 3.4},
        {"name": "M42 (Orion Nebula)", "type": "Nebula", "ra": "05h 35m 17.3s", "dec": "-05° 23' 28\"", "base_alt": 48.9, "base_az": 192.1, "mag": 4.0},
        {"name": "Sirius", "type": "Star", "ra": "06h 45m 08.9s", "dec": "-16° 42' 58\"", "base_alt": 28.3, "base_az": 165.4, "mag": -1.46},
        {"name": "Vega", "type": "Star", "ra": "18h 36m 56.3s", "dec": "+38° 47' 01\"", "base_alt": 72.1, "base_az": 280.5, "mag": 0.03},
        {"name": "Betelgeuse", "type": "Star", "ra": "05h 55m 10.3s", "dec": "+07° 24' 25\"", "base_alt": 52.0, "base_az": 185.0, "mag": 0.50},
        {"name": "Arcturus", "type": "Star", "ra": "14h 15m 39.7s", "dec": "+19° 10' 56\"", "base_alt": 61.2, "base_az": 240.1, "mag": -0.05},
        {"name": "Capella", "type": "Star", "ra": "05h 16m 41.4s", "dec": "+45° 59' 53\"", "base_alt": 44.8, "base_az": 320.6, "mag": 0.08},
        {"name": "Aldebaran", "type": "Star", "ra": "04h 35m 55.2s", "dec": "+16° 30' 33\"", "base_alt": 38.5, "base_az": 110.2, "mag": 0.85},
        {"name": "Antares", "type": "Star", "ra": "16h 29m 24.4s", "dec": "-26° 25' 55\"", "base_alt": 18.2, "base_az": 205.8, "mag": 1.06},
        {"name": "Spica", "type": "Star", "ra": "13h 25m 11.6s", "dec": "-11° 09' 41\"", "base_alt": 33.4, "base_az": 225.0, "mag": 0.98}
    ]

    response_list = []
    for item in objects_db:
        # Simulate realistic sky motion: az rotates ~15 deg/hr, alt oscillates
        # Objects appear to rise/transit/set across the sky
        az_shift = sky_rotation_offset
        current_az = (item["base_az"] + az_shift) % 360.0
        # Altitude simulation: sinusoidal arc peaking at transit (south meridian)
        # Objects near az=180 are near transit; offset by how far they've rotated
        phase = (az_shift % 360.0) / 360.0  # 0..1 over one full sky rotation
        alt_mod = item["base_alt"] + 8.0 * math.sin(phase * 2 * math.pi)
        current_alt = max(0.0, min(85.0, alt_mod))
        
        response_list.append({
            "name": item["name"],
            "type": item["type"],
            "ra_str": item["ra"],
            "dec_str": item["dec"],
            "altitude": round(current_alt, 4),
            "azimuth": round(current_az, 4),
            "magnitude": item["mag"]
        })

    return {
        "timestamp": t,
        "observer": {"latitude": state.latitude, "longitude": state.longitude, "elevation": state.elevation},
        "telescope_reticle": {"altitude": round(state.current_alt, 4), "azimuth": round(state.current_az, 4)},
        "target_reticle": {"altitude": round(state.target_alt, 4), "azimuth": round(state.target_az, 4)},
        "objects": response_list
    }


@app.post("/api/stellarium/search")
def search_stellarium_target(req: TargetSearchRequest):
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Search query cannot be empty")

    if state.stellarium_connected:
        try:
            find_url = f"{state.stellarium_url}/api/objects/find"
            r_find = requests.get(find_url, params={"str": query}, timeout=2.0)
            if r_find.status_code == 200:
                find_results = r_find.json()
                if find_results:
                    target_name = find_results[0] if isinstance(find_results, list) else query
                    info_url = f"{state.stellarium_url}/api/objects/info"
                    r_info = requests.get(info_url, params={"name": target_name, "format": "json"}, timeout=2.0)
                    if r_info.status_code == 200:
                        info = r_info.json()
                        ra = info.get("ra", 0.0)
                        dec = info.get("dec", 0.0)
                        alt = info.get("altitude", info.get("altitudeGeocentric", 45.0))
                        az = info.get("azimuth", info.get("azimuthGeocentric", 180.0))
                        mag = info.get("vmag", info.get("mag", 0.0))
                        
                        ra_h = int(ra / 15.0)
                        ra_m = int((ra / 15.0 - ra_h) * 60)
                        ra_s = ((ra / 15.0 - ra_h) * 60 - ra_m) * 60
                        
                        dec_d = int(dec)
                        dec_m = int(abs(dec - dec_d) * 60)
                        dec_s = (abs(dec - dec_d) * 60 - dec_m) * 60

                        return {
                            "found": True,
                            "name": info.get("localized-name", target_name),
                            "type": info.get("type", "Celestial Body"),
                            "ra_str": f"{ra_h:02d}h {ra_m:02d}m {ra_s:04.1f}s",
                            "dec_str": f"{dec_d:+03d}° {dec_m:02d}' {dec_s:04.1f}\"",
                            "ra_deg": float(ra),
                            "dec_deg": float(dec),
                            "altitude": float(alt),
                            "azimuth": float(az),
                            "magnitude": float(mag),
                            "source": "stellarium_live"
                        }
        except Exception as e:
            print(f"[STELLARIUM QUERY WARNING] Query to Stellarium failed: {e}. Generating simulated object data.", flush=True)

    skymap_data = get_skymap_objects()
    for obj in skymap_data["objects"]:
        if query.lower() in obj["name"].lower():
            return {
                "found": True,
                "name": obj["name"],
                "type": obj["type"],
                "ra_str": obj["ra_str"],
                "dec_str": obj["dec_str"],
                "altitude": obj["altitude"],
                "azimuth": obj["azimuth"],
                "magnitude": obj["magnitude"],
                "source": "local_skymap_db"
            }

    hash_val = sum(ord(c) for c in query)
    sim_alt = float((hash_val * 7) % 85 + 5)
    sim_az = float((hash_val * 13) % 360)
    
    return {
        "found": True,
        "name": query.capitalize(),
        "type": "Custom Target",
        "ra_str": f"{(hash_val % 24):02d}h {((hash_val*3)%60):02d}m 15.4s",
        "dec_str": f"{((hash_val%180)-90):+03d}° {((hash_val*7)%60):02d}' 30.0\"",
        "altitude": sim_alt,
        "azimuth": sim_az,
        "magnitude": 5.5,
        "source": "simulated_hash"
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


# HARDWARE & SERIAL CONTROL ENDPOINTS
@app.get("/api/hardware/ports")
def get_available_ports():
    ports = [port.device for port in serial.tools.list_ports.comports()]
    if not ports:
        ports = ["COM1", "COM3", "COM4", "/dev/ttyUSB0", "/dev/ttyACM0"]
    return {"ports": ports}


@app.post("/api/hardware/esp32/connect")
def connect_esp32(req: SerialConfigRequest):
    with state.lock:
        state.esp32_port = req.port
        state.esp32_baud = req.baud
        try:
            state.serial_inst = serial.Serial(req.port, req.baud, timeout=1.0)
            state.esp32_connected = True
            print(f"[ESP32 CONNECTED] Successfully opened serial port {req.port} at {req.baud} baud.", flush=True)
            return {"connected": True, "port": req.port, "baud": req.baud, "mode": "hardware"}
        except Exception as e:
            state.esp32_connected = False
            state.serial_inst = None
            print(f"[ESP32 CONNECT FALLBACK] Port {req.port} unavailable: {e}. Enabling Mock Hardware Serial mode.", flush=True)
            return {
                "connected": True,
                "port": req.port,
                "baud": req.baud,
                "mode": "mock",
                "message": f"Physical port unavailable ({e}). Outgoing commands will be printed to terminal console."
            }


@app.post("/api/hardware/esp32/disconnect")
def disconnect_esp32():
    with state.lock:
        if state.serial_inst and state.serial_inst.is_open:
            try:
                state.serial_inst.close()
            except Exception:
                pass
        state.serial_inst = None
        state.esp32_connected = False
        print("[ESP32 DISCONNECTED] Serial port closed.", flush=True)
        return {"connected": False}


@app.get("/api/hardware/status")
def get_hardware_status():
    with state.lock:
        if state.tracking_enabled:
            state.current_alt = state.target_alt
            state.current_az = state.target_az

        delta_alt = round(state.target_alt - state.current_alt, 4)
        raw_delta_az = state.target_az - state.current_az
        delta_az = round((raw_delta_az + 180.0) % 360.0 - 180.0, 4)

        return {
            "stellarium_connected": state.stellarium_connected,
            "esp32_connected": state.esp32_connected,
            "camera_connected": state.camera_connected,
            "current_alt_deg": round(state.current_alt, 4),
            "current_az_deg": round(state.current_az, 4),
            "target_alt_deg": round(state.target_alt, 4),
            "target_az_deg": round(state.target_az, 4),
            "required_delta_alt_deg": delta_alt,
            "required_delta_az_deg": delta_az,
            "target_name": state.target_name,
            "is_calibrated": state.is_calibrated,
            "calibration_mode": state.calibration_mode,
            "calibrated_target_name": state.calibrated_target_name,
            "tracking_enabled": state.tracking_enabled,
            "camera_iso": state.camera_iso,
            "camera_shutter": state.camera_shutter,
            "intervalometer_running": state.intervalometer_running,
            "intervalometer_status": state.intervalometer_status_msg,
            "intervalometer_frame": f"{state.intervalometer_current_frame}/{state.intervalometer_total_frames}"
        }


# MOUNT MOTION, TRACKING & DEGREE-BASED CALIBRATION ENDPOINTS
@app.post("/api/mount/goto")
def execute_goto(req: GoToRequest):
    packet = f"GOTO:ALT:{req.alt:.4f}:AZ:{req.az:.4f}"
    res = send_esp32_packet(packet)
    
    with state.lock:
        state.target_alt = req.alt
        state.target_az = req.az
        state.target_name = req.target_name or "Target Object"
    
    update_telemetry_simulation(req.alt, req.az)

    return {
        "status": "success",
        "action": "GOTO",
        "packet_sent": packet,
        "response": res,
        "new_alt_deg": req.alt,
        "new_az_deg": req.az
    }


@app.post("/api/mount/slew")
def execute_slew(req: SlewRequest):
    step_delta = req.speed if req.speed < 1.0 else 0.5 * req.speed
    with state.lock:
        if req.direction.upper() == "+ALT":
            state.current_alt = min(90.0, state.current_alt + step_delta)
        elif req.direction.upper() == "-ALT":
            state.current_alt = max(-10.0, state.current_alt - step_delta)
        elif req.direction.upper() == "+AZ":
            state.current_az = (state.current_az + step_delta) % 360.0
        elif req.direction.upper() == "-AZ":
            state.current_az = (state.current_az - step_delta) % 360.0

    packet = f"MANUAL:DIR:{req.direction.upper()}:SPEED:{req.speed:.4f}:TARGET_ALT:{state.current_alt:.4f}:TARGET_AZ:{state.current_az:.4f}"
    res = send_esp32_packet(packet)

    return {
        "status": "success",
        "action": "SLEW",
        "packet_sent": packet,
        "response": res,
        "current_alt_deg": round(state.current_alt, 4),
        "current_az_deg": round(state.current_az, 4)
    }


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
            target_alt = req.alt
            target_az = req.az
        else:
            search_res = search_stellarium_target(TargetSearchRequest(query=obj_name))
            target_alt = search_res["altitude"]
            target_az = search_res["azimuth"]
        
        cal_target_name = obj_name
        description = f"Aligned to Star/Object [{obj_name}] (Alt {target_alt:.2f}°, Az {target_az:.2f}°)"
        packet = f"CALIBRATE:OBJECT:NAME:{obj_name}:ALT:{target_alt:.4f}:AZ:{target_az:.4f}"

    elif cal_mode == "CARDINAL":
        heading = (req.cardinal_dir or "NORTH").upper()
        elevation = (req.elevation_preset or "HORIZON").upper()

        cardinal_az_map = {"NORTH": 0.0, "EAST": 90.0, "SOUTH": 180.0, "WEST": 270.0}
        target_az = cardinal_az_map.get(heading, 0.0)
        target_alt = 0.0 if elevation == "HORIZON" else 90.0

        cal_target_name = f"Cardinal {heading} ({elevation})"
        description = f"Aligned to Cardinal Heading [{heading}] ({target_az}°) & Elevation [{elevation}] ({target_alt}°)"
        packet = f"CALIBRATE:CARDINAL:DIR:{heading}:ALT:{target_alt:.4f}:AZ:{target_az:.4f}"

    elif cal_mode == "MANUAL":
        target_alt = req.alt if req.alt is not None else 0.0
        target_az = req.az if req.az is not None else 0.0
        cal_target_name = f"Manual (Alt {target_alt:.2f}°, Az {target_az:.2f}°)"
        description = f"Aligned to Direct Manual Entry (Alt {target_alt:.2f}°, Az {target_az:.2f}°)"
        packet = f"CALIBRATE:MANUAL:ALT:{target_alt:.4f}:AZ:{target_az:.4f}"

    else:
        raise HTTPException(status_code=400, detail="Invalid calibration mode. Use 'OBJECT', 'CARDINAL', or 'MANUAL'")

    res = send_esp32_packet(packet)

    with state.lock:
        state.current_alt = target_alt
        state.current_az = target_az
        state.is_calibrated = True
        state.calibration_mode = cal_mode
        state.calibrated_target_name = cal_target_name

    return {
        "status": "success",
        "mode": cal_mode,
        "calibrated_target_name": cal_target_name,
        "description": description,
        "packet_sent": packet,
        "response": res,
        "calibrated_alt_deg": round(target_alt, 4),
        "calibrated_az_deg": round(target_az, 4)
    }


# CAMERA & LIVE VIEW MOCK ENGINE
@app.post("/api/camera/toggle")
def toggle_camera(req: CameraConnectRequest):
    enable = req.connect
    with state.lock:
        state.camera_connected = enable
    print(f"[CAMERA STATUS] Camera connection set to: {enable}", flush=True)
    return {"camera_connected": state.camera_connected}


@app.post("/api/camera/config")
def update_camera_config(req: CameraConfigRequest):
    with state.lock:
        state.camera_iso = req.iso
        state.camera_shutter = req.shutter
    print(f"[CAMERA CONFIG] Set ISO: {req.iso}, Shutter: {req.shutter}", flush=True)
    return {"iso": req.iso, "shutter": req.shutter}


def generate_dark_starfield_frame():
    width, height = 640, 480
    frame = np.full((height, width, 3), 10, dtype=np.uint8)

    noise = np.random.randint(0, 18, (height, width, 3), dtype=np.uint8)
    frame = cv2.add(frame, noise)

    t = time.time()
    np.random.seed(42)
    num_stars = 70
    star_x = np.random.randint(20, width - 20, size=num_stars)
    star_y = np.random.randint(20, height - 20, size=num_stars)
    star_mags = np.random.uniform(0.4, 1.0, size=num_stars)

    for idx in range(num_stars):
        brightness = int(255 * star_mags[idx] * (0.8 + 0.2 * math.sin(t * 3.0 + idx)))
        color = (brightness, brightness, int(brightness * 0.9))
        cv2.circle(frame, (star_x[idx], star_y[idx]), 1 if idx % 3 != 0 else 2, color, -1)

    center_x, center_y = width // 2, height // 2
    cv2.circle(frame, (center_x, center_y), 16, (40, 40, 80), -1)
    cv2.circle(frame, (center_x, center_y), 8, (120, 160, 255), -1)
    cv2.circle(frame, (center_x, center_y), 3, (255, 255, 255), -1)

    reticle_color = (30, 30, 220)
    cv2.line(frame, (center_x - 30, center_y), (center_x - 8, center_y), reticle_color, 1)
    cv2.line(frame, (center_x + 8, center_y), (center_x + 30, center_y), reticle_color, 1)
    cv2.line(frame, (center_x, center_y - 30), (center_x, center_y - 8), reticle_color, 1)
    cv2.line(frame, (center_x, center_y + 8), (center_x, center_y + 30), reticle_color, 1)
    cv2.circle(frame, (center_x, center_y), 22, reticle_color, 1)

    hud_red = (40, 40, 240)
    cv2.putText(frame, "CANON DSLR MOCK LIVE VIEW [USB]", (15, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, hud_red, 1, cv2.LINE_AA)
    cv2.putText(frame, f"ISO: {state.camera_iso} | SHUTTER: {state.camera_shutter}", (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 100, 255), 1, cv2.LINE_AA)
    cv2.putText(frame, f"ALT: {state.current_alt:.2f} DEG | AZ: {state.current_az:.2f} DEG", (15, 465), cv2.FONT_HERSHEY_SIMPLEX, 0.45, hud_red, 1, cv2.LINE_AA)
    cv2.putText(frame, time.strftime("%Y-%m-%d %H:%M:%S UTC"), (420, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (80, 80, 200), 1, cv2.LINE_AA)

    _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return buffer.tobytes()


def generate_mjpeg_stream():
    while True:
        if state.camera_connected:
            frame_bytes = generate_dark_starfield_frame()
        else:
            frame = np.full((480, 640, 3), 5, dtype=np.uint8)
            cv2.putText(frame, "CAMERA DISCONNECTED", (180, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (20, 20, 180), 2, cv2.LINE_AA)
            cv2.putText(frame, "Toggle connection switch in Hardware Panel to activate stream", (90, 275), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (60, 60, 140), 1, cv2.LINE_AA)
            _, buffer = cv2.imencode('.jpg', frame)
            frame_bytes = buffer.tobytes()

        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.1)


@app.get("/api/camera/liveview")
def liveview_feed():
    return StreamingResponse(generate_mjpeg_stream(), media_type="multipart/x-mixed-replace; boundary=frame")


# ASYNC INTERVALOMETER SUITE
async def run_intervalometer_task(frames: int, exposure: float, delay: float):
    state.intervalometer_running = True
    state.intervalometer_total_frames = frames
    state.intervalometer_exposure_sec = exposure
    state.intervalometer_delay_sec = delay

    print(f"[INTERVALOMETER STARTED] Sequence: {frames} frames x {exposure}s exposure (delay {delay}s)", flush=True)

    for f in range(1, frames + 1):
        if not state.intervalometer_running:
            state.intervalometer_status_msg = "Aborted by User"
            print("[INTERVALOMETER] Sequence cancelled.", flush=True)
            break

        state.intervalometer_current_frame = f
        state.intervalometer_status_msg = f"Exposing Frame {f}/{frames} ({exposure}s)"
        print(f"[INTERVALOMETER] Exposing Frame {f}/{frames} for {exposure} seconds...", flush=True)

        exp_remaining = exposure
        while exp_remaining > 0 and state.intervalometer_running:
            await asyncio.sleep(min(0.5, exp_remaining))
            exp_remaining -= 0.5

        if not state.intervalometer_running:
            break

        if f < frames:
            state.intervalometer_status_msg = f"Delay between frames ({delay}s)"
            print(f"[INTERVALOMETER] Inter-frame delay: {delay}s...", flush=True)
            delay_remaining = delay
            while delay_remaining > 0 and state.intervalometer_running:
                await asyncio.sleep(min(0.5, delay_remaining))
                delay_remaining -= 0.5

    if state.intervalometer_running:
        state.intervalometer_status_msg = f"Completed {frames} Frames Successfully!"
        print(f"[INTERVALOMETER COMPLETED] All {frames} frames captured.", flush=True)

    state.intervalometer_running = False


@app.post("/api/camera/intervalometer/start")
async def start_intervalometer(req: IntervalometerRequest, background_tasks: BackgroundTasks):
    if state.intervalometer_running:
        raise HTTPException(status_code=400, detail="Intervalometer is already running")
    
    state.intervalometer_current_frame = 0
    state.intervalometer_running = True
    asyncio.create_task(run_intervalometer_task(req.frames, req.exposure, req.delay))
    return {"status": "started", "frames": req.frames, "exposure": req.exposure, "delay": req.delay}


@app.post("/api/camera/intervalometer/stop")
def stop_intervalometer():
    state.intervalometer_running = False
    state.intervalometer_status_msg = "Stopping Sequence..."
    print("[INTERVALOMETER] Stop command received.", flush=True)
    return {"status": "stopping"}


@app.get("/api/camera/intervalometer/status")
def get_intervalometer_status():
    return {
        "running": state.intervalometer_running,
        "current_frame": state.intervalometer_current_frame,
        "total_frames": state.intervalometer_total_frames,
        "exposure_sec": state.intervalometer_exposure_sec,
        "delay_sec": state.intervalometer_delay_sec,
        "status_message": state.intervalometer_status_msg
    }


# STATIC FILES & SINGLE PAGE DASHBOARD MOUNTING
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
def read_root():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return HTMLResponse("<h2>Telescope Control Hub Backend Running. Static index.html not found.</h2>")


if __name__ == "__main__":
    print("==========================================================================")
    print("  ALT-AZIMUTH TELESCOPE MOUNT CONTROL SYSTEM - CENTRAL HUB (FASTAPI)")
    print("==========================================================================")
    print("  Dashboard UI: http://localhost:8000")
    print("  Interactive Sky Map API: http://localhost:8000/api/skymap/objects")
    print("  Live View Stream: http://localhost:8000/api/camera/liveview")
    print("  Stellarium API Target: http://localhost:8090")
    print("==========================================================================")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
