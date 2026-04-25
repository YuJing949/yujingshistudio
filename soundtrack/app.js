// SoundRoute prototype (single-device, in-memory, no GPS).
// Records short 8-second audio chunks (nodes) and stores estimated movement
// (step counting + compass heading) at each chunk boundary.

/* eslint-disable no-console */

const STEP_LENGTH_METERS = 0.7;
const CHUNK_SECONDS = 8;
const CHUNK_MS = CHUNK_SECONDS * 1000;

// Simple step detection tuning knobs.
// These are intentionally conservative; step detection on phones varies a lot.
const STEP_COOLDOWN_MS = 380; // avoid double-counting
const PEAK_THRESHOLD = 1.15; // magnitude delta threshold after filtering (approx)
const SMOOTHING_ALPHA = 0.85; // exponential smoothing for magnitude

// In-memory storage (requested shape).
// Each entry:
// {
//   id, timestamp, stepCount, heading, x, y, audioBlob, audioUrl, durationSeconds
// }
export const audioNodes = [];

// UI elements
const startBtn = document.getElementById("startBtn");
const endBtn = document.getElementById("endBtn");
const statusText = document.getElementById("statusText");
const permText = document.getElementById("permText");
const errorBox = document.getElementById("errorBox");
const nodesCount = document.getElementById("nodesCount");
const stepsCount = document.getElementById("stepsCount");
const posX = document.getElementById("posX");
const posY = document.getElementById("posY");
const headingVal = document.getElementById("headingVal");
const nodesList = document.getElementById("nodesList");
const nodesEmpty = document.getElementById("nodesEmpty");
const routeCanvas = document.getElementById("routeCanvas");
const routeCtx = routeCanvas.getContext("2d");

// Session state
let isRecording = false;
let mediaStream = null;
let mediaRecorder = null;
let lastChunkStartMs = 0;
let recordingLoopPromise = null;
let activeChunkStopTimer = null;

// Route redraw throttling (avoid redrawing on every motion event)
let routeRedrawPending = false;
function scheduleRouteRedraw() {
  if (routeRedrawPending) return;
  routeRedrawPending = true;
  requestAnimationFrame(() => {
    routeRedrawPending = false;
    drawRoutePreview();
  });
}

// Movement state
let stepCount = 0;
let headingDeg = NaN; // 0..360 (0 = North)
let xMeters = 0;
let yMeters = 0;

// Step detection state
let lastStepMs = 0;
let smoothedMag = 0;
let lastMagDelta = 0;

// Event handler references (so we can remove them cleanly)
let onMotion = null;
let onOrientation = null;

