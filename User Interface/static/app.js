/* ==========================================================================
   BEYOND HORIZON -1 TACTICAL DASHBOARD FRONTEND APPLICATION LOGIC
   Handles Stellarium sync, LAN HTTP Target Requests, Pannable/Zoomable 2D
   Sky Map Engine, Degree Telemetry, and Real-Time Sidereal Active Tracking.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // No hardcoded fallback data — all sky data comes from Stellarium.
    // Stellarium connection error state for UI display
    let stellariumErrorMessage = null;

    // Current App State Cache
    const appState = {
        stellariumConnected: false,
        lanTargetUrl: "http://10.172.197.224/target",
        selectedTarget: null,
        telemetry: {
            currentAlt: 0.0,
            currentAz: 0.0,
            targetAlt: 0.0,
            targetAz: 0.0,
            deltaAlt: 0.0,
            deltaAz: 0.0,
            isCalibrated: false,
            trackingEnabled: false
        },
        skymapData: [],  // Populated exclusively from Stellarium — no fallback data
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
        badgeLan: document.getElementById('badge-lan'),
        systemClock: document.getElementById('system-clock'),

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
        btnDpadStop: document.getElementById('btn-dpad-stop')
    };

    // System Clock
    function updateClock() {
        const now = new Date();
        if (elements.systemClock) elements.systemClock.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
        if (elements.txtBrowserTime) elements.txtBrowserTime.textContent = now.toLocaleString();
    }
    setInterval(updateClock, 1000);
    updateClock();

    // --------------------------------------------------------------------------
    // 1. LOCATION & TIME SYNCHRONIZATION
    // --------------------------------------------------------------------------
    if (elements.btnSyncLocation) {
        elements.btnSyncLocation.addEventListener('click', () => {
            if (elements.locationSyncFeedback) elements.locationSyncFeedback.textContent = "Requesting Browser Geolocation...";

            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(
                    async (position) => {
                        const lat = position.coords.latitude;
                        const lon = position.coords.longitude;
                        const alt = position.coords.altitude || 15.0;

                        if (elements.inputLat) elements.inputLat.value = lat.toFixed(6);
                        if (elements.inputLon) elements.inputLon.value = lon.toFixed(6);
                        if (elements.inputElevation) elements.inputElevation.value = Math.round(alt);

                        await sendLocationToBackend(lat, lon, alt);
                    },
                    async (error) => {
                        console.warn('Geolocation denied or unavailable. Using form fields.', error);
                        const lat = parseFloat(elements.inputLat ? elements.inputLat.value : 23.810300) || 23.810300;
                        const lon = parseFloat(elements.inputLon ? elements.inputLon.value : 90.412500) || 90.412500;
                        const alt = parseFloat(elements.inputElevation ? elements.inputElevation.value : 15.0) || 15.0;
                        await sendLocationToBackend(lat, lon, alt);
                    },
                    { timeout: 8000, enableHighAccuracy: true }
                );
            } else {
                const lat = parseFloat(elements.inputLat ? elements.inputLat.value : 23.810300);
                const lon = parseFloat(elements.inputLon ? elements.inputLon.value : 90.412500);
                const alt = parseFloat(elements.inputElevation ? elements.inputElevation.value : 15.0);
                sendLocationToBackend(lat, lon, alt);
            }
        });
    }

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
            if (elements.locationSyncFeedback) {
                if (data.stellarium_pushed) {
                    elements.locationSyncFeedback.textContent = `[SUCCESS] Coordinates (Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}) pushed to Stellarium environment!`;
                } else {
                    elements.locationSyncFeedback.textContent = `[LOCAL SYNC] Coordinates registered locally. (Stellarium HTTP API link offline)`;
                }
            }
        } catch (err) {
            if (elements.locationSyncFeedback) elements.locationSyncFeedback.textContent = `[ERROR] Failed to send location: ${err.message}`;
        }
    }

    // --------------------------------------------------------------------------
    // 2. UNIFIED TARGET SEARCH, AUTOCOMPLETE & GOTO ENGINE
    // --------------------------------------------------------------------------
    function formatDegrees(val) {
        if (val === undefined || val === null || isNaN(val)) return "000.000°";
        const num = Number(val);
        const sign = num < 0 ? '-' : '';
        const abs = Math.abs(num);
        return `${sign}${abs.toFixed(3)}°`;
    }

    function updateTargetDisplays(targetData, updateSearchInputBox = false) {
        if (!targetData) {
            appState.selectedTarget = null;
            if (elements.mapTargetName) elements.mapTargetName.textContent = "SELECT A TARGET";
            if (elements.mapTargetType) elements.mapTargetType.textContent = "STANDBY";
            if (elements.mapTargetAlt) elements.mapTargetAlt.textContent = "---.---°";
            if (elements.mapTargetAz) elements.mapTargetAz.textContent = "---.---°";
            if (elements.calibActiveTargetDisplay) {
                elements.calibActiveTargetDisplay.textContent = "SELECT AN OBJECT FROM SEARCH OR MAP TO CALIBRATE";
            }
            drawSkyMap();
            return;
        }

        const alt = targetData.altitude !== undefined ? targetData.altitude : (targetData.alt || 0);
        const az  = targetData.azimuth  !== undefined ? targetData.azimuth  : (targetData.az  || 0);
        targetData.altitude = alt;
        targetData.azimuth  = az;

        appState.selectedTarget = targetData;

        if (updateSearchInputBox && elements.targetSearchInput && !appState.isTypingInSearch) {
            elements.targetSearchInput.value = targetData.name;
        }

        if (elements.mapTargetName) elements.mapTargetName.textContent = targetData.name.toUpperCase();
        if (elements.mapTargetType) elements.mapTargetType.textContent = (targetData.type || "CELESTIAL").toUpperCase();
        if (elements.mapTargetAlt) elements.mapTargetAlt.textContent = formatDegrees(alt);
        if (elements.mapTargetAz) elements.mapTargetAz.textContent = formatDegrees(az);

        if (elements.calibActiveTargetDisplay) {
            elements.calibActiveTargetDisplay.textContent = `${targetData.name.toUpperCase()} (Alt ${formatDegrees(alt)}, Az ${formatDegrees(az)})`;
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
                    <span class="item-coords">Alt ${item.altitude.toFixed(4)}° Az ${item.azimuth.toFixed(4)}°</span>
                </div>
            `;
            div.addEventListener('click', () => {
                updateTargetDisplays(item, true);
                elements.autocompleteDropdown.classList.add('hidden');
                if (elements.gotoFeedback) elements.gotoFeedback.textContent = `Target set to "${item.name}". Click 'POINT TO TARGET' to execute GoTo.`;
            });
            elements.autocompleteDropdown.appendChild(div);
        });

        elements.autocompleteDropdown.classList.remove('hidden');
    }

    if (elements.targetSearchInput) {
        elements.targetSearchInput.addEventListener('focus', () => {
            appState.isTypingInSearch = true;
        });

        elements.targetSearchInput.addEventListener('blur', () => {
            setTimeout(() => { appState.isTypingInSearch = false; }, 300);
        });

        elements.targetSearchInput.addEventListener('input', () => {
            appState.isTypingInSearch = true;
            const query = elements.targetSearchInput.value.trim().toLowerCase();
            if (!query) {
                if (elements.autocompleteDropdown) elements.autocompleteDropdown.classList.add('hidden');
                return;
            }

            if (appState.skymapData && appState.skymapData.length > 0) {
                const matches = appState.skymapData.filter(obj => obj.name.toLowerCase().includes(query));
                renderAutocompleteDropdown(matches);
            } else {
                renderAutocompleteDropdown([]);
            }
        });

        elements.targetSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elements.autocompleteDropdown) {
                elements.autocompleteDropdown.classList.add('hidden');
            }
        });

        elements.targetSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchTarget();
        });
    }

    document.addEventListener('click', (e) => {
        if (elements.autocompleteDropdown && !e.target.closest('.search-input-wrapper')) {
            elements.autocompleteDropdown.classList.add('hidden');
        }
    });

    async function searchTarget() {
        if (!elements.targetSearchInput) return;
        const query = elements.targetSearchInput.value.trim();
        if (!query) return;

        if (elements.autocompleteDropdown) elements.autocompleteDropdown.classList.add('hidden');

        // Direct Coordinate Match (e.g. "41.2760, 107.4875" or "41.2760 107.4875")
        const coordMatch = query.match(/^(?:alt[:\s]*)?(-?\d+(?:\.\d+)?)[,\s]+(?:az[:\s]*)?(-?\d+(?:\.\d+)?)$/i);
        if (coordMatch) {
            const pAlt = parseFloat(coordMatch[1]);
            const pAz  = parseFloat(coordMatch[2]);
            const coordTarget = {
                name: `Coord (${pAlt.toFixed(4)}°, ${pAz.toFixed(4)}°)`,
                type: "Direct Coordinates",
                altitude: pAlt,
                azimuth: pAz
            };
            updateTargetDisplays(coordTarget, true);
            if (elements.gotoFeedback) elements.gotoFeedback.textContent = `[DIRECT COORDS] Target ready. Click 'POINT TO TARGET' to execute GoTo slew.`;
            return;
        }

        if (elements.gotoFeedback) elements.gotoFeedback.textContent = `Searching Stellarium for "${query}"...`;

        try {
            const res = await fetch('/api/stellarium/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query })
            });
            const data = await res.json();
            if (data.found) {
                updateTargetDisplays(data, true);
                if (elements.gotoFeedback) elements.gotoFeedback.textContent = `[STELLARIUM LIVE] Target ready. Click 'POINT TO TARGET' to execute GoTo slew.`;
                return;
            } else {
                // Stellarium returned not-found or error
                const errorMsg = data.error || `No object matching "${query}" found in Stellarium.`;
                if (elements.gotoFeedback) elements.gotoFeedback.textContent = `[STELLARIUM ERROR] ${errorMsg}`;
                return;
            }
        } catch (err) {
            console.error('Backend search API unreachable.', err);
            if (elements.gotoFeedback) elements.gotoFeedback.textContent = `[CONNECTION ERROR] Cannot reach backend server: ${err.message}`;
        }
    }

    if (elements.btnSearchTarget) {
        elements.btnSearchTarget.addEventListener('click', searchTarget);
    }

    async function executeGoTo() {
        if (!appState.selectedTarget) return;

        if (elements.gotoFeedback) elements.gotoFeedback.textContent = `Computing delta coordinates and sending LAN HTTP request for ${appState.selectedTarget.name}...`;
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
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`HTTP ${res.status}: ${errText.substring(0, 120)}`);
            }
            const data = await res.json();
            const dAltStr = (data.delta_alt_deg >= 0 ? '+' : '') + (data.delta_alt_deg || 0).toFixed(3);
            const dAzStr  = (data.delta_az_deg  >= 0 ? '+' : '') + (data.delta_az_deg  || 0).toFixed(3);
            const statusStr = data.response ? (data.response.status || 'sent') : 'sent';
            if (elements.gotoFeedback) elements.gotoFeedback.textContent = `[GOTO DISPATCHED] LAN GET: http://10.172.197.224/target?alt=${dAltStr}&az=${dAzStr} (${statusStr.toUpperCase()})`;
            pollHardwareStatus();
        } catch (err) {
            if (elements.gotoFeedback) elements.gotoFeedback.textContent = `GoTo command error: ${err.message}`;
        }
    }

    if (elements.btnMapGoto) {
        elements.btnMapGoto.addEventListener('click', executeGoTo);
    }

    // --------------------------------------------------------------------------
    // 3. PANNABLE & ZOOMABLE 2D SKY MAP CANVAS ENGINE
    // --------------------------------------------------------------------------
    const canvas = elements.skymapCanvas;
    const ctx = canvas ? canvas.getContext('2d') : null;

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

        return { alt: roundVal(alt, 4), az: roundVal(az, 4) };
    }

    function roundVal(v, p) {
        const factor = Math.pow(10, p);
        return Math.round(v * factor) / factor;
    }

    function drawSkyMap() {
        if (!canvas || !ctx) return;

        const rect = canvas.getBoundingClientRect();
        const targetW = Math.floor(rect.width || 700);
        const targetH = Math.floor(rect.height || 500);
        if (canvas.width !== targetW) canvas.width = targetW;
        if (canvas.height !== targetH) canvas.height = targetH;
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        const centerX = (w / 2) + appState.panX;
        const centerY = (h / 2) + appState.panY;
        const maxRadius = (Math.min(w / 2, h / 2) - 36) * appState.zoomScale;

        // 1. Deep Space Radial Gradient Background
        const bgGrad = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, Math.max(w, h));
        bgGrad.addColorStop(0, '#06060c');
        bgGrad.addColorStop(0.6, '#020205');
        bgGrad.addColorStop(1, '#000000');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // 2. Translucent Night-Sky Disc & Dual Bezel
        ctx.beginPath();
        ctx.arc(centerX, centerY, maxRadius, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(8, 8, 16, 0.85)';
        ctx.fill();

        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centerX, centerY, maxRadius + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(127, 29, 29, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 3. Grid Overlay & Compass Bearings
        if (appState.showGrid) {
            ctx.strokeStyle = 'rgba(220, 38, 38, 0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);

            [30, 60].forEach(altRing => {
                const r = maxRadius * (1 - altRing / 90.0);
                ctx.beginPath();
                ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
                ctx.stroke();

                ctx.fillStyle = 'rgba(13, 13, 13, 0.7)';
                ctx.fillRect(centerX - 16, centerY - r - 8, 32, 14);
                ctx.fillStyle = '#b91c1c';
                ctx.font = '9px Share Tech Mono';
                ctx.textAlign = 'center';
                ctx.fillText(`${altRing}° ALT`, centerX, centerY - r + 3);
            });
            ctx.setLineDash([]);

            // Radial Azimuth Spokes (Every 30 degrees)
            for (let deg = 0; deg < 360; deg += 30) {
                const rad = (deg - 90) * (Math.PI / 180);
                const isMain = deg % 90 === 0;

                ctx.strokeStyle = isMain ? 'rgba(220, 38, 38, 0.35)' : 'rgba(127, 29, 29, 0.18)';
                ctx.lineWidth = isMain ? 1.2 : 0.8;

                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.lineTo(centerX + maxRadius * Math.cos(rad), centerY + maxRadius * Math.sin(rad));
                ctx.stroke();

                const t1 = maxRadius;
                const t2 = maxRadius + (isMain ? 8 : 4);
                ctx.beginPath();
                ctx.moveTo(centerX + t1 * Math.cos(rad), centerY + t1 * Math.sin(rad));
                ctx.lineTo(centerX + t2 * Math.cos(rad), centerY + t2 * Math.sin(rad));
                ctx.stroke();
            }

            // Tactical Cardinal Badges
            const cardinals = [
                { angle: 0, label: 'N', x: centerX, y: centerY - maxRadius - 14 },
                { angle: 90, label: 'E', x: centerX + maxRadius + 16, y: centerY + 4 },
                { angle: 180, label: 'S', x: centerX, y: centerY + maxRadius + 22 },
                { angle: 270, label: 'W', x: centerX - maxRadius - 20, y: centerY + 4 }
            ];

            cardinals.forEach(c => {
                ctx.fillStyle = '#ff1a1a';
                ctx.font = 'bold 12px Orbitron';
                ctx.textAlign = 'center';
                ctx.shadowColor = '#ff1a1a';
                ctx.shadowBlur = 6;
                ctx.fillText(c.label, c.x, c.y);
                ctx.shadowBlur = 0;
            });
        }

        // 4. Smart Anti-Collision Celestial Object Rendering
        const renderList = (appState.skymapData || [])
            .filter(obj => obj.altitude >= 0)
            .sort((a, b) => (a.magnitude || 2.0) - (b.magnitude || 2.0));

        const placedLabels = [];

        renderList.forEach(obj => {
            const pos = altAzToCanvasCoords(obj.altitude, obj.azimuth, w, h);

            if (obj.type === 'Planet' || obj.type === 'Satellite') {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 6 * appState.zoomScale, 0, 2 * Math.PI);
                ctx.fillStyle = 'rgba(255, 77, 77, 0.35)';
                ctx.fill();

                ctx.beginPath();
                ctx.arc(pos.x, pos.y, 3.5 * appState.zoomScale, 0, 2 * Math.PI);
                ctx.fillStyle = '#ff1a1a';
                ctx.shadowColor = '#ff4d4d';
                ctx.shadowBlur = 8;
                ctx.fill();
                ctx.shadowBlur = 0;
            } else if (obj.type === 'Galaxy' || obj.type === 'Nebula' || obj.type === 'Cluster') {
                ctx.beginPath();
                ctx.setLineDash([2, 2]);
                ctx.ellipse(pos.x, pos.y, 10 * appState.zoomScale, 6 * appState.zoomScale, Math.PI / 4, 0, 2 * Math.PI);
                ctx.strokeStyle = '#ef4444';
                ctx.stroke();
                ctx.setLineDash([]);
            } else {
                const size = Math.max(1.8, (4.0 - (obj.magnitude || 2.0) * 0.5) * appState.zoomScale);
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, size, 0, 2 * Math.PI);
                ctx.fillStyle = '#ff6666';
                ctx.shadowColor = '#ff1a1a';
                ctx.shadowBlur = obj.magnitude < 1.0 ? 8 : 4;
                ctx.fill();
                ctx.shadowBlur = 0;
            }

            // Anti-Collision Text Label Positioning
            ctx.font = '10px Share Tech Mono';
            const labelText = obj.name;
            const textMetrics = ctx.measureText(labelText);
            const textWidth = textMetrics.width;
            const textHeight = 12;

            const candidateOffsets = [
                { dx: 10, dy: -6 },
                { dx: 10, dy: 14 },
                { dx: -textWidth - 10, dy: -6 },
                { dx: -textWidth - 10, dy: 14 },
                { dx: -textWidth / 2, dy: -14 },
                { dx: -textWidth / 2, dy: 18 }
            ];

            let chosenOffset = candidateOffsets[0];
            let foundValid = false;

            for (const offset of candidateOffsets) {
                const lx = pos.x + offset.dx;
                const ly = pos.y + offset.dy - 9;
                const bbox = { left: lx - 3, top: ly - 2, right: lx + textWidth + 3, bottom: ly + textHeight + 2 };

                let collides = false;
                for (const existing of placedLabels) {
                    if (bbox.left < existing.right && bbox.right > existing.left &&
                        bbox.top < existing.bottom && bbox.bottom > existing.top) {
                        collides = true;
                        break;
                    }
                }

                if (!collides) {
                    chosenOffset = offset;
                    placedLabels.push(bbox);
                    foundValid = true;
                    break;
                }
            }

            if (!foundValid) {
                const lx = pos.x + chosenOffset.dx;
                const ly = pos.y + chosenOffset.dy - 9;
                placedLabels.push({ left: lx - 3, top: ly - 2, right: lx + textWidth + 3, bottom: ly + textHeight + 2 });
            }

            const labelX = pos.x + chosenOffset.dx;
            const labelY = pos.y + chosenOffset.dy;

            const dist = Math.sqrt(chosenOffset.dx * chosenOffset.dx + chosenOffset.dy * chosenOffset.dy);
            if (dist > 14) {
                ctx.beginPath();
                ctx.setLineDash([1, 2]);
                ctx.strokeStyle = 'rgba(255, 60, 60, 0.4)';
                ctx.lineWidth = 0.8;
                ctx.moveTo(pos.x, pos.y);
                ctx.lineTo(labelX > pos.x ? labelX : labelX + textWidth, labelY - 4);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            ctx.fillStyle = 'rgba(10, 10, 10, 0.65)';
            ctx.fillRect(labelX - 2, labelY - 9, textWidth + 4, textHeight + 2);

            ctx.fillStyle = (obj.type === 'Planet' || obj.type === 'Satellite') ? '#ff3333' : '#ff7777';
            ctx.textAlign = 'left';
            ctx.fillText(labelText, labelX, labelY);
        });

        // 5. Selected Target Ring
        if (appState.selectedTarget && appState.selectedTarget.name && appState.selectedTarget.altitude >= 0) {
            const tgtPos = altAzToCanvasCoords(appState.selectedTarget.altitude, appState.selectedTarget.azimuth, w, h);
            ctx.beginPath();
            ctx.setLineDash([4, 3]);
            ctx.arc(tgtPos.x, tgtPos.y, 16 * appState.zoomScale, 0, 2 * Math.PI);
            ctx.strokeStyle = '#ff1a1a';
            ctx.lineWidth = 1.8;
            ctx.stroke();
            ctx.setLineDash([]);

            const r = 16 * appState.zoomScale;
            ctx.beginPath();
            ctx.moveTo(tgtPos.x - r - 4, tgtPos.y); ctx.lineTo(tgtPos.x - r + 4, tgtPos.y);
            ctx.moveTo(tgtPos.x + r - 4, tgtPos.y); ctx.lineTo(tgtPos.x + r + 4, tgtPos.y);
            ctx.moveTo(tgtPos.x, tgtPos.y - r - 4); ctx.lineTo(tgtPos.x, tgtPos.y - r + 4);
            ctx.moveTo(tgtPos.x, tgtPos.y + r - 4); ctx.lineTo(tgtPos.x, tgtPos.y + r + 4);
            ctx.stroke();
        }

        // 6. Telescope Aim Reticle
        const telPos = altAzToCanvasCoords(appState.telemetry.currentAlt, appState.telemetry.currentAz, w, h);
        ctx.strokeStyle = '#ff3333';
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.arc(telPos.x, telPos.y, 10 * appState.zoomScale, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(telPos.x - 18 * appState.zoomScale, telPos.y); ctx.lineTo(telPos.x - 6 * appState.zoomScale, telPos.y);
        ctx.moveTo(telPos.x + 6 * appState.zoomScale, telPos.y);  ctx.lineTo(telPos.x + 18 * appState.zoomScale, telPos.y);
        ctx.moveTo(telPos.x, telPos.y - 18 * appState.zoomScale); ctx.lineTo(telPos.x, telPos.y - 6 * appState.zoomScale);
        ctx.moveTo(telPos.x, telPos.y + 6 * appState.zoomScale);  ctx.lineTo(telPos.x, telPos.y + 18 * appState.zoomScale);
        ctx.stroke();
    }

    if (canvas) {
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

            const searchPool = appState.skymapData || [];
            searchPool.forEach(obj => {
                const pos = altAzToCanvasCoords(obj.altitude, obj.azimuth, canvas.width, canvas.height);
                const dist = Math.sqrt(Math.pow(mouseX - pos.x, 2) + Math.pow(mouseY - pos.y, 2));
                if (dist < minDist) {
                    minDist = dist;
                    clickedObj = obj;
                }
            });

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
    }

    if (elements.btnMapToggleGrid) {
        elements.btnMapToggleGrid.addEventListener('click', () => {
            appState.showGrid = !appState.showGrid;
            elements.btnMapToggleGrid.classList.toggle('active');
            elements.btnMapToggleGrid.textContent = `GRID: ${appState.showGrid ? 'ON' : 'OFF'}`;
            drawSkyMap();
        });
    }

    if (elements.btnMapResetView) {
        elements.btnMapResetView.addEventListener('click', () => {
            appState.panX = 0;
            appState.panY = 0;
            appState.zoomScale = 1.0;
            drawSkyMap();
        });
    }

    // --------------------------------------------------------------------------
    // 4. REAL-TIME SIDEREAL TRACKING TOGGLE
    // --------------------------------------------------------------------------
    if (elements.btnToggleTracking) {
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

                if (elements.trackStatusPill && elements.btnToggleTracking) {
                    if (data.tracking_enabled) {
                        elements.trackStatusPill.textContent = "ACTIVE (1Hz)";
                        elements.trackStatusPill.classList.add('active');
                        elements.btnToggleTracking.textContent = "DISABLE SIDEREAL TRACKING";
                    } else {
                        elements.trackStatusPill.textContent = "OFF";
                        elements.trackStatusPill.classList.remove('active');
                        elements.btnToggleTracking.textContent = "ENABLE SIDEREAL TRACKING (1Hz)";
                    }
                }
            } catch (err) {
                console.error('Failed to toggle tracking:', err);
            }
        });
    }

    // --------------------------------------------------------------------------
    // 5. MULTI-MODE ALIGNMENT & CALIBRATION SUITE
    // --------------------------------------------------------------------------
    const tabBtns = document.querySelectorAll('.calib-tab-btn');
    const tabContents = document.querySelectorAll('.calib-tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetTabId = btn.getAttribute('data-tab');
            const targetContent = document.getElementById(targetTabId);
            if (targetContent) targetContent.classList.add('active');
        });
    });

    if (elements.btnCalibStarSubmit) {
        elements.btnCalibStarSubmit.addEventListener('click', async () => {
            if (!appState.selectedTarget) return;
            const starName = appState.selectedTarget.name;
            const alt = appState.selectedTarget.altitude;
            const az = appState.selectedTarget.azimuth;

            if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `Aligning mount to active target object "${starName}"...`;
            try {
                const res = await fetch('/api/mount/calibrate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'OBJECT', object_name: starName, alt: alt, az: az })
                });
                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`HTTP ${res.status}: ${errText.substring(0, 120)}`);
                }
                const data = await res.json();
                if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `[SUCCESS] ${data.description}`;
                pollHardwareStatus();
            } catch (err) {
                if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `Calibration error: ${err.message}`;
            }
        });
    }

    if (elements.btnMapCalibrate) {
        elements.btnMapCalibrate.addEventListener('click', async () => {
            if (!appState.selectedTarget) return;
            const starName = appState.selectedTarget.name;
            const alt = appState.selectedTarget.altitude;
            const az = appState.selectedTarget.azimuth;

            if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `Aligning mount to map object "${starName}"...`;
            try {
                const res = await fetch('/api/mount/calibrate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'OBJECT', object_name: starName, alt: alt, az: az })
                });
                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`HTTP ${res.status}: ${errText.substring(0, 120)}`);
                }
                const data = await res.json();
                if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `[SUCCESS] ${data.description}`;
                pollHardwareStatus();
            } catch (err) {
                if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `Calibration error: ${err.message}`;
            }
        });
    }

    if (elements.btnCalibCardinalSubmit) {
        elements.btnCalibCardinalSubmit.addEventListener('click', async () => {
            const heading = elements.calibCardinalDir ? elements.calibCardinalDir.value : 'NORTH';
            const elevation = elements.calibElevationPreset ? elements.calibElevationPreset.value : 'HORIZON';

            if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `Applying cardinal alignment (${heading}, ${elevation})...`;
            try {
                const res = await fetch('/api/mount/calibrate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'CARDINAL', cardinal_dir: heading, elevation_preset: elevation })
                });
                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`HTTP ${res.status}: ${errText.substring(0, 120)}`);
                }
                const data = await res.json();
                if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `[SUCCESS] ${data.description}`;
                pollHardwareStatus();
            } catch (err) {
                if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `Calibration error: ${err.message}`;
            }
        });
    }

    if (elements.btnCalibManualSubmit) {
        elements.btnCalibManualSubmit.addEventListener('click', async () => {
            const alt = parseFloat(elements.calibManualAlt ? elements.calibManualAlt.value : 0.0) || 0.0;
            const az = parseFloat(elements.calibManualAz ? elements.calibManualAz.value : 0.0) || 0.0;

            if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `Setting mount pointing angles to Alt ${alt}°, Az ${az}°...`;
            try {
                const res = await fetch('/api/mount/calibrate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'MANUAL', alt: alt, az: az })
                });
                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`HTTP ${res.status}: ${errText.substring(0, 120)}`);
                }
                const data = await res.json();
                if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `[SUCCESS] ${data.description}`;
                pollHardwareStatus();
            } catch (err) {
                if (elements.calibrationFeedback) elements.calibrationFeedback.textContent = `Calibration error: ${err.message}`;
            }
        });
    }

    // --------------------------------------------------------------------------
    // 6. MANUAL DIRECTIONAL SLEW CONTROLS (D-PAD)
    // --------------------------------------------------------------------------
    async function sendSlewCommand(direction) {
        const speed = parseFloat(elements.slewSpeedSelect ? elements.slewSpeedSelect.value : 1.0) || 1.0;
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

    if (elements.btnDpadUp) elements.btnDpadUp.addEventListener('click', () => sendSlewCommand('+ALT'));
    if (elements.btnDpadDown) elements.btnDpadDown.addEventListener('click', () => sendSlewCommand('-ALT'));
    if (elements.btnDpadLeft) elements.btnDpadLeft.addEventListener('click', () => sendSlewCommand('-AZ'));
    if (elements.btnDpadRight) elements.btnDpadRight.addEventListener('click', () => sendSlewCommand('+AZ'));
    if (elements.btnDpadStop) elements.btnDpadStop.addEventListener('click', () => sendSlewCommand('STOP'));

    // --------------------------------------------------------------------------
    // 7. REAL-TIME TELEMETRY & STATUS POLLING LOOP
    // --------------------------------------------------------------------------
    async function pollHardwareStatus() {
        // 1. Stellarium Status
        try {
            const stelRes = await fetch('/api/stellarium/status');
            const stelData = await stelRes.json();
            appState.stellariumConnected = stelData.connected;
        } catch (err) {
            appState.stellariumConnected = false;
        }

        // 2. Skymap Objects (Live Stellarium or Local LST Engine)
        try {
            const skyRes = await fetch('/api/skymap/objects');
            const skyData = await skyRes.json();

            if (skyData.objects && skyData.objects.length > 0) {
                appState.skymapData = skyData.objects;

                if (appState.selectedTarget && appState.selectedTarget.name) {
                    const liveObj = skyData.objects.find(o => o.name.toLowerCase() === appState.selectedTarget.name.toLowerCase());
                    if (liveObj) {
                        appState.selectedTarget.altitude = liveObj.altitude;
                        appState.selectedTarget.azimuth = liveObj.azimuth;
                        if (elements.mapTargetAlt) elements.mapTargetAlt.textContent = `${liveObj.altitude.toFixed(4)}°`;
                        if (elements.mapTargetAz) elements.mapTargetAz.textContent = `${liveObj.azimuth.toFixed(4)}°`;
                        if (elements.calibActiveTargetDisplay) {
                            elements.calibActiveTargetDisplay.textContent = `${appState.selectedTarget.name.toUpperCase()} (Alt ${liveObj.altitude.toFixed(4)}°, Az ${liveObj.azimuth.toFixed(4)}°)`;
                        }
                    }
                }
            } else {
                appState.skymapData = [];
            }
        } catch (err) {
            // Connection to backend temporarily interrupted
        }

        // 3. Hardware Status
        try {
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

            if (hwData.lan_target_url) appState.lanTargetUrl = hwData.lan_target_url;

            if (elements.valCurrentAlt) elements.valCurrentAlt.textContent = formatDegrees(hwData.current_alt_deg);
            if (elements.valCurrentAz) elements.valCurrentAz.textContent = formatDegrees(hwData.current_az_deg);

            if (elements.calibrationStatusTag) {
                if (hwData.is_calibrated) {
                    const calTargetName = hwData.calibrated_target_name || hwData.calibration_mode;
                    elements.calibrationStatusTag.textContent = `CALIBRATED: ${calTargetName.toUpperCase()}`;
                    elements.calibrationStatusTag.style.borderColor = "var(--border-crimson)";
                    elements.calibrationStatusTag.style.color = "var(--text-bright-red)";
                } else {
                    elements.calibrationStatusTag.textContent = "NOT CALIBRATED";
                }
            }

            if (elements.trackStatusPill && elements.btnToggleTracking) {
                if (hwData.tracking_enabled) {
                    elements.trackStatusPill.textContent = "ACTIVE (1Hz)";
                    elements.trackStatusPill.classList.add('active');
                    elements.btnToggleTracking.textContent = "DISABLE SIDEREAL TRACKING";
                } else {
                    elements.trackStatusPill.textContent = "OFF";
                    elements.trackStatusPill.classList.remove('active');
                    elements.btnToggleTracking.textContent = "ENABLE SIDEREAL TRACKING (1Hz)";
                }
            }
        } catch (err) {
            // Server offline or initializing
        }

        // Always draw sky map at end of tick
        drawSkyMap();
    }

    // Initial immediate sky map draw
    drawSkyMap();

    // Start background telemetry polling
    setInterval(pollHardwareStatus, 1200);
    pollHardwareStatus();

    window.addEventListener('resize', drawSkyMap);
});
