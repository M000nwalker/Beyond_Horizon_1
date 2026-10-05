<div align="center">

# 🔭 BEYOND HORIZON — 1

### *An Alt-Azimuth Computerized Telescope Mount*

**Designed · Fabricated · Automated · Photographed — from the ground up**

---

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Platform](https://img.shields.io/badge/Platform-ESP32-blue)
![Backend](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi)
![CAD](https://img.shields.io/badge/CAD-SolidWorks-FF0000)
![FEA](https://img.shields.io/badge/FEA-COMSOL-007ACC)
![Camera](https://img.shields.io/badge/Camera-Canon%20EOS%2060D-E00000)

</div>

---

## 📖 Overview

**Beyond Horizon-1 (BH-1)** is a fully custom-designed, computer-controlled **alt-azimuth refracting telescope mount** — conceived, designed, simulated, fabricated, and automated entirely by the team. From the worm-gear drivetrain to the real-time sidereal tracking web interface, every subsystem is purpose-built and tightly integrated.

The system combines:
- A **precision worm-gear alt-az mount** with 3D-printed structural components and SolidWorks-designed machined parts
- An **ESP32-based stepper motor controller** communicating over Wi-Fi LAN
- A **FastAPI web server** with a tactical dark-mode dashboard for full computer-aided telescope operation
- **Real-time sidereal tracking** at 1 Hz, compensating for Earth's diurnal rotation
- A **Canon EOS 60D DSLR integration module** with intervalometer, live-view streaming, and full exposure control
- **FEA structural validation** of the objective lens assembly using COMSOL Multiphysics

---

## ✨ Key Features

| Feature | Description |
|---|---|
| 🌐 **Web Dashboard** | Tactical night-vision UI accessible over local network from any device |
| 🎯 **GoTo Automation** | Point to any celestial object by name using Stellarium sky data |
| 🌀 **Sidereal Tracking** | 1 Hz background task that continuously compensates for Earth's rotation |
| 🧭 **Multi-Mode Calibration** | Star sync, cardinal heading, or direct manual angle entry |
| 🗺️ **Interactive Sky Map** | Pannable and zoomable HTML5 canvas celestial map with real-time target reticle |
| 📷 **DSLR Camera Control** | Full Canon EOS 60D integration: shutter, ISO, bulb, live view, intervalometer |
| 🔩 **Custom Hardware** | Worm-gearbox drivetrain, dual stepper axes, entirely 3D-printable structural parts |
| 📐 **FEA Validated** | COMSOL Multiphysics ray-tracing and structural mesh analysis of the optical tube |

---

## 🏗️ Repository Structure

```
Beyond_Horizon_1/
│
├── Beyond Horizon -1 User Interface/    # Software: Web Server & Dashboard
│   ├── app.py                           # FastAPI central hub backend (975 lines)
│   ├── camera_backend.py                # Canon EOS 60D camera control module (725 lines)
│   ├── static/
│   │   ├── index.html                   # Main telescope control dashboard
│   │   ├── style.css                    # Tactical night-vision dark theme
│   │   ├── app.js                       # Dashboard logic, sky map, GoTo engine
│   │   ├── camera.html                  # Dedicated DSLR camera control page
│   │   ├── camera.css                   # Camera UI styling
│   │   └── camera.js                    # Camera live-view, intervalometer logic
│   └── esp_final_logic/
│       └── stepper_final_logic/
│           └── stepper_final_logic.ino  # ESP32 Arduino firmware (non-blocking)
│
├── CADS/                                # SolidWorks CAD Models
│   ├── Final Assembly/                  # Complete telescope + mount assembly
│   │   ├── final assembly.SLDASM        # Top-level assembly
│   │   ├── wormscrew.SLDPRT             # Custom worm screw part
│   │   ├── wormwheel.SLDPRT             # Custom worm wheel part
│   │   └── ...                          # All structural parts
│   ├── Optical Tube/                    # OTA (Optical Tube Assembly) parts
│   │   ├── OTA With Clamp.SLDASM        # Full OTA with cradle clamps
│   │   ├── Main tube.SLDPRT             # Primary optical tube body
│   │   ├── Focuser Static.SLDPRT        # Rack-and-pinion focuser base
│   │   ├── Draw tube.SLDPRT             # Sliding focuser draw tube
│   │   ├── Lens Cell.SLDPRT             # Objective lens retaining cell
│   │   └── Lens cap.SLDPRT              # Dust cap
│   └── Printables/                      # STL-ready 3D printable parts
│       ├── Lower Holder.STL             # Alt-axis lower bearing holder
│       ├── Upper Holder.STL             # Alt-axis upper bearing holder
│       └── wheel.STL                    # Worm wheel (printable, 120-tooth)
│
├── FEA Simulation/                      # Structural & Optical Analysis
│   ├── FEA Model (Objective Lens).mph   # COMSOL Multiphysics model file
│   └── Results/
│       ├── Ray Tracing.png
│       ├── Ray Tracing Highly Zoomed in.png
│       ├── Focal Plane Dataset.jpg
│       ├── Spot Diagram.png
│       └── Meshing.png
│
├── Media/                               # Build Photos & Demo Video
│   ├── final final.mp4                  # Full system demo video
│   └── photo_2026-10-02_*.jpg           # Hardware build photographs
│
└── PDF Documents/                       # Project Documentation
    ├── Project Proposal.pdf
    ├── me_366_telescope_project_report.pdf
    ├── FEA Simulation Report.pdf
    └── Poster.pdf
```

---

## ⚙️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OPERATOR BROWSER                         │
│           Tactical Dashboard  (index.html / app.js)         │
└────────────────────────┬────────────────────────────────────┘
                         │  HTTP / REST API
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              FastAPI Central Hub  (app.py)                  │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │  Sidereal Track │  │  Stellarium API  │                  │
│  │  Engine (1 Hz)  │  │  Client (local)  │                  │
│  └────────┬────────┘  └──────────────────┘                  │
│           │  LAN HTTP  GET /target?alt=Δ&az=Δ               │
└───────────┼─────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│          ESP32  (stepper_final_logic.ino)                   │
│  /target   → queue delta move → execute interleaved steps   │
│  /calibrate → sync tracked coordinates, NO motor motion     │
│  /status   → report current Alt / Az position              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │   AZ Stepper     │  │   ALT Stepper    │                 │
│  │  NEMA 17 + DRV   │  │  NEMA 17 + DRV   │                 │
│  │  Worm Gearbox    │  │  Worm Gearbox    │                 │
│  └──────────────────┘  └──────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🤖 ESP32 Firmware

**File:** `esp_final_logic/stepper_final_logic/stepper_final_logic.ino`

A **single-core, non-blocking stepper controller** for the ESP32. HTTP responses return instantly; physical stepping runs asynchronously in the main loop via a command queue.

### Hardware Pinout

| Signal | GPIO |
|---|---|
| `AZ_STEP` | 18 |
| `AZ_DIR` | 19 |
| `ALT_STEP` | 22 |
| `ALT_DIR` | 23 |

### Drive Kinematics

```
Gear Ratio        = 120 : 1
Microstepping     = 1/16
Steps per rev     = 200
────────────────────────────────────────────────────────
Steps per degree  = (200 × 16 × 120) / 360 = 1066.67 steps/°
```

### HTTP Endpoints (ESP32)

| Endpoint | Function |
|---|---|
| `GET /target?alt=Δ&az=Δ` | Execute a **relative delta-degree** slew on both axes |
| `GET /calibrate?alt=A&az=A` | Sync internal tracked position — **no motor motion** |
| `GET /status` | Returns current tracked Alt / Az as JSON |

### Safety Limits

```
AZ:  0°  –  360°
ALT: 0°  –   90°
```

---

## 🖥️ Web Control Hub

**File:** `app.py` · FastAPI v2.0.0

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Serve the main dashboard |
| `/camera.html` | GET | Serve the camera control page |
| `/api/status` | GET | Full system telemetry snapshot |
| `/api/location` | POST | Set observer GPS coordinates |
| `/api/search` | POST | Search Stellarium for a celestial object |
| `/api/goto` | POST | GoTo target (Alt/Az) — transmits delta to ESP32 |
| `/api/slew` | POST | Manual directional slew with speed multiplier |
| `/api/calibrate` | POST | Multi-mode calibration (star, cardinal, or manual) |
| `/api/tracking/toggle` | POST | Enable / disable 1 Hz sidereal tracking loop |
| `/api/camera/*` | GET/POST | Full Canon EOS 60D control suite |

### Observer Location

Default: **Dhaka, Bangladesh** — `23.8103°N, 90.4125°E, 15 m elevation`.
Update via the **GPS Sync** button in the dashboard.

### Sidereal Tracking

The 1 Hz background async task `run_active_tracking_loop()` calculates Earth's diurnal drift and keeps the target centered:

```
Drift Rate ≈ 15° / hour  =  0.004167° / second
```

Delta values are computed with correct 0°/360° Az wrap-around arithmetic and dispatched to the ESP32 over LAN HTTP every second.

---

## 📷 Canon EOS 60D Integration

**File:** `camera_backend.py` — an independent FastAPI router at `/api/camera/*`

- **Live MJPEG stream** — dark starfield with twinkling stars, crosshair reticle
- **Exposure controls:** Shutter (1/4000s → 30s → BULB), ISO (100–12800 + AUTO), Aperture, White Balance, Drive Mode
- **Pro Intervalometer:** Initial delay, bulb duration, inter-frame gap, frame count, real-time progress bar
- **Capture manager:** Saves frames to `captures/` with preview and download endpoints
- Automatically falls back to a **hardware simulator** when no physical camera is connected

---

## 🔩 Mechanical Design

### Drivetrain

| Parameter | Value |
|---|---|
| Gear Ratio | 120 : 1 (worm gearbox) |
| Motor | NEMA 17 stepper (1.8°/step) |
| Driver | DRV8825 @ 1/16 microstepping |
| Angular Resolution | ~3.4 arcminutes per step |
| Axes | Alt (elevation) + Az (azimuth) — independent |

### Optical Tube Assembly (OTA)

| Component | SolidWorks Part |
|---|---|
| Main Tube body | `Main tube.SLDPRT` |
| Draw Tube (focuser) | `Draw tube.SLDPRT` |
| Static Focuser Body | `Focuser Static.SLDPRT` |
| Objective Lens Cell | `Lens Cell.SLDPRT` |
| Retaining Lens Cap | `Lens cap.SLDPRT` |
| Cradle Clamps | `Lower Clamp.SLDPRT`, `Upper Clamp.SLDPRT` |

### 3D Printable Parts (STL)

All files in `CADS/Printables/` are ready to print:

- `Lower Holder.STL` — Alt-axis lower bearing housing
- `Upper Holder.STL` — Alt-axis upper bearing housing
- `wheel.STL` — 120-tooth worm wheel (NEMA 17 bore)
- Focuser slider, lens cap, lens cell — all included

---

## 📐 FEA & Optical Simulation

**Tool:** COMSOL Multiphysics (Wave Optics Module)
**Model:** `FEA Model (Objective Lens).mph`

| Analysis | Output |
|---|---|
| Full aperture ray trace | `Ray Tracing.png` |
| High-magnification ray trace | `Ray Tracing Highly Zoomed in.png` |
| Without AR coating | `Ray Tracing Without Anti Reflective Coating.png` |
| Focal plane intensity map | `Focal Plane Dataset.jpg` |
| Aberration spot diagram | `Spot Diagram.png` |
| Structural mesh | `Meshing.png` |

Full analysis write-up: `PDF Documents/FEA Simulation Report.pdf`

---

## 🚀 Getting Started

### 1 — Flash the ESP32

1. Open `esp_final_logic/stepper_final_logic/stepper_final_logic.ino` in Arduino IDE
2. Set your Wi-Fi credentials:
   ```cpp
   const char* ssid     = "YOUR_NETWORK";
   const char* password = "YOUR_PASSWORD";
   ```
3. Flash to your ESP32, then note the **IP address** from Serial Monitor

### 2 — Configure the Server

In `app.py`, update the ESP32 IP:

```python
ESP_IP = "192.168.X.XXX"   # ← your ESP32's LAN IP
```

### 3 — Install Dependencies & Run

```bash
pip install fastapi uvicorn requests opencv-python numpy pydantic

cd "Beyond Horizon -1 User Interface"
python app.py
```

Dashboard accessible at **`http://localhost:8000`** — or your machine's LAN IP for remote access.

### 4 — First-Time Calibration

1. Power on the mount and let the ESP32 connect to Wi-Fi
2. Open the dashboard → **Calibration Panel**
3. Point the OTA at a known star (e.g. Polaris) and select **Star Sync** mode
4. Click **GoTo** any Stellarium object, or enable **Sidereal Tracking**

---

## 🎨 UI Design

The dashboard uses a **tactical night-vision theme** to preserve dark adaptation during observing sessions:

- **Background:** Deep charcoal `#050505` / `#0d0d0d`
- **Accent:** Cyan `#00ffcc` for active status indicators
- **Typography:** `Orbitron` (display headers) + `Share Tech Mono` (numeric readouts)
- **Panels:** Sky Map · Target Search · Degree Telemetry · Sidereal Tracking · Multi-Mode Calibration · D-Pad Slew · Camera Live View

---

## 📄 Project Documents

| Document | Description |
|---|---|
| `Project Proposal.pdf` | Initial project scope and design goals |
| `me_366_telescope_project_report.pdf` | Full engineering project report |
| `FEA Simulation Report.pdf` | COMSOL optical and structural analysis report |
| `Poster.pdf` | Project presentation poster |

---

## 🙏 References

- Berry, R. — *Build Your Own Telescope* (optical design reference)
- [Stellarium Web Engine](https://stellarium.org) — sky object data source
- [COMSOL Multiphysics](https://www.comsol.com) — Wave Optics Module
- [ESP32 Arduino Core](https://github.com/espressif/arduino-esp32) — firmware platform

---

<div align="center">

**Beyond Horizon — 1** · Built with passion, precision, and a lot of late nights ✨

</div>