function setError(message) {
  if (!message) {
    errorBox.hidden = true;
    errorBox.textContent = "";
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = String(message);
}

function setStatus(text) {
  statusText.textContent = text;
}

function updateMetricsUI() {
  nodesCount.textContent = String(audioNodes.length);
  stepsCount.textContent = String(stepCount);
  posX.textContent = `x=${xMeters.toFixed(2)}`;
  posY.textContent = `y=${yMeters.toFixed(2)}`;
  headingVal.textContent = Number.isFinite(headingDeg) ? `${headingDeg.toFixed(0)}°` : "—";
}

function radians(deg) {
  return (deg * Math.PI) / 180;
}

function normalizeHeading(deg) {
  // Normalize into [0, 360)
  const n = ((deg % 360) + 360) % 360;
  return n;
}

function updatePositionForStep() {
  if (!Number.isFinite(headingDeg)) return;
  const h = radians(headingDeg);
  // Spec requirement:
  // x += stepLength * sin(heading)
  // y += stepLength * cos(heading)
  xMeters += STEP_LENGTH_METERS * Math.sin(h);
  yMeters += STEP_LENGTH_METERS * Math.cos(h);
  scheduleRouteRedraw();
}

function drawRoutePreview() {
  if (!routeCtx) return;

  // Make canvas crisp on high-DPI screens.
  const dpr = window.devicePixelRatio || 1;
  const cssSize = routeCanvas.getBoundingClientRect();
  const targetW = Math.max(1, Math.round(cssSize.width * dpr));
  const targetH = Math.max(1, Math.round(cssSize.width * dpr)); // keep it square
  if (routeCanvas.width !== targetW || routeCanvas.height !== targetH) {
    routeCanvas.width = targetW;
    routeCanvas.height = targetH;
  }

  // Draw origin + polyline connecting audio node positions.
  const w = routeCanvas.width;
  const h = routeCanvas.height;

  routeCtx.clearRect(0, 0, w, h);

  // Background grid (simple, to visually emphasize "estimate")
  routeCtx.save();
  routeCtx.globalAlpha = 0.5;
  routeCtx.strokeStyle = "rgba(255,255,255,0.08)";
  routeCtx.lineWidth = 1;
  const gridStep = 30;
  for (let gx = 0; gx <= w; gx += gridStep) {
    routeCtx.beginPath();
    routeCtx.moveTo(gx, 0);
    routeCtx.lineTo(gx, h);
    routeCtx.stroke();
  }
  for (let gy = 0; gy <= h; gy += gridStep) {
    routeCtx.beginPath();
    routeCtx.moveTo(0, gy);
    routeCtx.lineTo(w, gy);
    routeCtx.stroke();
  }
  routeCtx.restore();

  const pts = audioNodes.map((n) => ({ x: n.x, y: n.y, id: n.id }));
  // Always include origin even if there are no nodes.
  pts.unshift({ x: 0, y: 0, id: 0 });
  // Include the current live position while recording so the route updates even between nodes.
  if (isRecording) pts.push({ x: xMeters, y: yMeters, id: -1 });

  // Fit points to canvas with padding.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 28;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);

  function toCanvas(p) {
    // Canvas y grows downward; we flip Y so positive Y goes "up" visually.
    const cx = pad + (p.x - minX) * scale;
    const cy = h - (pad + (p.y - minY) * scale);
    return { cx, cy };
  }

  // Axes cross at origin (if in view).
  const origin = toCanvas({ x: 0, y: 0 });
  routeCtx.save();
  routeCtx.strokeStyle = "rgba(255,255,255,0.18)";
  routeCtx.lineWidth = 1;
  routeCtx.beginPath();
  routeCtx.moveTo(0, origin.cy);
  routeCtx.lineTo(w, origin.cy);
  routeCtx.moveTo(origin.cx, 0);
  routeCtx.lineTo(origin.cx, h);
  routeCtx.stroke();
  routeCtx.restore();

  // Polyline
  routeCtx.save();
  routeCtx.strokeStyle = "rgba(10,132,255,0.95)";
  routeCtx.lineWidth = 3;
  routeCtx.lineJoin = "round";
  routeCtx.lineCap = "round";
  routeCtx.beginPath();
  pts.forEach((p, idx) => {
    const { cx, cy } = toCanvas(p);
    if (idx === 0) routeCtx.moveTo(cx, cy);
    else routeCtx.lineTo(cx, cy);
  });
  routeCtx.stroke();
  routeCtx.restore();

  // Points
  routeCtx.save();
  for (const p of pts) {
    const { cx, cy } = toCanvas(p);
    const isOrigin = p.id === 0;
    const isLive = p.id === -1;
    routeCtx.fillStyle = isOrigin
      ? "rgba(52,199,89,0.95)"
      : isLive
        ? "rgba(255,149,0,0.95)"
        : "rgba(255,255,255,0.95)";
    routeCtx.beginPath();
    routeCtx.arc(cx, cy, isOrigin ? 5 : isLive ? 5 : 4, 0, Math.PI * 2);
    routeCtx.fill();
  }
  routeCtx.restore();
}

function renderNodesList() {
  nodesList.innerHTML = "";
  nodesEmpty.hidden = audioNodes.length !== 0;

  for (const node of audioNodes) {
    const li = document.createElement("li");
    li.className = "node";

    const top = document.createElement("div");
    top.className = "node-top";

    const title = document.createElement("div");
    title.className = "node-title";
    title.textContent = `Node ${node.id}`;

    const meta = document.createElement("div");
    meta.className = "node-meta";
    meta.textContent = new Date(node.timestamp).toLocaleTimeString();

    top.appendChild(title);
    top.appendChild(meta);

    const grid = document.createElement("div");
    grid.className = "node-grid";

    const kv = (k, v) => {
      const wrap = document.createElement("div");
      wrap.className = "kv";
      const kk = document.createElement("div");
      kk.className = "k";
      kk.textContent = k;
      const vv = document.createElement("div");
      vv.className = "v";
      vv.textContent = v;
      wrap.appendChild(kk);
      wrap.appendChild(vv);
      return wrap;
    };

    grid.appendChild(kv("Steps", String(node.stepCount)));
    grid.appendChild(kv("Heading", Number.isFinite(node.heading) ? `${node.heading.toFixed(0)}°` : "—"));
    grid.appendChild(kv("x", node.x.toFixed(2)));
    grid.appendChild(kv("y", node.y.toFixed(2)));

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = node.audioUrl;

    li.appendChild(top);
    li.appendChild(grid);
    li.appendChild(audio);

    nodesList.appendChild(li);
  }
}

async function requestMotionPermissionIfNeeded() {
  // iOS 13+ requires a user gesture for motion/orientation permission prompts.
  const DME = window.DeviceMotionEvent;
  if (DME && typeof DME.requestPermission === "function") {
    console.log("[perm] Requesting motion permission…");
    const res = await DME.requestPermission();
    console.log("[perm] Motion permission:", res);
    if (res !== "granted") throw new Error("Motion permission not granted.");
  }
}

async function requestOrientationPermissionIfNeeded() {
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === "function") {
    console.log("[perm] Requesting orientation permission…");
    const res = await DOE.requestPermission();
    console.log("[perm] Orientation permission:", res);
    if (res !== "granted") throw new Error("Orientation permission not granted.");
  }
}

