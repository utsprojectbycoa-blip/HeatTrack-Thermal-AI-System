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
    const FIRST_FRAME_MS = 10000;       // no picture this long after connecting: reconnect quietly
    const STATS_RETRY_MS = 5000;        // logger unreachable: ask again this often (not every second)
    // What each monitor shows for the camera state the logger reports in /stats
    const FEED_TEXT = {
        absent: 'Camera not connected',
        connecting: 'Connecting to camera...',
        problem: 'Camera not responding...',
    };
    // Same 25-45 °C range as the colour scale drawn on the Thermal Monitor
    const THERMAL_QUERY = 'min=25&max=45&hud=0';

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

    function makeFeedImg(containerId, id, alt, fit) {
        const layer = document.querySelector(`#${containerId} .camera-zoom-layer`);
        if (!layer) return null;
        const img = document.createElement('img');
        img.id = id;
        img.alt = alt;
        img.draggable = false;
        img.style.cssText = `width:100%;height:100%;object-fit:${fit};display:block;background:#000;`;
        img.dataset.feed = '1';   // script.js shows the monitor only when data-live is set
        img.addEventListener('load', () => markLiveIfDrawn(img));
        img.addEventListener('error', () => {
            // Logger not running / tunnel not ready yet: retry on the next check
            img.removeAttribute('src');
            delete img.dataset.live;
            applyFeedText(img);
        });
        layer.prepend(img);
        return img;
    }

    function ensureRgbImg() {
        if (!rgbImg || !rgbImg.isConnected) {
            rgbImg = makeFeedImg('normalCameraContainer', 'normalFeed', 'RGB camera live feed', 'cover');
        }
        return rgbImg;
    }

    function ensureThermalImg() {
        if (!thermalImg || !thermalImg.isConnected) {
            // "contain" so no duck box or temperature label is cropped off
            thermalImg = makeFeedImg('thermalCameraContainer', 'thermalFeed',
                'Thermal camera live view with duck surface temperatures', 'contain');
        }
        return thermalImg;
    }

    // The overlay text for a monitor: the camera's state from /stats (default
    // "not connected" until the logger answers). A streaming camera whose
    // picture hasn't reached this page yet still says "Connecting to camera..."
    function applyFeedText(img) {
        if (!img) return;
        const state = img.dataset.state || 'absent';
        const text = state === 'streaming'
            ? (img.dataset.live === '1' ? '' : FEED_TEXT.connecting)
            : (FEED_TEXT[state] || FEED_TEXT.absent);
        if ((img.dataset.offlineText || '') !== text) {
            if (text) img.dataset.offlineText = text; else delete img.dataset.offlineText;
        }
        refreshPresence();
    }

    function setFeedState(img, state) {
        if (!img || img.dataset.state === state) return;
        img.dataset.state = state;
        applyFeedText(img);
    }

    function stopImg(img) {
        if (img) delete img.dataset.live;
        if (img && img.getAttribute('src')) {
            img.removeAttribute('src');   // closes the stream
            return true;
        }
        return false;
    }

    // First frame arrived: the camera is really sending a picture. Called from
    // the load event and also on every check, since browsers differ in whether
    // they fire load for MJPEG streams
    function markLiveIfDrawn(img) {
        if (!img || !img.getAttribute('src') || !img.naturalWidth || img.dataset.live === '1') return false;
        img.dataset.live = '1';
        // Older loggers don't report camera states: a picture means it works
        if (!img.dataset.state) img.dataset.state = 'streaming';
        applyFeedText(img);
        return true;
    }

    // Retries happen quietly: the message only changes with the camera state
    function startImg(img, src) {
        delete img.dataset.live;
        img.__startedAt = Date.now();
        img.src = src;
    }

    // Connected but no frame yet after FIRST_FRAME_MS (e.g. the webcam is
    // unplugged, so the logger never sends one): reconnect on the next check
    function checkFirstFrame(img) {
        if (!img || !img.getAttribute('src') || img.dataset.live === '1') return false;
        if (Date.now() - (img.__startedAt || 0) < FIRST_FRAME_MS) return false;
        img.removeAttribute('src');
        return true;
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

        markLiveIfDrawn(rgb);
        markLiveIfDrawn(thermal);
        let changed = checkFirstFrame(rgb) | checkFirstFrame(thermal);
        if (rgb && !(playingUrl === url && rgb.getAttribute('src'))) {
            startImg(rgb, withNoCache(url));
            changed = true;
        }
        if (thermal && !(playingUrl === url && thermal.getAttribute('src'))) {
            startImg(thermal, withNoCache(`${baseOf(url)}/thermal?${THERMAL_QUERY}`));
            changed = true;
        }
        playingUrl = url;
        if (changed) refreshPresence();
    }

    // ---------- Live numbers from the logger (/stats) ----------
    let statsBusy = false;
    let statsFailedAt = 0;

    function setLive(detection, thermal) {
        window.liveDetection = detection;   // read by updateAnnotations() in script.js
        window.liveThermal = thermal;
        if (typeof updateAnnotations === 'function') updateAnnotations();
    }

    async function pollStats() {
        if (statsBusy) return;
        if (!playingUrl || currentView !== 'live' || document.hidden) return;
        if (Date.now() - statsFailedAt < STATS_RETRY_MS) return;
        statsBusy = true;
        try {
            const res = await fetch(withNoCache(`${baseOf(playingUrl)}/stats`), { cache: 'no-store' });
            const data = await res.json();
            const detection = data.model_loaded ? { ducks: data.ducks, classes: data.classes } : null;
            // Thermal data counts as live only if it was measured in the last 10 s
            const t = data.thermal;
            const fresh = t && t.measured_at && (data.time - t.measured_at) < 10;
            setLive(detection, fresh ? t : null);

            statsFailedAt = 0;

            // The logger knows whether each camera is plugged in and sending
            if (data.cameras) {
                setFeedState(rgbImg, data.cameras.rgb || 'absent');
                setFeedState(thermalImg, data.cameras.thermal || 'absent');
            }

            // The chips (date/time + FPS) are drawn by updateTime() in script.js
            // every second; this only hands it the measured frame rates
            window.liveFeedInfo = {
                videoFps: data.video_fps || null,
                thermalFps: fresh && t.fps ? t.fps : null,
                at: Date.now(),
            };
        } catch (_) {
            setLive(null, null);   // logger unreachable: fall back to analytics numbers
            statsFailedAt = Date.now();
            setFeedState(rgbImg, 'absent');
            setFeedState(thermalImg, 'absent');
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
        statsFailedAt = 0;
        setFeedState(rgbImg, 'absent');
        setFeedState(thermalImg, 'absent');
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
