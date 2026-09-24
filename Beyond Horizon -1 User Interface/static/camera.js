/**
 * Canon EOS 60D Camera Control & Intervalometer Client JavaScript
 * Communicates with /api/camera REST endpoints
 */

document.addEventListener("DOMContentLoaded", () => {
    // API Endpoints
    const API_BASE = "/api/camera";

    // DOM Element References
    const elements = {
        statusBadgeText: document.getElementById("cam-status-text"),
        batteryBadgeText: document.getElementById("cam-battery-text"),
        storageBadgeText: document.getElementById("cam-storage-text"),

        // Live View Controls
        liveViewStream: document.getElementById("liveview-stream"),
        btnZoom1x: document.getElementById("btn-zoom-1x"),
        btnZoom5x: document.getElementById("btn-zoom-5x"),
        btnZoom10x: document.getElementById("btn-zoom-10x"),
        btnToggleGrid: document.getElementById("btn-toggle-grid"),
        focusPosDisplay: document.getElementById("focus-pos-display"),
        btnFocusFarLarge: document.getElementById("btn-focus-far-large"),
        btnFocusFarFine: document.getElementById("btn-focus-far-fine"),
        btnFocusNearFine: document.getElementById("btn-focus-near-fine"),
        btnFocusNearLarge: document.getElementById("btn-focus-near-large"),
        btnSingleShutter: document.getElementById("btn-single-shutter"),

        // Camera Settings Selectors
        selShutterSpeed: document.getElementById("sel-shutter-speed"),
        selIso: document.getElementById("sel-iso"),
        selAperture: document.getElementById("sel-aperture"),
        selWhiteBalance: document.getElementById("sel-white-balance"),
        selImageFormat: document.getElementById("sel-image-format"),
        selDriveMode: document.getElementById("sel-drive-mode"),
        selFocusMode: document.getElementById("sel-focus-mode"),
        btnApplySettings: document.getElementById("btn-apply-settings"),

        // Intervalometer Elements
        inpDelay: document.getElementById("inp-delay"),
        inpExposure: document.getElementById("inp-exposure"),
        inpInterval: document.getElementById("inp-interval"),
        inpFrameCount: document.getElementById("inp-frame-count"),
        intervalStatusTag: document.getElementById("interval-status-tag"),
        progressBarFill: document.getElementById("interval-progress-bar"),
        statShotsDisplay: document.getElementById("stat-shots-display"),
        statPhaseTimer: document.getElementById("stat-phase-timer"),
        statTotalElapsed: document.getElementById("stat-total-elapsed"),
        btnStartInterval: document.getElementById("btn-start-interval"),
        btnPauseInterval: document.getElementById("btn-pause-interval"),
        btnStopInterval: document.getElementById("btn-stop-interval"),

        // Gallery
        galleryGrid: document.getElementById("gallery-grid"),
        galleryCountBadge: document.getElementById("gallery-count-badge")
    };

    let cameraOptionsLoaded = false;

    // Fetch initial status and populate controls
    async function fetchStatus() {
        try {
            const res = await fetch(`${API_BASE}/status`);
            if (!res.ok) throw new Error("Failed to fetch camera status");
            const data = await res.json();
            updateUIState(data);
        } catch (err) {
            console.error("Camera status error:", err);
            elements.statusBadgeText.textContent = "CAMERA: DISCONNECTED / SERVER ERROR";
        }
    }

    // Populate dropdown options once on init
    function populateDropdowns(options, currentSettings) {
        if (cameraOptionsLoaded) return;

        populateSelect(elements.selShutterSpeed, options.shutter_speeds, currentSettings.shutter_speed);
        populateSelect(elements.selIso, options.iso_values, currentSettings.iso);
        populateSelect(elements.selAperture, options.aperture_values, currentSettings.aperture);
        populateSelect(elements.selWhiteBalance, options.white_balance_modes, currentSettings.white_balance);
        populateSelect(elements.selImageFormat, options.image_formats, currentSettings.image_format);
        populateSelect(elements.selDriveMode, options.drive_modes, currentSettings.drive_mode);
        populateSelect(elements.selFocusMode, options.focus_modes, currentSettings.focus_mode);

        cameraOptionsLoaded = true;
    }

    function populateSelect(selectEl, values, activeVal) {
        if (!selectEl) return;
        selectEl.innerHTML = "";
        values.forEach(val => {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = val;
            if (val === activeVal) opt.selected = true;
            selectEl.appendChild(opt);
        });
    }

    // Update UI elements based on API status telemetry
    function updateUIState(data) {
        // Status Badges
        const isConnected = data.is_connected;
        const isSim = !data.is_physical_hardware;
        elements.statusBadgeText.textContent = isConnected
            ? (isSim ? `CANON 60D [SIMULATOR MODE]` : `CANON 60D USB [PHYSICAL CONNECTED]`)
            : `CANON 60D DISCONNECTED`;
        
        elements.batteryBadgeText.textContent = `🔋 BATTERY: ${data.battery_level}%`;
        elements.storageBadgeText.textContent = `💾 SD FREE: ${(data.storage_free_mb / 1024).toFixed(1)} GB`;

        // Populate options if first load
        if (data.options && data.settings) {
            populateDropdowns(data.options, data.settings);
        }

        // Live View Zoom & Focus state
        elements.focusPosDisplay.textContent = data.focus_position;
        setZoomActivePill(data.zoom_level);

        // Intervalometer state
        const inter = data.intervalometer;
        if (inter) {
            updateIntervalometerUI(inter);
        }

        // Update Gallery
        fetchGallery();
    }

    function setZoomActivePill(zoomLevel) {
        elements.btnZoom1x.classList.toggle("active", zoomLevel === 1);
        elements.btnZoom5x.classList.toggle("active", zoomLevel === 5);
        elements.btnZoom10x.classList.toggle("active", zoomLevel === 10);
    }

    function updateIntervalometerUI(inter) {
        const isRunning = inter.running;
        const isPaused = inter.paused;

        elements.btnStartInterval.disabled = isRunning;
        elements.btnPauseInterval.disabled = !isRunning;
        elements.btnStopInterval.disabled = !isRunning;

        // Status Tag
        const tag = elements.intervalStatusTag;
        tag.textContent = inter.sequence_state || "IDLE";
        tag.className = "status-tag " + (isRunning ? (isPaused ? "paused" : "active") : "idle");

        // Counters & Timers
        const totalShotsStr = inter.target_shots > 0 ? inter.target_shots : "INF";
        elements.statShotsDisplay.textContent = `${inter.completed_shots} / ${totalShotsStr}`;
        elements.statPhaseTimer.textContent = `${inter.phase_remaining_sec.toFixed(1)}s`;
        
        // Progress bar percentage
        let pct = 0;
        if (inter.target_shots > 0) {
            pct = Math.min(100, Math.round((inter.completed_shots / inter.target_shots) * 100));
        } else if (isRunning) {
            pct = 50;  # indicator pulse for infinite
        }
        elements.progressBarFill.style.width = `${pct}%`;

        // Format elapsed seconds into HH:MM:SS
        const elSec = Math.floor(inter.total_elapsed_sec);
        const hrs = String(Math.floor(elSec / 3600)).padStart(2, '0');
        const mins = String(Math.floor((elSec % 3600) / 60)).padStart(2, '0');
        const secs = String(elSec % 60).padStart(2, '0');
        elements.statTotalElapsed.textContent = `${hrs}:${mins}:${secs}`;
    }

    // Settings Submit API
    async function updateSettings() {
        const payload = {
            shutter_speed: elements.selShutterSpeed.value,
            iso: elements.selIso.value,
            aperture: elements.selAperture.value,
            white_balance: elements.selWhiteBalance.value,
            image_format: elements.selImageFormat.value,
            drive_mode: elements.selDriveMode.value,
            focus_mode: elements.selFocusMode.value
        };

        try {
            const res = await fetch(`${API_BASE}/settings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                console.log("Camera settings updated successfully.");
                fetchStatus();
            }
        } catch (err) {
            console.error("Error updating settings:", err);
        }
    }

    // Set Zoom Level API
    async function setZoom(zoomVal) {
        try {
            await fetch(`${API_BASE}/settings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ zoom_level: zoomVal })
            });
            fetchStatus();
        } catch (err) {
            console.error("Error setting zoom:", err);
        }
    }

    // Focus Adjustment API
    async function adjustFocus(dir, stepSize) {
        try {
            const res = await fetch(`${API_BASE}/focus`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ direction: dir, step_size: stepSize })
            });
            if (res.ok) {
                const data = await res.json();
                elements.focusPosDisplay.textContent = data.focus_position;
            }
        } catch (err) {
            console.error("Focus adjustment error:", err);
        }
    }

    // Single Shot Capture API
    async function triggerSingleShot() {
        elements.btnSingleShutter.disabled = true;
        elements.btnSingleShutter.innerHTML = `<span class="btn-icon">⌛</span> EXPOSING...`;

        try {
            const res = await fetch(`${API_BASE}/capture`, { method: "POST" });
            if (res.ok) {
                console.log("Single shot capture success.");
                await fetchGallery();
            }
        } catch (err) {
            console.error("Single shot error:", err);
        } finally {
            elements.btnSingleShutter.disabled = false;
            elements.btnSingleShutter.innerHTML = `<span class="btn-icon">📷</span> RELEASE SHUTTER (TAKE SHOT)`;
        }
    }

    // Intervalometer Control APIs
    async function startIntervalometer() {
        const payload = {
            delay_sec: parseFloat(elements.inpDelay.value) || 0.0,
            exposure_sec: parseFloat(elements.inpExposure.value) || 1.0,
            interval_sec: parseFloat(elements.inpInterval.value) || 1.0,
            target_shots: parseInt(elements.inpFrameCount.value) || 0
        };

        try {
            const res = await fetch(`${API_BASE}/intervalometer/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                console.log("Intervalometer started.");
                fetchStatus();
            }
        } catch (err) {
            console.error("Start intervalometer error:", err);
        }
    }

    async function pauseIntervalometer() {
        try {
            await fetch(`${API_BASE}/intervalometer/pause`, { method: "POST" });
            fetchStatus();
        } catch (err) {
            console.error("Pause intervalometer error:", err);
        }
    }

    async function stopIntervalometer() {
        try {
            await fetch(`${API_BASE}/intervalometer/stop`, { method: "POST" });
            fetchStatus();
        } catch (err) {
            console.error("Stop intervalometer error:", err);
        }
    }

    // Fetch and render captured image gallery
    async function fetchGallery() {
        try {
            const res = await fetch(`${API_BASE}/captures`);
            if (!res.ok) return;
            const data = await res.json();
            renderGallery(data.captures || []);
        } catch (err) {
            console.error("Fetch gallery error:", err);
        }
    }

    function renderGallery(captures) {
        elements.galleryCountBadge.textContent = `${captures.length} EXPOSURES`;
        if (captures.length === 0) {
            elements.galleryGrid.innerHTML = `<div class="gallery-empty-state">No exposures captured yet. Take a single shot or start the intervalometer!</div>`;
            return;
        }

        elements.galleryGrid.innerHTML = captures.map(item => `
            <div class="gallery-card">
                <div class="gallery-img-wrapper">
                    <img src="${item.url}" alt="${item.filename}" loading="lazy">
                </div>
                <div class="gallery-info">
                    <div class="gallery-title" title="${item.filename}">${item.filename}</div>
                    <div class="gallery-meta">${item.shutter}s | ISO ${item.iso} | ${item.aperture}</div>
                    <div class="gallery-time">${item.timestamp} (${item.size_mb} MB)</div>
                    <a href="${item.url}" download="${item.filename}" class="btn-tactical btn-small full-width" style="margin-top: 6px; text-decoration: none; text-align: center; display: block;">
                        📥 DOWNLOAD FILE
                    </a>
                </div>
            </div>
        `).join("");
    }

    // Event Listeners
    elements.btnZoom1x.addEventListener("click", () => setZoom(1));
    elements.btnZoom5x.addEventListener("click", () => setZoom(5));
    elements.btnZoom10x.addEventListener("click", () => setZoom(10));

    elements.btnFocusFarLarge.addEventListener("click", () => adjustFocus("far", 50));
    elements.btnFocusFarFine.addEventListener("click", () => adjustFocus("far", 10));
    elements.btnFocusNearFine.addEventListener("click", () => adjustFocus("near", 10));
    elements.btnFocusNearLarge.addEventListener("click", () => adjustFocus("near", 50));

    elements.btnApplySettings.addEventListener("click", updateSettings);
    elements.btnSingleShutter.addEventListener("click", triggerSingleShot);

    elements.btnStartInterval.addEventListener("click", startIntervalometer);
    elements.btnPauseInterval.addEventListener("click", pauseIntervalometer);
    elements.btnStopInterval.addEventListener("click", stopIntervalometer);

    // Initial Status fetch & 1-second telemetry polling loop
    fetchStatus();
    setInterval(fetchStatus, 1000);
});
