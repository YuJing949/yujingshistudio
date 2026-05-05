// SoundRoute prototype (single-device, in-memory, no GPS).
// Records short 8-second audio chunks (nodes) and stores estimated movement
// (step counting + compass heading) at each chunk boundary.

/* eslint-disable no-console */

const STEP_LENGTH_METERS = 0.7;
const CHUNK_SECONDS = 8;
const CHUNK_MS = CHUNK_SECONDS * 1000;
// If Safari never fires `stop` after `rec.stop()`, unblock the recording loop.
const CHUNK_HARD_TIMEOUT_MS = CHUNK_MS + 6000;
const CHUNK_MAX_CONSECUTIVE_FAILURES = 8;
const CHUNK_RETRY_BACKOFF_MS = 400;

// Simple step detection tuning knobs.
// These are intentionally conservative; step detection on phones varies a lot.
const STEP_COOLDOWN_MS = 380; // avoid double-counting
const PEAK_THRESHOLD = 1.15; // magnitude delta threshold after filtering (approx)
const SMOOTHING_ALPHA = 0.85; // exponential smoothing for magnitude

// Listen Mode tuning
const DIRECTION_CONE_DEGREES = 45;
const DIRECTION_UPDATE_INTERVAL_MS = 2000;
const MAX_LISTEN_DISTANCE = 8;
const VOLUME_UPDATE_INTERVAL_MS = 150;
const MIN_LISTEN_VOLUME = 0.2;

// In-memory route sessions (single-device, no backend).
//
// routes = [
//   {
//     id: string,
//     name: string,
//     createdAt: number,
//     nodes: [ ...audioNodes ]
//   }
// ]
//
// During recording we keep a separate `currentRecordingRoute` until the walk ends.
let routes = [];
let currentRecordingRoute = null;
let selectedRoute = null;
let routeCounter = 0;

// UI elements
const startBtn = document.getElementById("startBtn");
const endBtn = document.getElementById("endBtn");
const deleteRouteBtn = document.getElementById("deleteRouteBtn");
const routesList = document.getElementById("routesList");
const routesEmpty = document.getElementById("routesEmpty");

// Listen Mode UI
const listenToggleBtn = document.getElementById("listenToggleBtn");
const listenRouteSelect = document.getElementById("listenRouteSelect");
const listenWarn = document.getElementById("listenWarn");
const listenToText = document.getElementById("listenToText");
const nearestNodeText = document.getElementById("nearestNodeText");
const distanceText = document.getElementById("distanceText");
const playbackText = document.getElementById("playbackText");

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

const debugLogPre = document.getElementById("debugLogPre");
const debugClearBtn = document.getElementById("debugClearBtn");
const MAX_DEBUG_LOG_LINES = 250;

