# 🌌 Beyond Horizon - 1 (BH-1)
### *A Low-Cost, Smart Motorized Alt-Azimuth GoTo Astronomical Refractor Telescope*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#)
[![Python: 3.10+](https://img.shields.io/badge/Python-3.10%2B-brightgreen.svg)](#)
[![FastAPI: 0.100+](https://img.shields.io/badge/FastAPI-Framework-009688.svg)](#)
[![Microcontroller: ESP32](https://img.shields.io/badge/Hardware-ESP32-red.svg)](#)
[![CAD: SolidWorks](https://img.shields.io/badge/CAD-SolidWorks-red.svg)](#)
[![Simulation: COMSOL](https://img.shields.io/badge/Simulation-COMSOL%20Multiphysics-blue.svg)](#)
[![Cost: ~26,600 BDT](https://img.shields.io/badge/Budget-~%24220%20USD%20%7C%2026.6k%20BDT-success.svg)](#)

---

## 📖 Executive Summary

**Project Beyond Horizon - 1 (BH-1)** is an electromechanical, smart GoTo astronomical telescope developed as an electro-mechanical system design initiative (**ME 366**) at the **Department of Mechanical Engineering, Bangladesh University of Engineering and Technology (BUET)**.

Commercial motorized GoTo telescopes with computerized celestial tracking and astrophotography integration are prohibitively expensive and rely entirely on imports in Bangladesh. **BH-1** bridges this gap by democratizing astronomy: integrating precision optomechanics, 3D-printed polymer and PVC fabrication, high-torque dual-axis worm gear drives, an ESP32 wireless motion controller, a FastAPI night-vision tactical dashboard, and dedicated Canon EOS DSLR astrophotography integration—all fabricated within an accessible budget of **~26,600 BDT (~$220 USD)**.

---

## 🌟 Key Highlights & Features

- **🔭 High-Resolution Achromatic Optics**:
  - $f/11.25$ Achromatic doublet objective lens ($\approx 900\text{ mm}$ focal length).
  - Paraxial focal convergence verified at $z = 899.484\text{ mm}$ with $r_{\text{rms}} = 68.1\,\mu\text{m}$ RMS spot radius across the visible polychromatic spectrum ($400\text{--}700\text{ nm}$).
  - Anti-Reflective (AR) thin-film coating verification via **COMSOL Multiphysics** ray tracing.
- **⚙️ Dual-Axis Motorized Alt-Azimuth Mount**:
  - 2 Degrees of Freedom (Altitude: $0^\circ \text{ to } 90^\circ$, Azimuth: $0^\circ \text{ to } 360^\circ$).
  - High-torque NEMA 17 stepper motors paired with precision **120:1 Worm Gearboxes** for non-backdrivable, micro-smooth slewing.
  - Sub-arcminute theoretical resolution: **1,066.67 steps/degree** ($384,000\text{ steps/rev}$ at $1/16$ microstepping).
- **📡 Wireless ESP32 Motion Controller**:
  - Standalone Wi-Fi HTTP REST API (`/target`, `/calibrate`, `/status`).
  - Interleaved non-blocking step generation on ESP32 Core 1 with FreeRTOS queues.
  - Degree-based kinematics calculation local to firmware.
- **🛰️ Real-Time 1 Hz Sidereal Tracking Engine**:
  - Continuously counteracts Earth’s diurnal rotation ($\approx 15.041^\circ/\text{hr} \approx 0.004167^\circ/\text{sec}$) to maintain precise optical centering on celestial targets.
- **🖥️ Tactical Night-Vision Web Dashboard**:
  - Responsive single-page application built with FastAPI, WebSockets/HTTP, HTML5 Canvas, and modern vanilla CSS.
  - Dark-adapted red/charcoal theme (`#050505` / `#ef4444`) to preserve visual rod-cell adaptation in field conditions.
  - Interactive pannable & zoomable celestial sky map with target search, real-time coordinate translation, and tactile virtual D-Pad slewing.
  - 3-Way Calibration Suite: Star/Object Sync, Cardinal Horizon Alignment, and Direct Coordinate Entry.
- **📷 Canon EOS DSLR Astrophotography & Intervalometer**:
  - Native USB PTP camera control (Canon EOS 60D) with automated hardware simulation fallback.
  - Live-view stream over MJPEG with tactical crosshair reticle overlay.
  - Full exposure controls (Shutter speeds up to BULB, ISO 100–12800, Aperture, White Balance).
  - Multi-frame astrophotography intervalometer with progress bar telemetry and local image capture storage.

---

## 🏛️ System Architecture

```mermaid
graph TD
    User([User / Astrophotographer]) -->|Browser / Mobile UI| WebUI[Tactical Web Dashboard\nHTML5 Canvas / CSS / JS]
    
    subgraph Host Workstation / Laptop
        WebUI <-->|HTTP / REST & WebSocket| Backend[FastAPI Central Hub\napp.py]
        Backend --> TrackingEngine[1Hz Sidereal Tracking Engine]
        Backend --> CameraService[Canon EOS 60D Controller\ncamera_backend.py]
        CameraService <-->|USB / gphoto2 / OpenCV| DSLR[(Canon DSLR / Astrocyl)]
    end

    subgraph ESP32 Wireless Mechatronics Hub
        Backend <-->|Wi-Fi HTTP REST| ESP[ESP32 Microcontroller\nFreeRTOS + WebServer]
        ESP -->|DIR & STEP Pulses| Drivers[A4988 / DRV8825 Stepper Drivers]
        Drivers --> MotorAlt[NEMA 17 - Altitude Axis]
        Drivers --> MotorAz[NEMA 17 - Azimuth Axis]
    end

    subgraph Mechanical & Optomechanical Assembly
        MotorAlt -->|120:1 Worm Gear| MechAlt[Altitude Pivot Mount\n0° to 90°]
        MotorAz -->|120:1 Worm Gear| MechAz[Azimuth Turntable\n0° to 360°]
        MechAlt --> OTA[Optical Tube Assembly\n900mm Achromatic Doublet + Focuser]
        DSLR -.->|T-Ring 1.25'' Adapter| OTA
    end
```

---

## 📂 Repository Directory Structure

```text
Beyond_Horizon_1/
├── Beyond Horizon -1 User Interface/   # Primary production FastAPI web dashboard & camera backend
│   ├── app.py                          # Central hub server, sky math, GoTo & sidereal tracking loop
│   ├── camera_backend.py               # Canon EOS 60D PTP USB controller & realistic fallback simulator
│   ├── Run_Telescope.bat               # Windows quick-launch script
│   ├── captures/                       # Directory for saved astrophotography frames
│   ├── esp_final_logic/                # Production non-blocking ESP32 firmware
│   │   └── stepper_final_logic/
│   │       └── stepper_final_logic.ino
│   └── static/                         # Frontend assets (tactical night-vision UI, canvas sky map)
│       ├── app.js
│       ├── camera.js
│       ├── index.html
│       ├── camera.html
│       ├── style.css
│       └── camera.css
├── CADS/                               # SolidWorks 3D CAD parts and subassemblies
│   ├── OTA With Clamp.SLDASM           # Optical Tube Assembly and mounting clamps
│   ├── Worm Assembly.SLDASM            # NEMA 17 120:1 worm drive transmission assembly
│   ├── azimuthal axis.SLDASM           # Rotational base and thrust bearing assembly
│   ├── Lens Cell.SLDPRT / Lens cap     # 3D printable objective lens cell
│   ├── Draw tube.SLDPRT                # 1.25" rack-and-pinion / friction draw tube
│   ├── Printables/ & Printables-1/     # STL and 3D printing export files
│   └── Worm Gear.gif                   # Worm reduction kinematic preview
├── FEA Simulation/                     # Computational optical simulation & ray tracing
│   ├── FEA Model (Objective Lens).mph  # COMSOL Multiphysics polychromatic ray tracing model
│   └── Results/                        # Generated spot diagrams, meshing, and focal plane plots
├── Final Assembly/                     # Final consolidated SolidWorks assembly files & printable STLs
│   ├── final assembly.SLDASM
│   ├── Assembly for print.SLDASM
│   └── Lower Holder finalized.STL
├── Lets make a new focusing system/    # Upgraded 1.25" DSLR T-Ring adapter & draw tube models
│   ├── Draw tube.STL
│   └── T-Ring_Adapter_1.25_.stl
├── Microcontroller Code/               # Development and test firmware sketches
│   ├── main_source/                    # FreeRTOS dual-queue prototyping sketch
│   ├── Stepper/                        # Standalone A4988/DRV8825 stepper driver test code
│   └── Test/                           # Wi-Fi connectivity and diagnostic scripts
├── PDF Documents/                      # Academic reports and engineering documentation
│   ├── Project Proposal.pdf            # ME 366 project proposal white paper
│   └── FEA Simulation Report.pdf       # Comprehensive COMSOL ray tracing & spot analysis report
├── Bill Of Material-BH1/               # Financial expenditure statement & itemized BOM
│   ├── bill_of_materials_BH1.pdf
│   └── bill_of_materials_BH1.tex
└── Updated UI/                         # Staging & mirror UI backup directory
```

---

## 🔬 Optomechanical & Kinematic Specifications

### 1. Optical Specifications (COMSOL Multiphysics Verified)

| Parameter | Value | Details / Remarks |
| :--- | :--- | :--- |
| **Optical Design** | Achromatic Doublet Refractor | Crown & Flint glass combination |
| **Clear Aperture ($D$)** | $80\text{ mm}$ | Optimized light gathering with minimal weight |
| **Focal Length ($f$)** | $\approx 900\text{ mm}$ | Paraxial convergence verified at $z = 899.484\text{ mm}$ |
| **Focal Ratio** | $f/11.25$ | High focal ratio eliminates spherical & color aberration |
| **Spectral Range** | $400\text{ nm} - 700\text{ nm}$ | Polychromatic visible band ($\Delta \lambda = 50\text{ nm}$) |
| **RMS Spot Radius ($r_{\text{rms}}$)** | $68.1\,\mu\text{m}$ | Point-source diffraction circle well within Airy limit |
| **Anti-Reflective Coating** | Thin-Film AR | Eliminates internal ghost reflections & flaring |

### 2. Electromechanical Kinematics

Both Altitude (elevation) and Azimuth (heading) axes use high-torque bipolar NEMA 17 stepper motors with a custom **120:1 precision worm gear reduction**:

$$\text{Steps per Revolution}_{\text{motor}} = 200\quad (1.8^\circ/\text{step})$$

$$\text{Total Steps per Revolution} = 200 \times 16\,(\text{microstepping}) \times 120\,(\text{gear ratio}) = 384,000\text{ steps}$$

$$\text{Angular Resolution} = \frac{384,000\text{ steps}}{360^\circ} \approx 1,066.667\text{ steps/degree} \quad (0.0009375^\circ/\text{step} \approx 3.375\text{ arcsec/step})$$

- **Self-Locking**: The worm drive is physically non-backdrivable, preventing telescope sag or gravitational drift when unpowered.
- **Interleaved Motor Pulse Timing**: $200\,\mu\text{s}$ pulse half-period delay ensures torque retention and prevents missed steps under load.

---

## ⚡ Electronics & Wiring Diagram

The telescope is controlled by an **ESP32 Dev Module** running custom non-blocking C++ firmware.

### Pinout Configuration

| Function | ESP32 GPIO Pin | Connection Target |
| :--- | :--- | :--- |
| **Azimuth Step** | `GPIO 18` | Azimuth Driver `STEP` |
| **Azimuth Direction** | `GPIO 19` | Azimuth Driver `DIR` |
| **Altitude Step** | `GPIO 22` | Altitude Driver `STEP` |
| **Altitude Direction** | `GPIO 23` | Altitude Driver `DIR` |
| **Status / Telemetry LED** | `GPIO 2` | Onboard Built-in Blue LED |
| **Driver Enable** | Connected to `GND` | Both drivers permanently enabled |
| **Microstep Configuration** | `MS1`, `MS2`, `MS3` tied to `VCC` | Configured for 1/16 Microstepping |
| **Motor Power** | External 12V Li-ion Battery | Connected to Driver `VMOT` & `GND` |
| **Logic Power** | Common Ground + 5V Bus | ESP32 `VIN` & Driver `VDD` |

---

## 🚀 Getting Started & Installation

### 1. Prerequisites
- **Python**: Version `3.10` or higher
- **Arduino IDE**: Version `2.0+` with ESP32 board support installed (`esp32 by Espressif Systems`)
- **USB Cable & Wi-Fi Network**: Local 2.4 GHz network to connect the host workstation and ESP32

---

### 2. Microcontroller Firmware Setup

1. Open Arduino IDE.
2. Open [`Beyond Horizon -1 User Interface/esp_final_logic/stepper_final_logic/stepper_final_logic.ino`](file:///d:/BH-1%20Git/Beyond_Horizon_1/Beyond%20Horizon%20-1%20User%20Interface/esp_final_logic/stepper_final_logic/stepper_final_logic.ino).
3. Set your Wi-Fi SSID and Password:
   ```cpp
   const char* ssid     = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   ```
4. Select board **ESP32 Dev Module** and the corresponding COM port.
5. Click **Upload**.
6. Open Serial Monitor (`115200 baud`) to note down the assigned IP Address (e.g. `10.82.105.224` or `192.168.x.x`).

---

### 3. Host Web Interface Setup

1. Clone or open the repository:
   ```bash
   cd "d:/BH-1 Git/Beyond_Horizon_1/Beyond Horizon -1 User Interface"
   ```

2. Install Python dependencies:
   ```bash
   pip install fastapi uvicorn requests pyserial opencv-python pydantic numpy
   ```

3. Update the ESP32 IP address in [`app.py`](file:///d:/BH-1%20Git/Beyond_Horizon_1/Beyond%20Horizon%20-1%20User%20Interface/app.py#L48):
   ```python
   # Line 48 in app.py:
   ESP_IP = "YOUR_ESP32_IP_ADDRESS"
   ```

4. Launch the application:
   - **Double-click** `Run_Telescope.bat`, or
   - **Run from terminal**:
     ```bash
     python app.py
     ```

5. Open your browser and navigate to:
   ```text
   http://localhost:8000
   ```
   *(For remote control from a mobile phone or tablet on the same Wi-Fi, visit `http://<HOST_PC_IP>:8000`)*.

---

## 🎮 Operation & User Guide

### 1. Multi-Mode Alignment & Calibration
Before executing accurate celestial GoTo commands, synchronize the telescope coordinate system using any of the 3 calibration modes:
- **Mode 1: Celestial Star / Object Sync**: Center a bright star or planet (e.g., Polaris, Vega, Jupiter) in the eyepiece, select it on the canvas sky map or search box, and click **"CALIBRATE TO OBJECT"**.
- **Mode 2: Cardinal Heading & Level Alignment**: Level the telescope tube horizontally ($0^\circ$ Alt) facing North ($0^\circ$ Az) or point to Zenith ($90^\circ$ Alt) and apply the preset cardinal sync.
- **Mode 3: Direct Manual Entry**: Input exact current Altitude and Azimuth angles directly.

### 2. GoTo Target Slew
- Type the name of any target celestial object (e.g., *Moon, Jupiter, Saturn, Mars, Pleiades, Orion Nebula*) in the search box.
- The UI calculates real-time local Altitude and Azimuth based on the observer's GPS coordinates (default: Dhaka, Bangladesh $23.81^\circ\text{N}, 90.41^\circ\text{E}$).
- Click **"GOTO TARGET"**: the hub computes required $\Delta\text{Alt}$ and $\Delta\text{Az}$ angles and commands the ESP32 to steer the mount simultaneously.

### 3. Sidereal Tracking
- Once on target, toggle **"ENABLE SIDEREAL TRACKING (1Hz)"**.
- The tracking loop calculates Earth’s diurnal rotation rate and emits continuous micro-stepping compensation packets to keep the object centered in the camera sensor over extended observation sessions.

### 4. Astrophotography & Intervalometer
- Navigate to the **Camera Panel** (`/api/camera` / `camera.html`).
- Adjust ISO, Shutter Speed (including **BULB** long exposures), and White Balance.
- Set up an automated sequence (e.g. 30 frames $\times$ 15 seconds exposure with 2-second dither gap).
- Click **"START INTERVALOMETER"** and observe live exposure progress; saved frames are cataloged in `captures/`.

---

## 💰 Bill of Materials (BOM) & Budget

The table below summarizes the verified project expenditure from [`bill_of_materials_BH1.tex`](file:///d:/BH-1%20Git/Beyond_Horizon_1/Bill%20Of%20Material-BH1/bill_of_materials_BH1.tex):

| SL | Category & Component Description | Source / Vendor | Cost (BDT) |
| :-: | :--- | :--- | -: |
| 1 | Optical Objective Lens ($80\text{ mm}$ Doublet) | Sourced / Patuatuli Optics Market | 6,000 |
| 2 | Optical Eyepiece & Secondary Optical Parts | Patuatuli Optics Market | 3,290 |
| 3 | ESP32 Microcontroller & Vernier Precision Scale | Electronics Vendor | 1,160 |
| 4 | 3D Printing Polymers (Mounts, Clamps, Gear housings) | 3D Rapid Prototyping Service | 7,500 |
| 5 | Battery Pack & High-Discharge Power Accessories | Local Battery Vendor | 2,860 |
| 6 | Structural Chassis (PVC Pipe, Wood, Carpentry, Cutting) | Local Materials & Hardware | 1,720 |
| 7 | Precision Mechanics (Ball Bearings, Steel Shafts, Clamps) | Machine Hardware Market | 1,070 |
| 8 | Actuators, Motor Drivers & Solder Supplies | Mechatronics Vendor | 2,323 |
| 9 | Hardware Screws, Adhesives, Documentation & Field Logistics | Local Vendors | 675 |
| **TOTAL** | **Full Functional Prototype Expenditure** | **Indigenous Bangladeshi Sourcing** | **26,598 BDT** |

*(26,598 BDT $\approx$ **$220 USD** as of October 2026)*

---

## 👥 Engineering Team & Credits

Developed as part of the **ME 366: Electro-Mechanical System Design** curriculum at **BUET**:

- **Institution**: Department of Mechanical Engineering, **Bangladesh University of Engineering and Technology (BUET)**
- **Academic Course**: ME 366 (Electro-Mechanical System Design)
- **Supervised Under**: Faculty of Mechanical Engineering, BUET
- **Student Researchers & Designers**:
  - `2210070`
  - `2210071`
  - `2210072`
  - `2210074`
- **GitHub Repository**: [M000nwalker/Beyond_Horizon_1](https://github.com/M000nwalker/Beyond_Horizon_1)

---

## 📜 License

This project is licensed under the [MIT License](LICENSE) — free for educational, academic, and amateur astronomy development.