function startSensorTracking() {
  // Motion: detect steps from acceleration magnitude changes.
  onMotion = (ev) => {
    if (!isRecording) return;

    const a = ev.accelerationIncludingGravity || ev.acceleration;
    if (!a) return;

    // Magnitude of acceleration vector (m/s^2).
    const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);

    // Exponential smoothing to reduce noise.
    if (smoothedMag === 0) smoothedMag = mag;
    smoothedMag = SMOOTHING_ALPHA * smoothedMag + (1 - SMOOTHING_ALPHA) * mag;

    // Use delta from smoothed baseline as a simple "high-pass" proxy.
    const delta = mag - smoothedMag;
    const now = performance.now();

    // Peak-ish detection: look for rising crossing above threshold.
    const risingCross = lastMagDelta <= PEAK_THRESHOLD && delta > PEAK_THRESHOLD;
    const cooledDown = now - lastStepMs > STEP_COOLDOWN_MS;

    if (risingCross && cooledDown) {
      lastStepMs = now;
      stepCount += 1;
      updatePositionForStep();
      updateMetricsUI();
      console.log("[step]", { stepCount, headingDeg, xMeters, yMeters, delta: delta.toFixed(2) });
    }

    lastMagDelta = delta;
  };

  // Orientation: estimate compass heading.
  // iOS Safari provides `webkitCompassHeading` (0..360, where 0 is North).
  // If not available, fall back to `alpha` (device orientation), which may not be true compass.
  onOrientation = (ev) => {
    if (!isRecording) return;
    let h = NaN;

    if (typeof ev.webkitCompassHeading === "number") {
      h = ev.webkitCompassHeading;
    } else if (typeof ev.alpha === "number") {
      // Note: This fallback often differs by device/OS and can drift.
      // We still normalize and show it as "heading" for prototype purposes.
      h = 360 - ev.alpha;
    }

    if (Number.isFinite(h)) {
      headingDeg = normalizeHeading(h);
      updateMetricsUI();
    }
  };

  window.addEventListener("devicemotion", onMotion, { passive: true });
  window.addEventListener("deviceorientation", onOrientation, { passive: true });
}

