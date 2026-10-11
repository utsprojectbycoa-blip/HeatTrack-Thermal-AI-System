// HeatTrack live cameras: shows the mini PC's RGB video in the RGB Monitor and
// its thermal view (with duck boxes + body temperatures) in the Thermal Monitor.
// Live numbers come from the logger's /stats; sensor + analytics data are
// handled by script.js. Load AFTER script.js.

(() => {
    // The public (trycloudflare) address is saved by heatstress_logger.py in
    // devices.device_url for the signed-in user's device. This is the fallback
    // when HeatTrack is opened on the same computer that runs the logger.
    const LOCAL_STREAM_URL = 'http://localhost:8000/video';
    const CHECK_EVERY_MS = 5000;        // start/stop the streams as the page changes
    const ADDRESS_EVERY_MS = 30000;     // re-read device_url (it changes when the logger restarts)
    const STATS_EVERY_MS = 1000;        // how often the HUD numbers refresh
    // Same 25-45 °C range as the colour scale drawn on the Thermal Monitor
    const THERMAL_QUERY = 'min=25&max=45&hud=0';
    // Mirror the pictures on the website (display only; the mini PC's data is not
    // changed). true = flip left <-> right. Use either this OR the logger's
    // HEATTRACK_WEBCAM_FLIP / HEATTRACK_THERMAL_FLIP, not both (they would cancel out).
    const FLIP_RGB_HORIZONTAL = true;
    const FLIP_THERMAL_HORIZONTAL = true;

    // Reuse the client created in script.js (one client per page)
    const client = typeof sb !== 'undefined' ? sb : null;

    let streamUrl = null;   // from devices.device_url (null = no tunnel yet)
    let playingUrl = null;  // the /video address currently playing
    let rgbImg = null;
    let thermalImg = null;

    const refreshPresence = () => {
        if (typeof updateMonitorPresenceUI === 'function') updateMonitorPresenceUI();
    };

    // "https://x.trycloudflare.com/video" -> "https://x.trycloudflare.com"
    const baseOf = (videoUrl) => videoUrl.replace(/\/video\/?(\?.*)?$/, '');
    const withNoCache = (url) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

    function makeFeedImg(containerId, id, alt, fit, flipHorizontal) {
        const layer = document.querySelector(`#${containerId} .camera-zoom-layer`);
        if (!layer) return null;
        const img = document.createElement('img');
        img.id = id;
        img.alt = alt;
        img.draggable = false;
        img.style.cssText = `width:100%;height:100%;object-fit:${fit};display:block;background:#000;`
            + (flipHorizontal ? 'transform:scaleX(-1);' : '');
        img.addEventListener('error', () => {
            // Logger not running / tunnel not ready yet: retry on the next check
            img.removeAttribute('src');
            if (img === rgbImg) playingUrl = null;
            refreshPresence();
        });
        layer.prepend(img);
        return img;
    }

    function ensureRgbImg() {
        if (!rgbImg || !rgbImg.isConnected) {
            rgbImg = makeFeedImg('normalCameraContainer', 'normalFeed', 'RGB camera live feed', 'cover',
                FLIP_RGB_HORIZONTAL);
        }
        return rgbImg;
    }

    function ensureThermalImg() {
        if (!thermalImg || !thermalImg.isConnected) {
            // "contain" so no duck box or temperature label is cropped off
            thermalImg = makeFeedImg('thermalCameraContainer', 'thermalFeed',
                'Thermal camera live view with duck body temperatures', 'contain', FLIP_THERMAL_HORIZONTAL);
        }
        return thermalImg;
    }

    function stopImg(img) {
        if (img && img.getAttribute('src')) {
            img.removeAttribute('src');   // closes the stream
            return true;
        }
        return false;
    }

    function refreshCamera() {
        const rgb = ensureRgbImg();
        const thermal = ensureThermalImg();
        if (!rgb && !thermal) return;

        const url = streamUrl || LOCAL_STREAM_URL;
        const streamsOn = document.getElementById('cameraToggle')?.checked !== false;
        const signedIn = !document.body.classList.contains('ht-auth-mode');
        const shouldPlay = streamsOn && signedIn
            && currentView === 'live'       // only stream while Live is open
            && !document.hidden;            // and the tab is visible

        if (!shouldPlay) {
            const stopped = stopImg(rgb) | stopImg(thermal);
            playingUrl = null;
            if (stopped) refreshPresence();
            return;
        }

        let changed = false;
        if (rgb && !(playingUrl === url && rgb.getAttribute('src'))) {
            rgb.src = withNoCache(url);
            changed = true;
        }
        if (thermal && !(playingUrl === url && thermal.getAttribute('src'))) {
            thermal.src = withNoCache(`${baseOf(url)}/thermal?${THERMAL_QUERY}`);
            changed = true;
        }
        playingUrl = url;
        if (changed) refreshPresence();
    }

    // ---------- Live numbers from the logger (/stats) ----------
    let statsBusy = false;

    function setLive(detection, thermal) {
        window.liveDetection = detection;   // read by updateAnnotations() in script.js
        window.liveThermal = thermal;
        if (typeof updateAnnotations === 'function') updateAnnotations();
    }

    async function pollStats() {
        if (statsBusy) return;
        if (!playingUrl || currentView !== 'live' || document.hidden) return;
        statsBusy = true;
        try {
            const res = await fetch(withNoCache(`${baseOf(playingUrl)}/stats`), { cache: 'no-store' });
            const data = await res.json();
            const detection = data.model_loaded ? { ducks: data.ducks, classes: data.classes } : null;
            // Thermal data counts as live only if it was measured in the last 10 s
            const t = data.thermal;
            const fresh = t && t.measured_at && (data.time - t.measured_at) < 10;
            setLive(detection, fresh ? t : null);

            // The chips (date/time + FPS) are drawn by updateTime() in script.js
            // every second; this only hands it the measured frame rates
            window.liveFeedInfo = {
                videoFps: data.video_fps || null,
                thermalFps: fresh && t.fps ? t.fps : null,
                at: Date.now(),
            };
        } catch (_) {
            setLive(null, null);   // logger unreachable: fall back to analytics numbers
            window.liveFeedInfo = null;
        } finally {
            statsBusy = false;
        }
    }

    // ---------- Where is this user's device streaming? ----------
    function setStreamUrl(url) {
        url = url || null;
        if (url === streamUrl) return;
        streamUrl = url;
        playingUrl = null;
        stopImg(rgbImg);
        stopImg(thermalImg);
        refreshCamera();
    }

    async function readDeviceUrl() {
        if (!client) return;
        const { data: { session } } = await client.auth.getSession();
        if (!session) return;
        const { data, error } = await client
            .from('devices')
            .select('device_url, url_updated_at')
            .eq('owner_id', session.user.id)
            .not('device_url', 'is', null)
            .order('url_updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) {
            console.warn('HeatTrack: could not read devices.device_url', error);
            return;
        }
        setStreamUrl(data?.device_url);
    }

    function start() {
        readDeviceUrl().finally(refreshCamera);
        setInterval(readDeviceUrl, ADDRESS_EVERY_MS);
        setInterval(refreshCamera, CHECK_EVERY_MS);
        setInterval(pollStats, STATS_EVERY_MS);
        client?.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN') readDeviceUrl();
            if (event === 'SIGNED_OUT') { setStreamUrl(null); setLive(null, null); }
        });
        window.addEventListener('hashchange', () => setTimeout(refreshCamera, 0));
        document.addEventListener('visibilitychange', refreshCamera);
        document.addEventListener('click', () => setTimeout(refreshCamera, 0)); // nav links, login, toggles
        document.getElementById('cameraToggle')
            ?.addEventListener('change', () => setTimeout(refreshCamera, 0));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