function debugLog(...args) {
  console.log(...args);
  if (!debugLogPre) return;
  const ts = new Date().toISOString().slice(11, 23);
  const text = args
    .map((a) => {
      if (a == null) return String(a);
      if (typeof a === "string") return a;
      if (typeof a === "number" || typeof a === "boolean") return String(a);
      if (a instanceof Error) return a.message || String(a);
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  debugLogPre.textContent += `[${ts}] ${text}\n`;
  const lines = debugLogPre.textContent.split("\n");
  if (lines.length > MAX_DEBUG_LOG_LINES) {
    debugLogPre.textContent = lines.slice(-MAX_DEBUG_LOG_LINES).join("\n");
  }
  debugLogPre.scrollTop = debugLogPre.scrollHeight;
}

debugClearBtn?.addEventListener("click", () => {
  if (debugLogPre) debugLogPre.textContent = "";
});

// Session state
let isRecording = false;
let isCalibrating = false;
let mediaStream = null;
let mediaRecorder = null;
let lastChunkStartMs = 0;
let recordingLoopPromise = null;
let activeChunkStopTimer = null;
let recordingSessionToken = 0;

// Listen Mode state
let listenModeEnabled = false;
let listeningSourceRouteId = "";
let currentlyPlayingNodeId = null;
let listenNearest = { nodeId: null, distance: Infinity };
let lastDirectionUpdateMs = 0;
let currentAudio = null;
let currentRouteDirectionDeg = NaN;
let volumeUpdateTimer = null;
let lastVolumeLogMs = 0;

const listenAudio = new Audio();
listenAudio.preload = "none";
currentAudio = listenAudio;
listenAudio.addEventListener("ended", () => {
  console.log("[listen] Audio ended, recalculating");
  if (volumeUpdateTimer) {
    clearInterval(volumeUpdateTimer);
    volumeUpdateTimer = null;
  }
  currentRouteDirectionDeg = NaN;
  currentAudio = null;
  currentlyPlayingNodeId = null;
  // Immediately re-evaluate based on current heading + position.
  lastDirectionUpdateMs = 0;
  updateListenMode(xMeters, yMeters, headingDeg);
});

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

// Debug log throttles (to avoid console spam affecting performance).
let lastMotionLogMs = 0;
let lastOrientationLogMs = 0;

// Event handler references (so we can remove them cleanly)
let onMotion = null;
let onOrientation = null;

function makeId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function getViewingRoute() {
  // While recording, never fall back to a previously selected saved route (would show wrong nodes + only live moving).
  if (isRecording && currentRecordingRoute) {
    return currentRecordingRoute;
  }
  // Prefer in-progress or unsaved draft route so the map matches partial saves after errors.
  return currentRecordingRoute ?? selectedRoute;
}

function getViewingNodes() {
  const r = getViewingRoute();
  return r?.nodes || [];
}

function getRouteById(id) {
  return routes.find((r) => r.id === id) || null;
}

function setListenWarn(message) {
  if (!message) {
    listenWarn.hidden = true;
    listenWarn.textContent = "";
    return;
  }
  listenWarn.hidden = false;
  listenWarn.textContent = String(message);
}

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
  nodesCount.textContent = String(getViewingNodes().length);
  stepsCount.textContent = String(stepCount);
  posX.textContent = `x=${xMeters.toFixed(2)}`;
  posY.textContent = `y=${yMeters.toFixed(2)}`;
  if (Number.isFinite(headingDeg)) {
    headingVal.textContent = `${headingDeg.toFixed(0)}°`;
  } else if (isRecording) {
    headingVal.textContent = "Waiting for heading…";
  } else {
    headingVal.textContent = "—";
  }
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
  // Only update position if we have a valid heading.
  if (!Number.isFinite(headingDeg)) return;
  const h = radians(headingDeg);
  // Spec requirement:
  // x += stepLength * sin(heading)
  // y += stepLength * cos(heading)
  xMeters += STEP_LENGTH_METERS * Math.sin(h);
  yMeters += STEP_LENGTH_METERS * Math.cos(h);
  scheduleRouteRedraw();
  updateListenModeThrottled();
}

// Meters — snap estimated positions this close into one "stack" for display.
const COINCIDENT_NODE_GRID_M = 0.04;
const COINCIDENT_NODE_SPREAD_M = 0.16;

/**
 * Several audio nodes can share the same estimated (x,y) (e.g. heading not ready yet). Dots are drawn in order
 * and the orange live marker is on top, so stacked white nodes look "missing". Spread only for drawing markers;
 * the polyline still uses true coordinates.
 */
function spreadCoincidentNodeMarkersForDisplay(points) {
  const audioPts = points.filter((p) => p.id > 0);
  const keyCounts = new Map();
  for (const p of audioPts) {
    const key = `${Math.round(p.x / COINCIDENT_NODE_GRID_M)},${Math.round(p.y / COINCIDENT_NODE_GRID_M)}`;
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }
  const keyIndex = new Map();
  const out = [];
  for (const p of points) {
    if (p.id <= 0) {
      out.push(p);
      continue;
    }
    const key = `${Math.round(p.x / COINCIDENT_NODE_GRID_M)},${Math.round(p.y / COINCIDENT_NODE_GRID_M)}`;
    const total = keyCounts.get(key) || 1;
    const i = keyIndex.get(key) || 0;
    keyIndex.set(key, i + 1);
    if (total <= 1) {
      out.push(p);
      continue;
    }
    const ang = (2 * Math.PI * i) / Math.min(total, 12);
    const ring = COINCIDENT_NODE_SPREAD_M * (1 + Math.floor(i / 12));
    out.push({
      ...p,
      x: p.x + ring * Math.cos(ang),
      y: p.y + ring * Math.sin(ang),
    });
  }
  return out;
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

  // Primary route points (what we're viewing: recording route while recording, otherwise selectedRoute)
  const nodesPrimary = getViewingNodes();
  const ptsPrimary = nodesPrimary.map((n) => ({ x: n.x, y: n.y, id: n.id, kind: "primary" }));
  // Always include origin even if there are no nodes.
  ptsPrimary.unshift({ x: 0, y: 0, id: 0, kind: "origin" });
  // Include the current live position while recording so the route updates even between nodes.
  if (isRecording) ptsPrimary.push({ x: xMeters, y: yMeters, id: -1, kind: "live" });

  // Secondary route (Listen Mode source) while recording.
  const sourceRoute = listenModeEnabled ? getRouteById(listeningSourceRouteId) : null;
  const nodesSecondary = isRecording && sourceRoute ? sourceRoute.nodes : [];
  const ptsSecondary = nodesSecondary.map((n) => ({ x: n.x, y: n.y, id: n.id, kind: "secondary" }));

  // Combine for bounds fitting.
  const ptsAll = ptsPrimary.concat(ptsSecondary);

  // Fit points to canvas with padding.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of ptsAll) {
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

  function strokePath(points, style) {
    if (points.length < 2) return;
    routeCtx.save();
    routeCtx.strokeStyle = style.strokeStyle;
    routeCtx.lineWidth = style.lineWidth;
    routeCtx.lineJoin = "round";
    routeCtx.lineCap = "round";
    routeCtx.beginPath();
    points.forEach((p, idx) => {
      const { cx, cy } = toCanvas(p);
      if (idx === 0) routeCtx.moveTo(cx, cy);
      else routeCtx.lineTo(cx, cy);
    });
    routeCtx.stroke();
    routeCtx.restore();
  }

  // Draw secondary (listen source) first, lighter.
  if (nodesSecondary.length > 0) {
    const ptsS = [{ x: 0, y: 0, id: 0, kind: "origin2" }].concat(ptsSecondary);
    strokePath(ptsS, { strokeStyle: "rgba(255,255,255,0.22)", lineWidth: 2 });
  }

  // Draw primary (current route) on top.
  strokePath(ptsPrimary, { strokeStyle: "rgba(10,132,255,0.95)", lineWidth: 3 });

  // Points (spread coincident audio nodes so they are not hidden under the live marker)
  const ptsPrimaryMarkers = spreadCoincidentNodeMarkersForDisplay(ptsPrimary);
  routeCtx.save();
  for (const p of ptsPrimaryMarkers) {
    const { cx, cy } = toCanvas(p);
    const isOrigin = p.id === 0;
    const isLive = p.id === -1;
    routeCtx.fillStyle = isOrigin ? "rgba(52,199,89,0.95)" : isLive ? "rgba(255,149,0,0.95)" : "rgba(255,255,255,0.95)";
    routeCtx.beginPath();
    routeCtx.arc(cx, cy, isOrigin ? 5 : isLive ? 5 : 4, 0, Math.PI * 2);
    routeCtx.fill();
  }
  routeCtx.restore();

  // Highlight nearest listening node (only during recording + listen mode).
  if (isRecording && sourceRoute && listenNearest.nodeId != null) {
    const n = sourceRoute.nodes.find((x) => x.id === listenNearest.nodeId);
    if (n) {
      const { cx, cy } = toCanvas({ x: n.x, y: n.y });
      routeCtx.save();
      routeCtx.strokeStyle = "rgba(255,149,0,0.95)";
      routeCtx.lineWidth = 3;
      routeCtx.beginPath();
      routeCtx.arc(cx, cy, 9, 0, Math.PI * 2);
      routeCtx.stroke();
      routeCtx.restore();
    }
  }
}

function renderNodesList() {
  nodesList.innerHTML = "";
  const nodes = getViewingNodes();
  nodesEmpty.hidden = nodes.length !== 0;

  for (const node of nodes) {
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

function renderRoutesPanel() {
  routesList.innerHTML = "";
  routesEmpty.hidden = routes.length !== 0;

  for (const route of routes) {
    const li = document.createElement("li");
    li.className = "route" + (selectedRoute?.id === route.id ? " selected" : "");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "route-btn";
    btn.addEventListener("click", () => {
      if (isRecording) return; // keep viewing in recording mode
      selectedRoute = route;
      console.log("[route] selected", route.name);
      updateMetricsUI();
      renderRoutesPanel();
      renderNodesList();
      drawRoutePreview();
      updateDeleteRouteButton();
    });

    const title = document.createElement("div");
    title.className = "route-title";
    title.textContent = route.name;

    const sub = document.createElement("div");
    sub.className = "route-sub";
    sub.textContent = `${route.nodes.length} nodes · ${new Date(route.createdAt).toLocaleString()}`;

    btn.appendChild(title);
    btn.appendChild(sub);
    li.appendChild(btn);
    routesList.appendChild(li);
  }
}

function updateDeleteRouteButton() {
  // Only allow deleting when not recording, and a route is selected.
  deleteRouteBtn.disabled = isRecording || !selectedRoute;
}

function renderListenRouteOptions() {
  // Only saved routes can be listening sources.
  const hasRoutes = routes.length > 0;
  listenRouteSelect.disabled = !hasRoutes || isRecording; // keep stable during recording
  listenToggleBtn.disabled = !hasRoutes;

  const prev = listeningSourceRouteId;
  listenRouteSelect.innerHTML = "";

  if (!hasRoutes) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Record a route first…";
    listenRouteSelect.appendChild(opt);
    listeningSourceRouteId = "";
    return;
  }

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Select a route…";
  listenRouteSelect.appendChild(opt0);

  for (const r of routes) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = `${r.name} (${r.nodes.length} nodes)`;
    listenRouteSelect.appendChild(opt);
  }

  // Restore previous selection if still present.
  if (prev && getRouteById(prev)) {
    listeningSourceRouteId = prev;
    listenRouteSelect.value = prev;
  } else {
    listeningSourceRouteId = "";
    listenRouteSelect.value = "";
  }
}

function setListenToggleUI() {
  listenToggleBtn.textContent = listenModeEnabled ? "Disable Listen Mode" : "Enable Listen Mode";
  listenToText.textContent = listeningSourceRouteId ? getRouteById(listeningSourceRouteId)?.name || "—" : "—";
}

function stopListeningPlayback(reason) {
  if (currentlyPlayingNodeId != null) {
    console.log("[listen] Stopping node", currentlyPlayingNodeId, reason ? `(${reason})` : "");
  }
  try {
    currentAudio?.pause();
    if (currentAudio) currentAudio.currentTime = 0;
  } catch {
    // ignore
  }
  if (volumeUpdateTimer) {
    clearInterval(volumeUpdateTimer);
    volumeUpdateTimer = null;
  }
  currentRouteDirectionDeg = NaN;
  currentAudio = null;
  currentlyPlayingNodeId = null;
  playbackText.textContent = "No nearby sound";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function unlockAudioPlayback() {
  // Attempt to "unlock" audio on iOS Safari by playing a short silent sound
  // as a direct result of a user interaction (Enable Listen Mode tap).
  // Not guaranteed on all iOS versions, but helps.
  const silentWav =
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
  try {
    if (!currentAudio) currentAudio = listenAudio;
    const prevSrc = currentAudio.src;
    const prevVol = currentAudio.volume;
    currentAudio.src = silentWav;
    currentAudio.volume = 0;
    await currentAudio.play();
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio.volume = prevVol;
    currentAudio.src = prevSrc;
    console.log("[listen] Audio unlocked");
  } catch (e) {
    console.log("[listen] Audio unlock failed", e);
  }
}

function getDistanceToNode(node, currentX, currentY) {
  const dx = currentX - node.x;
  const dy = currentY - node.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getBearingToNode(currentX, currentY, node) {
  // 0 = north (+y), 90 = east (+x), 180 = south (-y), 270 = west (-x)
  const dx = node.x - currentX;
  const dy = node.y - currentY;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return normalizeHeading(deg);
}

function getAngleDifference(a, b) {
  // Smallest difference in degrees: 0..180
  const diff = Math.abs(normalizeHeading(a) - normalizeHeading(b));
  return diff > 180 ? 360 - diff : diff;
}

function getRouteDirectionForNode(sourceRoute, node) {
  // Direction implied by the route: from this node to the next node.
  const idx = sourceRoute.nodes.findIndex((n) => n.id === node.id);
  const next = idx >= 0 ? sourceRoute.nodes[idx + 1] : null;
  if (next) {
    const dx = next.x - node.x;
    const dy = next.y - node.y;
    const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
    return normalizeHeading(deg);
  }
  // Fallback: recorded node heading.
  if (Number.isFinite(node.heading)) return normalizeHeading(node.heading);
  return NaN;
}

function mapVolumeFromAngleDiff(angleDiff) {
  // Mapping:
  // <=20° => 1
  // 20..90 => 1 down to 0.2
  // >90 => 0.2
  if (!Number.isFinite(angleDiff)) return 1;
  let v = 1;
  if (angleDiff <= 20) v = 1;
  else if (angleDiff <= 90) v = 1 - ((angleDiff - 20) / 70) * 0.8;
  else v = MIN_LISTEN_VOLUME;
  v = Math.min(1, Math.max(MIN_LISTEN_VOLUME, v));
  return v;
}

function startVolumeTracking() {
  if (volumeUpdateTimer) {
    clearInterval(volumeUpdateTimer);
    volumeUpdateTimer = null;
  }
  volumeUpdateTimer = setInterval(() => {
    if (!listenModeEnabled) return;
    if (!currentAudio || currentAudio.paused) return;
    if (!Number.isFinite(currentRouteDirectionDeg)) return;
    if (!Number.isFinite(headingDeg)) return;

    const angleDiff = getAngleDifference(headingDeg, currentRouteDirectionDeg);
    const v = mapVolumeFromAngleDiff(angleDiff);
    currentAudio.volume = v;

    // Optional UI: show angle + volume.
    // Keep it short to avoid UI jitter: only update playbackText.
    playbackText.textContent = `Playing Node ${currentlyPlayingNodeId} (Angle ${angleDiff.toFixed(0)}° / v=${v.toFixed(
      2
    )})`;

    const now = performance.now();
    if (now - lastVolumeLogMs > 1200) {
      lastVolumeLogMs = now;
      console.log("[listen] Route direction:", currentRouteDirectionDeg.toFixed(0));
      console.log("[listen] User heading:", headingDeg.toFixed(0));
      console.log("[listen] Angle diff:", angleDiff.toFixed(1));
      console.log("[listen] Volume set to:", v.toFixed(2));
    }
  }, VOLUME_UPDATE_INTERVAL_MS);
}

function findDirectionalNearestNode(currentX, currentY, heading, sourceRoute) {
  const candidates = [];
  for (const n of sourceRoute.nodes) {
    const distance = getDistanceToNode(n, currentX, currentY);
    if (!(distance <= MAX_LISTEN_DISTANCE)) continue;

    const bearing = getBearingToNode(currentX, currentY, n);
    const angleDiff = getAngleDifference(heading, bearing);
    if (angleDiff > DIRECTION_CONE_DEGREES) continue;

    candidates.push({ node: n, distance, bearing, angleDiff });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  console.log("[listen] Candidate nodes:", candidates.length);

  return candidates[0] || null;
}

function updateListenModeThrottled() {
  // Direction mode doesn't update every step; selection happens periodically
  // and on audio-ended events.
  updateListenMode(xMeters, yMeters, headingDeg);
}

function updateListenMode(currentX, currentY, heading) {
  if (!listenModeEnabled) {
    setListenWarn("");
    listenNearest = { nodeId: null, distance: Infinity };
    nearestNodeText.textContent = "—";
    distanceText.textContent = "—";
    playbackText.textContent = "No nearby sound";
    scheduleRouteRedraw();
    return;
  }

  const sourceRoute = getRouteById(listeningSourceRouteId);
  if (!sourceRoute) {
    setListenWarn("Select a listening route first.");
    stopListeningPlayback("no source route");
    listenNearest = { nodeId: null, distance: Infinity };
    setListenToggleUI();
    scheduleRouteRedraw();
    return;
  }
  if (!sourceRoute.nodes || sourceRoute.nodes.length === 0) {
    setListenWarn("Selected route has no nodes.");
    stopListeningPlayback("source has no nodes");
    listenNearest = { nodeId: null, distance: Infinity };
    setListenToggleUI();
    scheduleRouteRedraw();
    return;
  }

  setListenWarn("");
  setListenToggleUI();

  // Listen Mode is intended for a new walk: only autoplay while recording.
  if (!isRecording) {
    playbackText.textContent = "Listen Mode enabled";
    // Do not autoplay when not recording.
    stopListeningPlayback("not recording");
    scheduleRouteRedraw();
    return;
  }

  // Heading is required to decide what's "in front".
  if (!Number.isFinite(heading)) {
    playbackText.textContent = "Waiting for heading…";
    nearestNodeText.textContent = "—";
    distanceText.textContent = "—";
    listenNearest = { nodeId: null, distance: Infinity };
    scheduleRouteRedraw();
    console.log("[listen] Waiting for heading…");
    return;
  }

  console.log("[listen] Heading:", heading.toFixed(0));

  // If audio is currently playing, do NOT interrupt.
  if (currentAudio && !currentAudio.paused && currentlyPlayingNodeId != null) {
    console.log("[listen] Audio playing, not interrupting");
    playbackText.textContent = `Playing Node ${currentlyPlayingNodeId}`;
    scheduleRouteRedraw();
    return;
  }

  // When not playing, only update selection periodically.
  const now = performance.now();
  if (now - lastDirectionUpdateMs < DIRECTION_UPDATE_INTERVAL_MS) {
    // Keep UI showing last candidate.
    playbackText.textContent = "Listen Mode enabled";
    scheduleRouteRedraw();
    return;
  }
  lastDirectionUpdateMs = now;

  const best = findDirectionalNearestNode(currentX, currentY, heading, sourceRoute);
  if (!best) {
    nearestNodeText.textContent = "—";
    distanceText.textContent = "—";
    playbackText.textContent = "No node in front";
    listenNearest = { nodeId: null, distance: Infinity };
    console.log("[listen] No node in front");
    scheduleRouteRedraw();
    return;
  }

  const { node, distance, bearing, angleDiff } = best;
  listenNearest = { nodeId: node.id, distance };
  nearestNodeText.textContent = `Node ${node.id}`;
  distanceText.textContent = `${distance.toFixed(1)}m / ${angleDiff.toFixed(0)}°`;
  console.log("[listen] Selected directional node:", `Node ${node.id}`, "distance", distance.toFixed(2), "angleDiff", angleDiff.toFixed(1), "bearing", bearing.toFixed(0));

  // Play it (no interruption logic; this only runs when we're not already playing).
  currentlyPlayingNodeId = node.id;
  playbackText.textContent = `Playing Node ${node.id}`;
  currentRouteDirectionDeg = getRouteDirectionForNode(sourceRoute, node);
  if (Number.isFinite(currentRouteDirectionDeg)) {
    console.log("[listen] Route direction:", currentRouteDirectionDeg.toFixed(0));
  }
  try {
    if (!currentAudio) currentAudio = listenAudio;
    currentAudio.src = node.audioUrl;
    currentAudio.currentTime = 0;
    currentAudio.volume = 1;
    const p = currentAudio.play();
    if (p && typeof p.catch === "function") p.catch((e) => console.log("[listen] play() failed", e));
  } catch (e) {
    console.log("[listen] play error", e);
  }
  startVolumeTracking();
  scheduleRouteRedraw();
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
  // Defensive: ensure we never accumulate duplicated listeners across sessions.
  if (onMotion || onOrientation) {
    console.log("[sensors] Removing existing listeners before adding new ones");
    stopSensorTracking();
  }

  console.log("[sensors] Adding motion + orientation listeners");

  // Motion: detect steps from acceleration magnitude changes.
  onMotion = (ev) => {
    if (!isRecording) return;

    const a = ev.accelerationIncludingGravity || ev.acceleration;
    if (!a) return;

    // Debug: motion event received (throttled).
    const nowLog = performance.now();
    if (nowLog - lastMotionLogMs > 800) {
      lastMotionLogMs = nowLog;
      console.log("[motion] event", { x: a.x, y: a.y, z: a.z, calibrating: isCalibrating });
    }

    // Magnitude of acceleration vector (m/s^2).
    const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);

    // Exponential smoothing to reduce noise.
    if (smoothedMag === 0) smoothedMag = mag;
    smoothedMag = SMOOTHING_ALPHA * smoothedMag + (1 - SMOOTHING_ALPHA) * mag;

    // Use delta from smoothed baseline as a simple "high-pass" proxy.
    const delta = mag - smoothedMag;
    const now = performance.now();

    // During calibration we build a stable smoothing baseline but do NOT count steps.
    if (isCalibrating) {
      lastMagDelta = delta;
      return;
    }

    // Peak-ish detection: look for rising crossing above threshold.
    const risingCross = lastMagDelta <= PEAK_THRESHOLD && delta > PEAK_THRESHOLD;
    const cooledDown = now - lastStepMs > STEP_COOLDOWN_MS;

    if (risingCross && cooledDown) {
      lastStepMs = now;
      stepCount += 1;
      updatePositionForStep();
      updateMetricsUI();
      console.log("[step] detected", {
        stepCount,
        headingDeg: Number.isFinite(headingDeg) ? headingDeg.toFixed(0) : "NaN",
        xMeters: xMeters.toFixed(2),
        yMeters: yMeters.toFixed(2),
        delta: delta.toFixed(2),
      });
    }

    lastMagDelta = delta;
  };

  // Orientation: estimate compass heading.
  // iOS Safari provides `webkitCompassHeading` (0..360, where 0 is North).
  // If not available, fall back to `alpha` (device orientation), which may not be true compass.
  onOrientation = (ev) => {
    if (!isRecording) return;
    let h = NaN;

    // Debug: orientation event received (throttled).
    const nowLog = performance.now();
    if (nowLog - lastOrientationLogMs > 900) {
      lastOrientationLogMs = nowLog;
      console.log("[orientation] event", {
        webkitCompassHeading: typeof ev.webkitCompassHeading === "number" ? ev.webkitCompassHeading : null,
        alpha: typeof ev.alpha === "number" ? ev.alpha : null,
        calibrating: isCalibrating,
      });
    }

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
      // Debug: current heading (occasionally).
      if (nowLog - lastOrientationLogMs > 1500) {
        console.log("[orientation] headingDeg", headingDeg.toFixed(0));
      }
    }
  };

  window.addEventListener("devicemotion", onMotion, { passive: true });
  window.addEventListener("deviceorientation", onOrientation, { passive: true });
}

function stopSensorTracking() {
  if (onMotion) {
    window.removeEventListener("devicemotion", onMotion);
    console.log("[sensors] Removed devicemotion listener");
  }
  if (onOrientation) {
    window.removeEventListener("deviceorientation", onOrientation);
    console.log("[sensors] Removed deviceorientation listener");
  }
  onMotion = null;
  onOrientation = null;
}

function resetSessionState() {
  // Movement + step detection MUST reset fully on every new walk.
  stepCount = 0;
  headingDeg = NaN;
  xMeters = 0;
  yMeters = 0;

  lastStepMs = 0;
  smoothedMag = 0;
  lastMagDelta = 0;
  lastMotionLogMs = 0;
  lastOrientationLogMs = 0;
  isCalibrating = false;
  listenNearest = { nodeId: null, distance: Infinity };
  lastDirectionUpdateMs = 0;

  updateMetricsUI();
  renderNodesList();
  drawRoutePreview();
}

function setButtonsForRecording(recording) {
  const draft = currentRecordingRoute != null;
  startBtn.disabled = recording || draft;
  endBtn.disabled = !recording && !draft;
  updateDeleteRouteButton();
}

function formatPermStatus(parts) {
  return parts.filter(Boolean).join(" · ");
}

async function startRecordingSession() {
  if (isRecording) {
    console.warn("[rec] start ignored; already recording");
    return;
  }

  if (!currentRecordingRoute) {
    // Start is routed through "Start New Walk" and should always set a route,
    // but guard anyway to prevent mixing nodes.
    throw new Error("No current route. Tap “Start New Walk” to create a route first.");
  }

  setError("");
  setStatus("Requesting permissions…");
  permText.textContent = "Requesting microphone + motion + orientation permissions…";
  setButtonsForRecording(true);

  try {
    const token = (recordingSessionToken += 1);

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
    isCalibrating = true;
    startSensorTracking();

    // 4) Calibration phase (2–3 seconds) to stabilize heading + motion smoothing baseline.
    setStatus("Calibrating sensors…");
    console.log("[sensors] Calibrating sensors…");
    await sleep(2500);
    if (!isRecording || token !== recordingSessionToken) {
      debugLog("[rec] post-calibration bail — cleaning up", {
        isRecording,
        token,
        recordingSessionToken,
      });
      // Avoid leaving isRecording/mic/sensors stuck without a chunk loop (e.g. superseded session token).
      await stopRecordingSession({ keepNodes: true, silent: true });
      return;
    }
    isCalibrating = false;

    // 5) Start MediaRecorder loop producing *independent* 8-second files.
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

    // Node ids are incremental within a route.
    let nodeId = currentRecordingRoute.nodes.length + 1;

    const recordOneChunk = () =>
      new Promise((resolve, reject) => {
        let settled = false;
        let chunkTimer = null;
        let hardTimer = null;

        const cleanupTimers = () => {
          if (chunkTimer != null) {
            clearTimeout(chunkTimer);
            chunkTimer = null;
            activeChunkStopTimer = null;
          }
          if (hardTimer != null) {
            clearTimeout(hardTimer);
            hardTimer = null;
          }
        };

        const finish = (payload) => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          resolve(payload);
        };

        const fail = (err) => {
          if (settled) return;
          settled = true;
          cleanupTimers();
          reject(err instanceof Error ? err : new Error(String(err)));
        };

        const chunkStart = Date.now();
        const chunks = [];

        let rec;
        try {
          rec = new MediaRecorder(mediaStream, options);
        } catch (e) {
          debugLog("[audio] MediaRecorder constructor failed", e?.message || e);
          fail(e);
          return;
        }

        mediaRecorder = rec;
        lastChunkStartMs = chunkStart;

        rec.addEventListener("dataavailable", (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        });
        rec.addEventListener("error", (e) => {
          const err = e.error || e;
          debugLog("[audio] MediaRecorder error event", err?.name, err?.message || err);
          fail(err);
        });
        rec.addEventListener("start", () => {
          debugLog("[audio] chunk started", { mime: rec.mimeType, state: rec.state });
        });
        rec.addEventListener("stop", () => {
          const totalBytes = chunks.reduce((s, b) => s + b.size, 0);
          debugLog("[audio] chunk stopped", { parts: chunks.length, totalBytes });
          const blob = new Blob(chunks, { type: chunks[0]?.type || rec.mimeType || "" });
          const durationSeconds = Math.max(0.1, (Date.now() - chunkStart) / 1000);
          finish({ blob, durationSeconds, timestamp: Date.now() });
        });

        try {
          rec.start();
        } catch (e) {
          debugLog("[audio] rec.start() failed", e?.message || e);
          fail(e);
          return;
        }

        hardTimer = window.setTimeout(() => {
          hardTimer = null;
          if (settled) return;
          debugLog("[audio] chunk HARD timeout (no stop event)", { ms: CHUNK_HARD_TIMEOUT_MS });
          fail(new Error("Audio chunk stalled: MediaRecorder did not finish"));
        }, CHUNK_HARD_TIMEOUT_MS);

        chunkTimer = window.setTimeout(() => {
          chunkTimer = null;
          activeChunkStopTimer = null;
          try {
            if (rec.state !== "inactive") {
              debugLog("[audio] chunk timer fired → stop()", { state: rec.state });
              rec.stop();
            } else {
              debugLog("[audio] chunk timer fired but recorder already inactive");
            }
          } catch (e) {
            debugLog("[audio] rec.stop() threw", e?.message || e);
            fail(e);
          }
        }, CHUNK_MS);
        activeChunkStopTimer = chunkTimer;
      });

    const recordingLoop = async () => {
      let consecutiveFailures = 0;
      try {
        while (isRecording) {
          try {
            const { blob, durationSeconds, timestamp } = await recordOneChunk();
            consecutiveFailures = 0;

            if (!blob || blob.size === 0) {
              debugLog("[audio] empty chunk ignored");
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

            currentRecordingRoute.nodes.push(node);
            debugLog("[route] Node added", currentRecordingRoute.name, {
              id: node.id,
              bytes: blob.size,
              type: blob.type || "unknown",
              x: node.x,
              y: node.y,
            });

            updateMetricsUI();
            renderNodesList();
            drawRoutePreview();
          } catch (err) {
            consecutiveFailures += 1;
            debugLog("[rec] recordOneChunk failed", err?.message || err, {
              consecutiveFailures,
              max: CHUNK_MAX_CONSECUTIVE_FAILURES,
            });
            if (!isRecording) break;
            if (consecutiveFailures >= CHUNK_MAX_CONSECUTIVE_FAILURES) {
              setError(
                "Audio capture failed repeatedly. Tap End Walk to save the nodes you already have, then start a new walk.",
              );
              setStatus("Recording error (audio)");
              debugLog("[rec] too many chunk failures — stopping sensors & mic");
              isRecording = false;
              setTimeout(() => {
                stopRecordingSession({ keepNodes: true, silent: true }).catch((e) =>
                  debugLog("[rec] stopRecordingSession after errors", e?.message || e),
                );
              }, 0);
              break;
            }
            await sleep(CHUNK_RETRY_BACKOFF_MS);
          }
        }
      } finally {
        debugLog("[rec] recording loop ended", { isRecording });
      }
    };

    recordingLoopPromise = recordingLoop();

    setStatus("Recording…");
    permText.textContent = formatPermStatus(["Microphone OK", "Motion listening", "Orientation listening"]);
    updateMetricsUI();

    // Important: audio playback must be user-initiated on iOS. We only render controls;
    // user tapping play is a gesture, so that's OK.
    debugLog("[rec] session started", { chunkMs: CHUNK_MS, route: currentRecordingRoute?.name });
  } catch (err) {
    debugLog("[rec] start failed:", err?.message || err);
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
  isCalibrating = false;
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

  updateMetricsUI();
  renderNodesList();
  drawRoutePreview();
}

function startNewWalk() {
  if (isRecording) return;

  // Close the race where two taps queue two sessions before setButtonsForRecording(true) runs.
  startBtn.disabled = true;
  endBtn.disabled = true;

  routeCounter += 1;
  const route = {
    id: makeId(),
    name: `Route ${routeCounter}`,
    createdAt: Date.now(),
    nodes: [],
  };

  currentRecordingRoute = route;
  selectedRoute = null; // recording mode shows the current route
  console.log("[route] Route started", route.name);

  renderRoutesPanel();
  updateMetricsUI();
  renderNodesList();
  drawRoutePreview();
  updateDeleteRouteButton();

  startRecordingSession();
}

async function endWalk() {
  if (!currentRecordingRoute) return;

  if (isRecording) {
    await stopRecordingSession({ keepNodes: true, silent: false });
  }

  routes.unshift(currentRecordingRoute);
  selectedRoute = currentRecordingRoute;
  debugLog("[route] Route saved", currentRecordingRoute.name, {
    nodes: currentRecordingRoute.nodes.length,
  });
  currentRecordingRoute = null;

  renderRoutesPanel();
  renderListenRouteOptions();
  updateMetricsUI();
  renderNodesList();
  drawRoutePreview();
  updateDeleteRouteButton();
  setButtonsForRecording(false);

  // Stop any listening playback when walk ends (keeps things predictable).
  stopListeningPlayback("walk ended");
}

function deleteSelectedRoute() {
  if (isRecording) return;
  if (!selectedRoute) return;

  // Revoke object URLs to avoid leaking memory.
  for (const n of selectedRoute.nodes) {
    try {
      if (n.audioUrl) URL.revokeObjectURL(n.audioUrl);
    } catch {
      // ignore
    }
  }

  routes = routes.filter((r) => r.id !== selectedRoute.id);
  console.log("[route] deleted", selectedRoute.name);
  selectedRoute = routes[0] || null;

  renderRoutesPanel();
  renderListenRouteOptions();
  updateMetricsUI();
  renderNodesList();
  drawRoutePreview();
  updateDeleteRouteButton();

  // If the listening source was deleted, disable listening.
  if (listeningSourceRouteId && !getRouteById(listeningSourceRouteId)) {
    listeningSourceRouteId = "";
    listenModeEnabled = false;
    stopListeningPlayback("source deleted");
    setListenToggleUI();
    renderListenRouteOptions();
  }
}

// Buttons (must be user gesture)
startBtn.addEventListener("click", () => {
  console.log("[ui] Start New Walk tapped");
  startNewWalk();
});

endBtn.addEventListener("click", () => {
  console.log("[ui] End Walk tapped");
  endWalk();
});

deleteRouteBtn.addEventListener("click", () => {
  deleteSelectedRoute();
});

listenRouteSelect.addEventListener("change", () => {
  listeningSourceRouteId = listenRouteSelect.value;
  const r = getRouteById(listeningSourceRouteId);
  console.log("[listen] Listening source route selected:", r?.name || "none");
  setListenToggleUI();
  updateListenMode();
});

listenToggleBtn.addEventListener("click", async () => {
  // User gesture: good place to unlock audio.
  if (!listenModeEnabled) {
    listenModeEnabled = true;
    console.log("[listen] Listen Mode enabled");
    await unlockAudioPlayback();
  } else {
    listenModeEnabled = false;
    console.log("[listen] Listen Mode disabled");
    stopListeningPlayback("disabled");
  }
  setListenToggleUI();
  lastDirectionUpdateMs = 0;
  updateListenMode(xMeters, yMeters, headingDeg);
});

// Initial UI
setButtonsForRecording(false);
setStatus("Not recording");
updateMetricsUI();
drawRoutePreview();
renderRoutesPanel();
updateDeleteRouteButton();
renderListenRouteOptions();
setListenToggleUI();
updateListenMode();

debugLog("[init] SoundRoute prototype loaded");