function stopSensorTracking() {
  if (onMotion) window.removeEventListener("devicemotion", onMotion);
  if (onOrientation) window.removeEventListener("deviceorientation", onOrientation);
  onMotion = null;
  onOrientation = null;
}

function resetSessionState() {
  audioNodes.splice(0, audioNodes.length);
  stepCount = 0;
  headingDeg = NaN;
  xMeters = 0;
  yMeters = 0;

  lastStepMs = 0;
  smoothedMag = 0;
  lastMagDelta = 0;

  updateMetricsUI();
  renderNodesList();
  drawRoutePreview();
}

function setButtonsForRecording(recording) {
  startBtn.disabled = recording;
  endBtn.disabled = !recording;
}

function formatPermStatus(parts) {
  return parts.filter(Boolean).join(" · ");
}

async function startRecordingSession() {
  if (isRecording) {
    console.warn("[rec] start ignored; already recording");
    return;
  }

  setError("");
  setStatus("Requesting permissions…");
  permText.textContent = "Requesting microphone + motion + orientation permissions…";
  setButtonsForRecording(true);

  try {
    // Reset state at the start of each session.
    resetSessionState();
    setStatus("Starting…");

    // IMPORTANT (iPhone Safari):
    // Motion/Orientation permission prompts MUST be triggered directly by a user gesture.
    // If we await something else first (like getUserMedia), iOS may treat the gesture as "lost"
    // and throw: "requesting device motion access requires a user gesture to prompt".
    //
    // So we request motion/orientation FIRST, then microphone.

    // 1) Motion/Orientation permissions (iOS 13+ requires requestPermission()).
    await requestMotionPermissionIfNeeded();
    await requestOrientationPermissionIfNeeded();
    permText.textContent = formatPermStatus(["Motion OK", "Orientation OK"]);

    // 2) Microphone permission (also must be from user tap).
    console.log("[perm] Requesting microphone permission via getUserMedia…");
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("[perm] Microphone granted.");
    permText.textContent = formatPermStatus(["Microphone OK", "Motion OK", "Orientation OK"]);

    // 3) Start tracking sensors.
    isRecording = true;
    startSensorTracking();

    // 4) Start MediaRecorder loop producing *independent* 8-second files.
    //
    // iPhone Safari gotcha:
    // Using `mediaRecorder.start(timeslice)` can emit "fragment" blobs after the first one,
    // which often won't play back as standalone audio files.
    // So we STOP and RESTART recording every 8 seconds, building a self-contained Blob per node.
    if (!window.MediaRecorder) {
      throw new Error("MediaRecorder is not supported in this browser.");
    }

    const options = {};
    // Safari support varies; letting it pick tends to be most compatible.
    // You can experiment with explicit types later:
    // options.mimeType = "audio/mp4";
    // options.mimeType = "audio/webm;codecs=opus";

    let nodeId = 1;

    const recordOneChunk = () =>
      new Promise((resolve, reject) => {
        const chunkStart = Date.now();
        const chunks = [];

        // Create a fresh MediaRecorder each chunk to maximize Safari compatibility.
        const rec = new MediaRecorder(mediaStream, options);
        mediaRecorder = rec;
        lastChunkStartMs = chunkStart;

        rec.addEventListener("dataavailable", (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        });
        rec.addEventListener("error", (e) => reject(e));
        rec.addEventListener("start", () => console.log("[audio] chunk started"));
        rec.addEventListener("stop", () => {
          console.log("[audio] chunk stopped");
          const blob = new Blob(chunks, { type: chunks[0]?.type || rec.mimeType || "" });
          const durationSeconds = Math.max(0.1, (Date.now() - chunkStart) / 1000);
          resolve({ blob, durationSeconds, timestamp: Date.now() });
        });

        rec.start(); // no timeslice; we stop manually
        activeChunkStopTimer = window.setTimeout(() => {
          activeChunkStopTimer = null;
          try {
            if (rec.state !== "inactive") rec.stop();
          } catch (e) {
            reject(e);
          }
        }, CHUNK_MS);
      });

    const recordingLoop = async () => {
      while (isRecording) {
        const { blob, durationSeconds, timestamp } = await recordOneChunk();
        if (!blob || blob.size === 0) {
          console.log("[audio] empty chunk ignored");
          continue;
        }

        const url = URL.createObjectURL(blob);
        const node = {
          id: nodeId++,
          timestamp,
          stepCount,
          heading: headingDeg,
          x: xMeters,
          y: yMeters,
          audioBlob: blob,
          audioUrl: url,
          durationSeconds: Math.round(durationSeconds),
        };

        audioNodes.push(node);
        console.log("[node] saved", { ...node, audioBlob: `Blob(${blob.type || "unknown"}, ${blob.size} bytes)` });

        updateMetricsUI();
        renderNodesList();
        drawRoutePreview();
      }
    };

    recordingLoopPromise = recordingLoop();

    setStatus("Recording…");
    permText.textContent = formatPermStatus(["Microphone OK", "Motion listening", "Orientation listening"]);
    updateMetricsUI();

    // Important: audio playback must be user-initiated on iOS. We only render controls;
    // user tapping play is a gesture, so that's OK.
    console.log("[rec] session started");
  } catch (err) {
    console.log("[rec] start failed:", err);
    setError(err?.message || String(err));
    setStatus("Not recording");
    permText.textContent = "Permission or setup failed. Check the error above.";

    // Clean up any partial state.
    await stopRecordingSession({ keepNodes: true, silent: true });
    setButtonsForRecording(false);
  }
}

