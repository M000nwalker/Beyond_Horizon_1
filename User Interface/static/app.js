/* ==========================================================================
   BEYOND HORIZON -1 TACTICAL DASHBOARD FRONTEND APPLICATION LOGIC
   Handles Stellarium sync, ESP32 serial commands, OpenCV camera live stream,
   Pannable/Zoomable 2D Sky Map Engine, Degree Telemetry, and Active Tracking.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // Current App State Cache
    const appState = {
        esp32Connected: false,
        cameraConnected: false,
        stellariumConnected: false,
        selectedTarget: {
            name: "Jupiter",
            altitude: 58.4,
            azimuth: 142.8,
            ra_str: "02h 15m 12.0s",
            dec_str: "+12° 30' 45\"",
            type: "Planet"
        },
        telemetry: {
            currentAlt: 0.0,
            currentAz: 0.0,
            targetAlt: 58.4,
            targetAz: 142.8,
            deltaAlt: 58.4,
            deltaAz: 142.8,
            isCalibrated: false,
            trackingEnabled: false
        },
        skymapData: [],
        showGrid: true,
        panX: 0,
        panY: 0,
        zoomScale: 1.0,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        isTypingInSearch: false  // Guard: prevents real-time updates from touching search input
    };

    // DOM Elements Cache
    const elements = {
        // Badges & Clock
        badgeEsp32: document.getElementById('badge-esp32'),
        badgeCamera: document.getElementById('badge-camera'),
        systemClock: document.getElementById('system-clock'),

        // Indicators
        indEsp32: document.getElementById('ind-esp32'),
        indEsp32Txt: document.getElementById('ind-esp32-txt'),
        indCamera: document.getElementById('ind-camera'),
        indCameraTxt: document.getElementById('ind-camera-txt'),

        // Hardware Controls
        comPortSelect: document.getElementById('com-port-select'),
        btnRefreshPorts: document.getElementById('btn-refresh-ports'),
        btnToggleEsp32: document.getElementById('btn-toggle-esp32'),
        btnToggleCamera: document.getElementById('btn-toggle-camera'),

        // Location & Time
        inputLat: document.getElementById('input-lat'),
        inputLon: document.getElementById('input-lon'),
        inputElevation: document.getElementById('input-elevation'),
        txtBrowserTime: document.getElementById('txt-browser-time'),
        btnSyncLocation: document.getElementById('btn-sync-location'),
        locationSyncFeedback: document.getElementById('location-sync-feedback'),

        // Target & GoTo
        targetSearchInput: document.getElementById('target-search-input'),
        btnSearchTarget: document.getElementById('btn-search-target'),
        gotoFeedback: document.getElementById('goto-feedback'),

        // Sky Map Elements
        skymapCanvas: document.getElementById('skymap-canvas'),
        canvasOverlayControls: document.getElementById('canvas-overlay-controls'),
        canvasHelpText: document.getElementById('canvas-help-text'),
        btnMapToggleGrid: document.getElementById('btn-map-toggle-grid'),
        btnMapResetView: document.getElementById('btn-map-reset-view'),
        mapTargetName: document.getElementById('map-target-name'),
        mapTargetType: document.getElementById('map-target-type'),
        mapTargetAlt: document.getElementById('map-target-alt'),
        mapTargetAz: document.getElementById('map-target-az'),
        btnMapGoto: document.getElementById('btn-map-goto'),
        btnMapCalibrate: document.getElementById('btn-map-calibrate'),

        // Telemetry & Tracking
        valCurrentAlt: document.getElementById('val-current-alt'),
        valCurrentAz: document.getElementById('val-current-az'),
        valDeltaAlt: document.getElementById('val-delta-alt'),
        valDeltaAz: document.getElementById('val-delta-az'),
        trackStatusPill: document.getElementById('track-status-pill'),
        btnToggleTracking: document.getElementById('btn-toggle-tracking'),
        calibrationStatusTag: document.getElementById('calibration-status-tag'),
        calibrationFeedback: document.getElementById('calibration-feedback'),
        calibActiveTargetDisplay: document.getElementById('calib-active-target-display'),
        autocompleteDropdown: document.getElementById('autocomplete-dropdown'),
        btnCalibStarSubmit: document.getElementById('btn-calib-star-submit'),
        calibCardinalDir: document.getElementById('calib-cardinal-dir'),
        calibElevationPreset: document.getElementById('calib-elevation-preset'),
        btnCalibCardinalSubmit: document.getElementById('btn-calib-cardinal-submit'),
        calibManualAlt: document.getElementById('calib-manual-alt'),
        calibManualAz: document.getElementById('calib-manual-az'),
        btnCalibManualSubmit: document.getElementById('btn-calib-manual-submit'),

        // D-Pad
        slewSpeedSelect: document.getElementById('slew-speed-select'),
        btnDpadUp: document.getElementById('btn-dpad-up'),
        btnDpadDown: document.getElementById('btn-dpad-down'),
        btnDpadLeft: document.getElementById('btn-dpad-left'),
        btnDpadRight: document.getElementById('btn-dpad-right'),
        btnDpadStop: document.getElementById('btn-dpad-stop'),

        // Camera & Accordion
        cameraAccordionToggle: document.getElementById('camera-accordion-toggle'),
        cameraAccordionArrow: document.getElementById('camera-accordion-arrow'),
        cameraAccordionBody: document.getElementById('camera-accordion-body'),
        camIsoSelect: document.getElementById('cam-iso-select'),
        camShutterSelect: document.getElementById('cam-shutter-select'),
        interFrames: document.getElementById('inter-frames'),
        interExposure: document.getElementById('inter-exposure'),
        interDelay: document.getElementById('inter-delay'),
        txtInterStatus: document.getElementById('txt-inter-status'),
        txtInterProgress: document.getElementById('txt-inter-progress'),
        interProgressFill: document.getElementById('inter-progress-fill'),
        btnStartIntervalometer: document.getElementById('btn-start-intervalometer'),
        btnStopIntervalometer: document.getElementById('btn-stop-intervalometer')
    };

    // System Clock
    function updateClock() {
        const now = new Date();
        elements.systemClock.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
        elements.txtBrowserTime.textContent = now.toLocaleString();
    }
    setInterval(updateClock, 1000);
    updateClock();

    // --------------------------------------------------------------------------
    // 1. HARDWARE CONNECTION LOGIC
    // --------------------------------------------------------------------------
    async function loadComPorts() {
        try {
            const res = await fetch('/api/hardware/ports');
            const data = await res.json();
            if (data.ports && data.ports.length > 0) {
                elements.comPortSelect.innerHTML = '';
                data.ports.forEach(port => {
                    const opt = document.createElement('option');
                    opt.value = port;
                    opt.textContent = port;
                    elements.comPortSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('Failed to query available COM ports:', err);
        }
    }
    elements.btnRefreshPorts.addEventListener('click', loadComPorts);

    elements.btnToggleEsp32.addEventListener('click', async () => {
        if (!appState.esp32Connected) {
            const selectedPort = elements.comPortSelect.value || "COM3";
            try {
                const res = await fetch('/api/hardware/esp32/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ port: selectedPort, baud: 115200 })
                });
                const data = await res.json();
                appState.esp32Connected = true;
                elements.btnToggleEsp32.textContent = "DISCONNECT ESP32";
                elements.btnToggleEsp32.classList.add('btn-high-accent');
                elements.indEsp32Txt.textContent = `ESP32 Active (${data.mode === 'hardware' ? 'Hardware Serial' : 'Terminal Packet Output'})`;
            } catch (err) {
                console.error('ESP32 Connection error:', err);
            }
        } else {
            try {
                await fetch('/api/hardware/esp32/disconnect', { method: 'POST' });
                appState.esp32Connected = false;
                elements.btnToggleEsp32.textContent = "CONNECT ESP32";
                elements.btnToggleEsp32.classList.remove('btn-high-accent');
                elements.indEsp32Txt.textContent = "ESP32 Serial (Disconnected)";
            } catch (err) {
                console.error('ESP32 Disconnect error:', err);
            }
        }
        updateStatusBadges();
    });

    elements.btnToggleCamera.addEventListener('click', async () => {
        appState.cameraConnected = !appState.cameraConnected;
        try {
            await fetch('/api/camera/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connect: appState.cameraConnected })
            });

            if (appState.cameraConnected) {
                elements.btnToggleCamera.textContent = "DISCONNECT CAMERA";
                elements.btnToggleCamera.classList.add('btn-high-accent');
                elements.indCameraTxt.textContent = "Canon DSLR Live Stream (Active 10 FPS)";
            } else {
                elements.btnToggleCamera.textContent = "CONNECT CAMERA";
                elements.btnToggleCamera.classList.remove('btn-high-accent');
                elements.indCameraTxt.textContent = "Canon DSLR Live Stream (Inactive)";
            }
            updateStatusBadges();
        } catch (err) {
            console.error('Camera toggle error:', err);
        }
    });

    function updateStatusBadges() {
        const espDot = elements.badgeEsp32.querySelector('.status-dot');
        if (appState.esp32Connected) {
            espDot.className = 'status-dot connected';
            elements.indEsp32.classList.add('active');
        } else {
            espDot.className = 'status-dot disconnected';
            elements.indEsp32.classList.remove('active');
        }

        const camDot = elements.badgeCamera.querySelector('.status-dot');
        if (appState.cameraConnected) {
            camDot.className = 'status-dot connected';
            elements.indCamera.classList.add('active');
        } else {
            camDot.className = 'status-dot disconnected';
            elements.indCamera.classList.remove('active');
        }
    }

    // --------------------------------------------------------------------------
    // 2. LOCATION & TIME SYNCHRONIZATION
    // --------------------------------------------------------------------------
    elements.btnSyncLocation.addEventListener('click', () => {
        elements.locationSyncFeedback.textContent = "Requesting Browser Geolocation...";

        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;
                    const alt = position.coords.altitude || 15.0;

                    elements.inputLat.value = lat.toFixed(6);
                    elements.inputLon.value = lon.toFixed(6);
                    elements.inputElevation.value = Math.round(alt);

                    await sendLocationToBackend(lat, lon, alt);
                },
                async (error) => {
                    console.warn('Geolocation denied or unavailable. Using form fields.', error);
                    const lat = parseFloat(elements.inputLat.value) || 23.810300;
                    const lon = parseFloat(elements.inputLon.value) || 90.412500;
                    const alt = parseFloat(elements.inputElevation.value) || 15.0;
                    await sendLocationToBackend(lat, lon, alt);
                },
                { timeout: 8000, enableHighAccuracy: true }
            );
        } else {
            const lat = parseFloat(elements.inputLat.value);
            const lon = parseFloat(elements.inputLon.value);
            const alt = parseFloat(elements.inputElevation.value);
            sendLocationToBackend(lat, lon, alt);
        }
    });

    async function sendLocationToBackend(lat, lon, alt) {
        try {
            const res = await fetch('/api/stellarium/location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    latitude: lat,
                    longitude: lon,
                    elevation: alt,
                    timestamp: Date.now() / 1000.0
                })
            });
            const data = await res.json();
            if (data.stellarium_pushed) {
                elements.locationSyncFeedback.textContent = `[SUCCESS] Coordinates (Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}) pushed to Stellarium environment!`;
            } else {
                elements.locationSyncFeedback.textContent = `[LOCAL SYNC] Coordinates registered locally. (Stellarium HTTP API link offline)`;
            }
        } catch (err) {
            elements.locationSyncFeedback.textContent = `[ERROR] Failed to send location: ${err.message}`;
        }
    }

    // --------------------------------------------------------------------------
    // 3. UNIFIED TARGET SEARCH, AUTOCOMPLETE & GOTO ENGINE
    // --------------------------------------------------------------------------
    function updateTargetDisplays(targetData, updateSearchInputBox = false) {
        // Normalize field names — API may return altitude/azimuth or alt/az
        const alt = targetData.altitude !== undefined ? targetData.altitude : (targetData.alt || 0);
        const az  = targetData.azimuth  !== undefined ? targetData.azimuth  : (targetData.az  || 0);
        targetData.altitude = alt;
        targetData.azimuth  = az;

        appState.selectedTarget = targetData;

        // ONLY update input box text when explicitly selected by user interaction
        // AND only if user is not currently typing in the search box
        if (updateSearchInputBox && elements.targetSearchInput && !appState.isTypingInSearch) {
            elements.targetSearchInput.value = targetData.name;
        }

        if (elements.mapTargetName) elements.mapTargetName.textContent = targetData.name.toUpperCase();
        if (elements.mapTargetType) elements.mapTargetType.textContent = (targetData.type || "CELESTIAL").toUpperCase();
        if (elements.mapTargetAlt) elements.mapTargetAlt.textContent = `${alt.toFixed(2)}°`;
        if (elements.mapTargetAz) elements.mapTargetAz.textContent = `${az.toFixed(2)}°`;

        if (elements.calibActiveTargetDisplay) {
            elements.calibActiveTargetDisplay.textContent = `${targetData.name.toUpperCase()} (Alt ${alt.toFixed(4)}°, Az ${az.toFixed(4)}°)`;
        }

        drawSkyMap();
    }

    function renderAutocompleteDropdown(matches) {
        if (!elements.autocompleteDropdown) return;
        elements.autocompleteDropdown.innerHTML = '';

        if (!matches || matches.length === 0) {
            elements.autocompleteDropdown.classList.add('hidden');
            return;
        }

        matches.forEach(item => {
            const div = document.createElement('div');
            div.className = 'autocomplete-item';
            div.innerHTML = `
                <span class="item-name">${item.name}</span>
                <div class="item-meta">
                    <span class="item-type">${item.type}</span>
                    <span class="item-coords">Alt ${item.altitude.toFixed(1)}° Az ${item.azimuth.toFixed(1)}°</span>
                </div>
            `;
            div.addEventListener('click', () => {
                updateTargetDisplays(item, true);
                elements.autocompleteDropdown.classList.add('hidden');
                elements.gotoFeedback.textContent = `Target set to "${item.name}". Click 'POINT TO TARGET' to execute GoTo.`;
            });
            elements.autocompleteDropdown.appendChild(div);
        });

        elements.autocompleteDropdown.classList.remove('hidden');
    }

    elements.targetSearchInput.addEventListener('focus', () => {
        appState.isTypingInSearch = true;
    });

    elements.targetSearchInput.addEventListener('blur', () => {
        // Small delay so autocomplete click events can fire first
        setTimeout(() => { appState.isTypingInSearch = false; }, 300);
    });

    elements.targetSearchInput.addEventListener('input', () => {
        appState.isTypingInSearch = true;
        const query = elements.targetSearchInput.value.trim().toLowerCase();
        if (!query) {
            elements.autocompleteDropdown.classList.add('hidden');
            return;
        }

        if (appState.skymapData && appState.skymapData.length > 0) {
            const matches = appState.skymapData.filter(obj => obj.name.toLowerCase().includes(query));
            renderAutocompleteDropdown(matches);
        }
    });

    document.addEventListener('click', (e) => {
        if (elements.autocompleteDropdown && !e.target.closest('.search-input-wrapper')) {
            elements.autocompleteDropdown.classList.add('hidden');
        }
    });

    elements.targetSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.autocompleteDropdown) {
            elements.autocompleteDropdown.classList.add('hidden');
        }
    });

    async function searchTarget() {
        const query = elements.targetSearchInput.value.trim();
        if (!query) return;

        elements.autocompleteDropdown.classList.add('hidden');
        elements.gotoFeedback.textContent = `Searching database for "${query}"...`;
        try {
            const res = await fetch('/api/stellarium/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query })
            });
            const data = await res.json();
            if (data.found) {
                updateTargetDisplays(data, true);
                elements.gotoFeedback.textContent = `Target ready. Click 'POINT TO TARGET' to execute GoTo slew.`;
            } else {
                elements.gotoFeedback.textContent = `Object "${query}" not found in database.`;
            }
        } catch (err) {
            elements.gotoFeedback.textContent = `Search error: ${err.message}`;
        }
    }

    elements.btnSearchTarget.addEventListener('click', searchTarget);
    elements.targetSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchTarget();
    });

    async function executeGoTo() {
        if (!appState.selectedTarget) return;

        elements.gotoFeedback.textContent = `Transmitting GoTo packet for ${appState.selectedTarget.name}...`;
        try {
            const res = await fetch('/api/mount/goto', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    alt: appState.selectedTarget.altitude,
                    az: appState.selectedTarget.azimuth,
                    target_name: appState.selectedTarget.name
                })
            });
            const data = await res.json();
            elements.gotoFeedback.textContent = `[GOTO EXECUTED] Degree packet sent: ${data.packet_sent}`;
            pollHardwareStatus();
        } catch (err) {
            elements.gotoFeedback.textContent = `GoTo command error: ${err.message}`;
        }
    }

    elements.btnMapGoto.addEventListener('click', executeGoTo);

    // --------------------------------------------------------------------------
    // 5. PANNABLE & ZOOMABLE 2D SKY MAP CANVAS ENGINE
    // --------------------------------------------------------------------------
    const canvas = elements.skymapCanvas;
    const ctx = canvas.getContext('2d');

    function altAzToCanvasCoords(alt, az, width, height) {
        const centerX = (width / 2) + appState.panX;
        const centerY = (height / 2) + appState.panY;
        const maxRadius = (Math.min(width / 2, height / 2) - 30) * appState.zoomScale;

        const normAlt = Math.max(0, Math.min(90, alt));
        const r = maxRadius * (1 - normAlt / 90.0);
        const theta = (az - 90.0) * (Math.PI / 180.0);

        const x = centerX + r * Math.cos(theta);
        const y = centerY + r * Math.sin(theta);

        return { x, y, r, maxRadius, centerX, centerY };
    }

    function canvasCoordsToAltAz(x, y, width, height) {
        const centerX = (width / 2) + appState.panX;
        const centerY = (height / 2) + appState.panY;
        const maxRadius = (Math.min(width / 2, height / 2) - 30) * appState.zoomScale;

        const dx = x - centerX;
        const dy = y - centerY;
        const r = Math.sqrt(dx * dx + dy * dy);

        let alt = 90.0 * (1.0 - r / maxRadius);
        alt = Math.max(0, Math.min(90, alt));

        let theta = Math.atan2(dy, dx) * (180.0 / Math.PI);
        let az = (theta + 90.0 + 360.0) % 360.0;

        return { alt: roundVal(alt, 2), az: roundVal(az, 2) };
    }

    function roundVal(v, p) {
        const factor = Math.pow(10, p);
        return Math.round(v * factor) / factor;
    }

    function drawSkyMap() {
        if (!canvas || elements.skymapCanvas.classList.contains('hidden')) return;

        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        const centerX = (w / 2) + appState.panX;
        const centerY = (h / 2) + appState.panY;
        const maxRadius = (Math.min(w / 2, h / 2) - 30) * appState.zoomScale;

        // Background Sky
        ctx.fillStyle = '#020202';
        ctx.fillRect(0, 0, w, h);

        // Horizon Circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, maxRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#060606';
        ctx.fill();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Grid Overlay
        if (appState.showGrid) {
            ctx.strokeStyle = '#300a0a';
            ctx.lineWidth = 1;
            ctx.fillStyle = '#b91c1c';
            ctx.font = '10px Share Tech Mono';

            [30, 60].forEach(altRing => {
                const r = maxRadius * (1 - altRing / 90.0);
                ctx.beginPath();
                ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.fillText(`${altRing}°`, centerX + 4, centerY - r + 12);
            });

            const cardinals = [
                { angle: 0, label: 'N', x: centerX, y: centerY - maxRadius - 10 },
                { angle: 90, label: 'E', x: centerX + maxRadius + 10, y: centerY + 4 },
                { angle: 180, label: 'S', x: centerX, y: centerY + maxRadius + 18 },
                { angle: 270, label: 'W', x: centerX - maxRadius - 18, y: centerY + 4 }
            ];

            cardinals.forEach(c => {
                const rad = (c.angle - 90) * (Math.PI / 180);
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.lineTo(centerX + maxRadius * Math.cos(rad), centerY + maxRadius * Math.sin(rad));
                ctx.stroke();

                ctx.fillStyle = '#ff1a1a';
                ctx.font = 'bold 12px Orbitron';
                ctx.fillText(c.label, c.x - 4, c.y);
            });
        }

        // Celestial Objects
        if (appState.skymapData && appState.skymapData.length > 0) {
            appState.skymapData.forEach(obj => {
                const pos = altAzToCanvasCoords(obj.altitude, obj.azimuth, w, h);

                if (obj.type === 'Planet' || obj.type === 'Satellite') {
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 6 * appState.zoomScale, 0, 2 * Math.PI);
                    ctx.fillStyle = 'rgba(255, 77, 77, 0.4)';
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 3 * appState.zoomScale, 0, 2 * Math.PI);
                    ctx.fillStyle = '#ff1a1a';
                    ctx.fill();

                    ctx.fillStyle = '#ff4d4d';
                    ctx.font = '10px Share Tech Mono';
                    ctx.fillText(obj.name, pos.x + 8, pos.y + 3);
                } else if (obj.type === 'Galaxy' || obj.type === 'Nebula') {
                    ctx.beginPath();
                    ctx.setLineDash([2, 2]);
                    ctx.ellipse(pos.x, pos.y, 10 * appState.zoomScale, 6 * appState.zoomScale, Math.PI / 4, 0, 2 * Math.PI);
                    ctx.strokeStyle = '#ef4444';
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.fillStyle = '#b91c1c';
                    ctx.font = '10px Share Tech Mono';
                    ctx.fillText(obj.name, pos.x + 12, pos.y + 3);
                } else {
                    const size = Math.max(1.5, (3.5 - (obj.magnitude || 2.0) * 0.5) * appState.zoomScale);
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, size, 0, 2 * Math.PI);
                    ctx.fillStyle = '#ff6666';
                    ctx.shadowColor = '#ff1a1a';
                    ctx.shadowBlur = 4;
                    ctx.fill();
                    ctx.shadowBlur = 0;

                    if (obj.magnitude < 2.0) {
                        ctx.fillStyle = '#ff4d4d';
                        ctx.font = '9px Share Tech Mono';
                        ctx.fillText(obj.name, pos.x + 6, pos.y - 4);
                    }
                }
            });
        }

        // Selected Target Ring
        if (appState.selectedTarget) {
            const tgtPos = altAzToCanvasCoords(appState.selectedTarget.altitude, appState.selectedTarget.azimuth, w, h);
            ctx.beginPath();
            ctx.setLineDash([4, 4]);
            ctx.arc(tgtPos.x, tgtPos.y, 14 * appState.zoomScale, 0, 2 * Math.PI);
            ctx.strokeStyle = '#ff1a1a';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Telescope Aim Reticle
        const telPos = altAzToCanvasCoords(appState.telemetry.currentAlt, appState.telemetry.currentAz, w, h);
        ctx.strokeStyle = '#ff1a1a';
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        ctx.arc(telPos.x, telPos.y, 10 * appState.zoomScale, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(telPos.x - 16 * appState.zoomScale, telPos.y); ctx.lineTo(telPos.x - 5 * appState.zoomScale, telPos.y);
        ctx.moveTo(telPos.x + 5 * appState.zoomScale, telPos.y);  ctx.lineTo(telPos.x + 16 * appState.zoomScale, telPos.y);
        ctx.moveTo(telPos.x, telPos.y - 16 * appState.zoomScale); ctx.lineTo(telPos.x, telPos.y - 5 * appState.zoomScale);
        ctx.moveTo(telPos.x, telPos.y + 5 * appState.zoomScale);  ctx.lineTo(telPos.x, telPos.y + 16 * appState.zoomScale);
        ctx.stroke();
    }

    // Panning & Zooming Event Listeners
    canvas.addEventListener('mousedown', (e) => {
        appState.isDragging = true;
        appState.dragStartX = e.clientX - appState.panX;
        appState.dragStartY = e.clientY - appState.panY;
    });

    canvas.addEventListener('mousemove', (e) => {
        if (appState.isDragging) {
            appState.panX = e.clientX - appState.dragStartX;
            appState.panY = e.clientY - appState.dragStartY;
            drawSkyMap();
        }
    });

    canvas.addEventListener('mouseup', () => { appState.isDragging = false; });
    canvas.addEventListener('mouseleave', () => { appState.isDragging = false; });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        appState.zoomScale = Math.max(0.5, Math.min(5.0, appState.zoomScale * zoomFactor));
        drawSkyMap();
    });

    // Canvas Click Selection
    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        let clickedObj = null;
        let minDist = 25;

        if (appState.skymapData && appState.skymapData.length > 0) {
            appState.skymapData.forEach(obj => {
                const pos = altAzToCanvasCoords(obj.altitude, obj.azimuth, canvas.width, canvas.height);
                const dist = Math.sqrt(Math.pow(mouseX - pos.x, 2) + Math.pow(mouseY - pos.y, 2));
                if (dist < minDist) {
                    minDist = dist;
                    clickedObj = obj;
                }
            });
        }

        if (clickedObj) {
            updateTargetDisplays(clickedObj);
        } else {
            const coords = canvasCoordsToAltAz(mouseX, mouseY, canvas.width, canvas.height);
            const customTarget = {
                name: `Sky Pos (Alt ${coords.alt}°, Az ${coords.az}°)`,
                type: "Sky Location",
                ra_str: "--",
                dec_str: "--",
                altitude: coords.alt,
                azimuth: coords.az,
                magnitude: 6.0
            };
            updateTargetDisplays(customTarget);
        }

        drawSkyMap();
    });

    elements.btnMapToggleGrid.addEventListener('click', () => {
        appState.showGrid = !appState.showGrid;
        elements.btnMapToggleGrid.classList.toggle('active');
        elements.btnMapToggleGrid.textContent = `GRID: ${appState.showGrid ? 'ON' : 'OFF'}`;
        drawSkyMap();
    });

    elements.btnMapResetView.addEventListener('click', () => {
        appState.panX = 0;
        appState.panY = 0;
        appState.zoomScale = 1.0;
        drawSkyMap();
    });

    // --------------------------------------------------------------------------
    // 6. REAL-TIME SIDEREAL TRACKING TOGGLE
    // --------------------------------------------------------------------------
    elements.btnToggleTracking.addEventListener('click', async () => {
        const enableNew = !appState.telemetry.trackingEnabled;
        try {
            const res = await fetch('/api/mount/tracking/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enable: enableNew })
            });
            const data = await res.json();
            appState.telemetry.trackingEnabled = data.tracking_enabled;

            if (data.tracking_enabled) {
                elements.trackStatusPill.textContent = "ACTIVE (1Hz)";
                elements.trackStatusPill.classList.add('active');
                elements.btnToggleTracking.textContent = "DISABLE SIDEREAL TRACKING";
            } else {
                elements.trackStatusPill.textContent = "OFF";
                elements.trackStatusPill.classList.remove('active');
                elements.btnToggleTracking.textContent = "ENABLE SIDEREAL TRACKING (1Hz)";
            }
        } catch (err) {
            console.error('Failed to toggle tracking:', err);
        }
    });

    // --------------------------------------------------------------------------
    // 7. MULTI-MODE ALIGNMENT & CALIBRATION SUITE
    // --------------------------------------------------------------------------
    const tabBtns = document.querySelectorAll('.calib-tab-btn');
    const tabContents = document.querySelectorAll('.calib-tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetTabId = btn.getAttribute('data-tab');
            document.getElementById(targetTabId).classList.add('active');
        });
    });

    elements.btnCalibStarSubmit.addEventListener('click', async () => {
        if (!appState.selectedTarget) return;
        const starName = appState.selectedTarget.name;
        const alt = appState.selectedTarget.altitude;
        const az = appState.selectedTarget.azimuth;

        elements.calibrationFeedback.textContent = `Aligning mount to active target object "${starName}"...`;
        try {
            const res = await fetch('/api/mount/calibrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'OBJECT', object_name: starName, alt: alt, az: az })
            });
            const data = await res.json();
            elements.calibrationFeedback.textContent = `[SUCCESS] ${data.description}`;
            pollHardwareStatus();
        } catch (err) {
            elements.calibrationFeedback.textContent = `Calibration error: ${err.message}`;
        }
    });

    elements.btnMapCalibrate.addEventListener('click', async () => {
        if (!appState.selectedTarget) return;
        const starName = appState.selectedTarget.name;
        const alt = appState.selectedTarget.altitude;
        const az = appState.selectedTarget.azimuth;

        elements.calibrationFeedback.textContent = `Aligning mount to map object "${starName}"...`;
        try {
            const res = await fetch('/api/mount/calibrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'OBJECT', object_name: starName, alt: alt, az: az })
            });
            const data = await res.json();
            elements.calibrationFeedback.textContent = `[SUCCESS] ${data.description}`;
            pollHardwareStatus();
        } catch (err) {
            elements.calibrationFeedback.textContent = `Calibration error: ${err.message}`;
        }
    });

    elements.btnCalibCardinalSubmit.addEventListener('click', async () => {
        const heading = elements.calibCardinalDir.value;
        const elevation = elements.calibElevationPreset.value;

        elements.calibrationFeedback.textContent = `Applying cardinal alignment (${heading}, ${elevation})...`;
        try {
            const res = await fetch('/api/mount/calibrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'CARDINAL', cardinal_dir: heading, elevation_preset: elevation })
            });
            const data = await res.json();
            elements.calibrationFeedback.textContent = `[SUCCESS] ${data.description}`;
            pollHardwareStatus();
        } catch (err) {
            elements.calibrationFeedback.textContent = `Calibration error: ${err.message}`;
        }
    });

    elements.btnCalibManualSubmit.addEventListener('click', async () => {
        const alt = parseFloat(elements.calibManualAlt.value) || 0.0;
        const az = parseFloat(elements.calibManualAz.value) || 0.0;

        elements.calibrationFeedback.textContent = `Setting mount pointing angles to Alt ${alt}°, Az ${az}°...`;
        try {
            const res = await fetch('/api/mount/calibrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'MANUAL', alt: alt, az: az })
            });
            const data = await res.json();
            elements.calibrationFeedback.textContent = `[SUCCESS] ${data.description}`;
            pollHardwareStatus();
        } catch (err) {
            elements.calibrationFeedback.textContent = `Calibration error: ${err.message}`;
        }
    });

    // --------------------------------------------------------------------------
    // 8. MANUAL DIRECTIONAL SLEW CONTROLS (D-PAD)
    // --------------------------------------------------------------------------
    async function sendSlewCommand(direction) {
        const speed = parseFloat(elements.slewSpeedSelect.value) || 1.0;
        try {
            await fetch('/api/mount/slew', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ direction: direction, speed: speed })
            });
            pollHardwareStatus();
        } catch (err) {
            console.error('Slew command error:', err);
        }
    }

    elements.btnDpadUp.addEventListener('click', () => sendSlewCommand('+ALT'));
    elements.btnDpadDown.addEventListener('click', () => sendSlewCommand('-ALT'));
    elements.btnDpadLeft.addEventListener('click', () => sendSlewCommand('-AZ'));
    elements.btnDpadRight.addEventListener('click', () => sendSlewCommand('+AZ'));
    elements.btnDpadStop.addEventListener('click', () => sendSlewCommand('STOP'));

    // --------------------------------------------------------------------------
    // 9. CAMERA & INTERVALOMETER SUITE
    // --------------------------------------------------------------------------
    elements.cameraAccordionToggle.addEventListener('click', () => {
        elements.cameraAccordionBody.classList.toggle('hidden');
        elements.cameraAccordionArrow.classList.toggle('collapsed');
    });

    async function updateCameraSettings() {
        const iso = elements.camIsoSelect.value;
        const shutter = elements.camShutterSelect.value;
        try {
            await fetch('/api/camera/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ iso: iso, shutter: shutter })
            });
        } catch (err) {
            console.error('Failed to update camera settings:', err);
        }
    }
    elements.camIsoSelect.addEventListener('change', updateCameraSettings);
    elements.camShutterSelect.addEventListener('change', updateCameraSettings);

    elements.btnStartIntervalometer.addEventListener('click', async () => {
        const frames = parseInt(elements.interFrames.value) || 10;
        const exposure = parseFloat(elements.interExposure.value) || 5.0;
        const delay = parseFloat(elements.interDelay.value) || 2.0;

        try {
            await fetch('/api/camera/intervalometer/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frames: frames, exposure: exposure, delay: delay })
            });
            elements.txtInterStatus.textContent = "RUNNING SEQUENCE...";
        } catch (err) {
            console.error('Failed to start intervalometer:', err);
        }
    });

    elements.btnStopIntervalometer.addEventListener('click', async () => {
        try {
            await fetch('/api/camera/intervalometer/stop', { method: 'POST' });
            elements.txtInterStatus.textContent = "STOPPING...";
        } catch (err) {
            console.error('Failed to stop intervalometer:', err);
        }
    });

    // --------------------------------------------------------------------------
    // 10. REAL-TIME HARDWARE & TELEMETRY POLLING LOOP
    // --------------------------------------------------------------------------
    async function pollHardwareStatus() {
        try {
            const stelRes = await fetch('/api/stellarium/status');
            const stelData = await stelRes.json();
            appState.stellariumConnected = stelData.connected;

            const skyRes = await fetch('/api/skymap/objects');
            const skyData = await skyRes.json();
            if (skyData.objects) {
                appState.skymapData = skyData.objects;

                // REAL-TIME TARGET COORDINATE UPDATES
                if (appState.selectedTarget && appState.selectedTarget.name) {
                    const liveObj = skyData.objects.find(o => o.name.toLowerCase() === appState.selectedTarget.name.toLowerCase());
                    if (liveObj) {
                        appState.selectedTarget.altitude = liveObj.altitude;
                        appState.selectedTarget.azimuth = liveObj.azimuth;
                        updateTargetDisplays(appState.selectedTarget);
                    }
                }
            }

            const hwRes = await fetch('/api/hardware/status');
            const hwData = await hwRes.json();

            appState.telemetry.currentAlt = hwData.current_alt_deg;
            appState.telemetry.currentAz = hwData.current_az_deg;
            appState.telemetry.targetAlt = hwData.target_alt_deg;
            appState.telemetry.targetAz = hwData.target_az_deg;
            appState.telemetry.deltaAlt = hwData.required_delta_alt_deg;
            appState.telemetry.deltaAz = hwData.required_delta_az_deg;
            appState.telemetry.isCalibrated = hwData.is_calibrated;
            appState.telemetry.trackingEnabled = hwData.tracking_enabled;

            elements.valCurrentAlt.textContent = `${hwData.current_alt_deg.toFixed(4)}°`;
            elements.valCurrentAz.textContent = `${hwData.current_az_deg.toFixed(4)}°`;

            if (hwData.tracking_enabled) {
                // When actively tracking, mount IS on target — deltas are zero
                elements.valDeltaAlt.textContent = `+0.0000°`;
                elements.valDeltaAz.textContent  = `+0.0000°`;
                elements.valDeltaAlt.style.color = 'var(--text-muted-red)';
                elements.valDeltaAz.style.color  = 'var(--text-muted-red)';
            } else {
                const dAlt = hwData.required_delta_alt_deg;
                const dAz  = hwData.required_delta_az_deg;
                const signAlt = dAlt >= 0 ? '+' : '';
                const signAz  = dAz  >= 0 ? '+' : '';
                elements.valDeltaAlt.textContent = `${signAlt}${dAlt.toFixed(4)}°`;
                elements.valDeltaAz.textContent  = `${signAz}${dAz.toFixed(4)}°`;
                // Color-code: green-ish when nearly aligned, red when large delta needed
                const isAlignedAlt = Math.abs(dAlt) < 0.5;
                const isAlignedAz  = Math.abs(dAz)  < 0.5;
                elements.valDeltaAlt.style.color = isAlignedAlt ? '#22c55e' : 'var(--text-bright-red)';
                elements.valDeltaAz.style.color  = isAlignedAz  ? '#22c55e' : 'var(--text-bright-red)';
            }

            if (hwData.is_calibrated) {
                const calTargetName = hwData.calibrated_target_name || hwData.calibration_mode;
                elements.calibrationStatusTag.textContent = `CALIBRATED: ${calTargetName.toUpperCase()}`;
                elements.calibrationStatusTag.style.borderColor = "var(--border-crimson)";
                elements.calibrationStatusTag.style.color = "var(--text-bright-red)";
            } else {
                elements.calibrationStatusTag.textContent = "NOT CALIBRATED";
            }

            if (hwData.tracking_enabled) {
                elements.trackStatusPill.textContent = "ACTIVE (1Hz)";
                elements.trackStatusPill.classList.add('active');
                elements.btnToggleTracking.textContent = "DISABLE SIDEREAL TRACKING";
            } else {
                elements.trackStatusPill.textContent = "OFF";
                elements.trackStatusPill.classList.remove('active');
                elements.btnToggleTracking.textContent = "ENABLE SIDEREAL TRACKING (1Hz)";
            }

            if (hwData.intervalometer_running) {
                elements.txtInterStatus.textContent = hwData.intervalometer_status;
                // Parse frame progress from "current/total" string
                const frameParts = hwData.intervalometer_frame.split('/');
                const frameCurrent = parseInt(frameParts[0]) || 0;
                const frameTotal = parseInt(frameParts[1]) || 1;
                const progressPct = frameTotal > 0 ? Math.min(100, (frameCurrent / frameTotal) * 100) : 0;
                elements.txtInterProgress.textContent = hwData.intervalometer_frame + " Frames";
                if (elements.interProgressFill) {
                    elements.interProgressFill.style.width = progressPct.toFixed(1) + '%';
                }
            } else {
                if (elements.interProgressFill) {
                    elements.interProgressFill.style.width = (hwData.intervalometer_status.startsWith('Completed') ? '100%' : '0%');
                }
                if (hwData.intervalometer_status !== "Idle") {
                    elements.txtInterStatus.textContent = hwData.intervalometer_status;
                }
            }

            updateStatusBadges();
            drawSkyMap();
        } catch (err) {
            // Server offline or initializing
        }
    }

    loadComPorts();
    setInterval(pollHardwareStatus, 1200);
    pollHardwareStatus();

    window.addEventListener('resize', drawSkyMap);
});