async function stopRecordingSession({ keepNodes, silent } = { keepNodes: true, silent: false }) {
  if (!isRecording && !mediaRecorder && !mediaStream) {
    if (!silent) console.warn("[rec] stop ignored; nothing to stop");
    return;
  }

  console.log("[rec] stopping…");
  isRecording = false;
  stopSensorTracking();

  // Stop current chunk timer + recorder (may emit a final dataavailable).
  try {
    if (activeChunkStopTimer) {
      clearTimeout(activeChunkStopTimer);
      activeChunkStopTimer = null;
    }
  } catch (e) {
    console.log("[rec] timer clear error", e);
  }

  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  } catch (e) {
    console.log("[rec] recorder stop error", e);
  }

  // Wait for the loop to finish cleanly (so the last chunk can be saved).
  try {
    if (recordingLoopPromise) await recordingLoopPromise;
  } catch (e) {
    console.log("[rec] loop await error", e);
  } finally {
    recordingLoopPromise = null;
  }

  // Stop mic tracks.
  try {
    if (mediaStream) {
      for (const t of mediaStream.getTracks()) t.stop();
    }
  } catch (e) {
    console.log("[rec] stream stop error", e);
  }

  mediaRecorder = null;
  mediaStream = null;

  setButtonsForRecording(false);
  if (!silent) setStatus("Recording stopped");
  permText.textContent = "Not recording.";

  if (!keepNodes) {
    // If you ever want a full reset on End, change keepNodes to false.
    resetSessionState();
  } else {
    updateMetricsUI();
    renderNodesList();
    drawRoutePreview();
  }
}

// Buttons (must be user gesture)
startBtn.addEventListener("click", () => {
  console.log("[ui] Start tapped");
  startRecordingSession();
});

endBtn.addEventListener("click", () => {
  console.log("[ui] End tapped");
  stopRecordingSession({ keepNodes: true, silent: false });
});

// Initial UI
setButtonsForRecording(false);
setStatus("Not recording");
updateMetricsUI();
drawRoutePreview();

console.log("[init] SoundRoute prototype loaded");

