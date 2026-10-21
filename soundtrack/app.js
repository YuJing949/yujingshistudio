// SoundRoute prototype.
// Records one continuous audio file per walk (max 5 minutes) and a track point
// ("node") every 2 seconds: position from steps + compass, anchored and
// corrected by GPS (location.js), plus the second of audio it matches.
// Walks are kept on the device first, then uploaded to Supabase (cloud.js).

import { LocationFusion } from "./location.js";
import { savePendingWalk, listPendingWalks, deletePendingWalk } from "./localstore.js";

/* eslint-disable no-console */

const STEP_LENGTH_METERS = 0.7;

// Recording: one continuous audio file per walk + a track point every 2 s.
const MAX_WALK_SECONDS = 5 * 60;
const POINT_INTERVAL_MS = 2000;
const AUDIO_BITS_PER_SECOND = 32000;
// If Safari never fires `stop` after `rec.stop()`, don't wait forever.
const RECORDER_STOP_TIMEOUT_MS = 6000;

// Simple step detection tuning knobs.
// These are intentionally conservative; step detection on phones varies a lot.
const STEP_COOLDOWN_MS = 380; // avoid double-counting
const PEAK_THRESHOLD = 1.15; // magnitude delta threshold after filtering (approx)
const SMOOTHING_ALPHA = 0.85; // exponential smoothing for magnitude
const FLAT_PHONE_TILT_DEGREES = 35;
const HEADING_SENSOR_WARNING_MS = 5000;

// Listen Mode tuning
const DIRECTION_CONE_DEGREES = 45;
const DIRECTION_UPDATE_INTERVAL_MS = 2000;
const MAX_LISTEN_DISTANCE = 20;
// Until phase 4: play this many seconds from the matching moment, then re-check.
const LISTEN_SEGMENT_SECONDS = 8;
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
const downloadAllAudioBtn = document.getElementById("downloadAllAudioBtn");
const downloadRoutesList = document.getElementById("downloadRoutesList");
const downloadsEmpty = document.getElementById("downloadsEmpty");
const downloadStatus = document.getElementById("downloadStatus");

const gpsText = document.getElementById("gpsText");
const latLngText = document.getElementById("latLngText");

// Position: GPS anchored, smoothed by steps + compass. Keeps one local frame
// (metres, x = east, y = north) for the whole page session.
const fusion = new LocationFusion();

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
let trackPointTimer = null;
let recordingClockTimer = null;
let walkLimitTimer = null;
let endingWalk = false;
let listenSegmentTimer = null;

// Listen Mode state
let listenModeEnabled = false;
let currentlyPlayingRouteId = null;
let currentlyPlayingNodeId = null;
let listenNearest = { routeId: null, nodeId: null, distance: Infinity };
let lastDirectionUpdateMs = 0;
let currentAudio = null;
let currentRouteDirectionDeg = NaN;
let volumeUpdateTimer = null;
let lastVolumeLogMs = 0;

const listenAudio = new Audio();
listenAudio.preload = "none";
currentAudio = listenAudio;
listenAudio.addEventListener("ended", () => finishListenSegment("audio ended"));

// A stretch of someone's walk finished playing: pick what to play next.
function finishListenSegment(reason) {
  console.log(`[listen] ${reason}, recalculating`);
  clearTimeout(listenSegmentTimer);
  listenSegmentTimer = null;
  try {
    listenAudio.pause();
  } catch {
    // ignore
  }
  if (volumeUpdateTimer) {
    clearInterval(volumeUpdateTimer);
    volumeUpdateTimer = null;
  }
  currentRouteDirectionDeg = NaN;
  currentAudio = null;
  currentlyPlayingRouteId = null;
  currentlyPlayingNodeId = null;
  // Immediately re-evaluate based on current heading + position.
  lastDirectionUpdateMs = 0;
  updateListenMode(xMeters, yMeters, headingDeg);
}

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

// Orientation diagnostics for older iOS/Safari devices.
let orientationEventCount = 0;
let headingSampleCount = 0;
let headingWarningTimer = null;
let headingWarningMessage = "";

// Event handler references (so we can remove them cleanly)
let onMotion = null;
let onOrientation = null;
let onCompassCalibration = null;
let lastGpsLogMs = 0;

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
  updateLocationUI();
  if (Number.isFinite(headingDeg)) {
    headingVal.textContent = `${headingDeg.toFixed(0)}°`;
  } else if (isRecording) {
    headingVal.textContent = "Waiting for heading…";
  } else {
    headingVal.textContent = "—";
  }
}

function updateLocationUI() {
  const fix = fusion.lastFix;
  if (!fix) {
    gpsText.textContent = fusion.watchId != null ? "Waiting for GPS…" : "—";
  } else {
    gpsText.textContent = `±${Math.round(fix.accuracy)} m${fix.used ? "" : " (too weak, ignored)"}`;
  }
  const ll = fusion.toLatLng(xMeters, yMeters);
  latLngText.textContent = ll
    ? `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)} · ±${Math.round(fusion.uncertaintyM)} m`
    : "Not anchored yet";
}

// Give every node a latitude/longitude once the frame is anchored to GPS.
// Nodes recorded before the first fix get theirs as soon as it arrives.
function fillNodeLatLng() {
  if (!fusion.hasOrigin) return;
  const all = [...routes, currentRecordingRoute].filter(Boolean);
  for (const r of all) {
    for (const n of r.nodes) {
      if (Number.isFinite(n.lat)) continue;
      const ll = fusion.toLatLng(n.x, n.y);
      n.lat = ll.lat;
      n.lng = ll.lng;
    }
  }
}

function syncPositionFromFusion() {
  xMeters = fusion.x;
  yMeters = fusion.y;
}

// Walks loaded from the cloud only have latitude/longitude. Give their points
// x/y in this session's frame (or, before GPS anchors it, in a display-only
// frame) so drawing and listening can use them like walks recorded here.
let displayFrame = null;
function projectWalks() {
  for (const r of routes) {
    for (const n of r.nodes) {
      if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) continue;
      let p = fusion.hasOrigin ? fusion.toLocal(n.lat, n.lng) : null;
      if (!p) {
        if (!displayFrame) {
          displayFrame = new LocationFusion();
          displayFrame.origin = { lat: n.lat, lng: n.lng };
        }
        p = displayFrame.toLocal(n.lat, n.lng);
      }
      n.x = p.x;
      n.y = p.y;
    }
  }
}

function recordTrackPoint(walk) {
  if (!walk?.recordStartMs) return;
  const now = Date.now();
  const ll = fusion.toLatLng(xMeters, yMeters);
  walk.nodes.push({
    id: walk.nodes.length + 1,
    t: Math.min(MAX_WALK_SECONDS, (now - walk.recordStartMs) / 1000),
    timestamp: now,
    stepCount,
    heading: headingDeg,
    x: xMeters,
    y: yMeters,
    lat: ll ? ll.lat : null,
    lng: ll ? ll.lng : null,
    uncertaintyM: fusion.hasOrigin ? fusion.uncertaintyM : null,
  });
  updateMetricsUI();
  scheduleRouteRedraw();
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function updateRecordingClock() {
  const walk = currentRecordingRoute;
  if (!isRecording || !walk?.recordStartMs) return;
  const elapsed = (Date.now() - walk.recordStartMs) / 1000;
  const left = MAX_WALK_SECONDS - elapsed;
  setStatus(`Recording ${formatClock(elapsed)} / ${formatClock(MAX_WALK_SECONDS)}${left <= 30 ? " · ending soon" : ""}`);
}

function radians(deg) {
  return (deg * Math.PI) / 180;
}

function normalizeHeading(deg) {
  // Normalize into [0, 360)
  const n = ((deg % 360) + 360) % 360;
  return n;
}

function getFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}

function isPhoneFlatScreenUp(beta, gamma) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return false;
  return Math.abs(beta) <= FLAT_PHONE_TILT_DEGREES && Math.abs(gamma) <= FLAT_PHONE_TILT_DEGREES;
}

function getCompassHeadingFromAlpha(alpha) {
  if (!Number.isFinite(alpha)) return NaN;
  // Browsers report alpha counter-clockwise from north; app heading is clockwise.
  return normalizeHeading(360 - alpha);
}

function getHeadingFromOrientationEvent(ev) {
  const webkitHeading = getFiniteNumber(ev.webkitCompassHeading);
  const alpha = getFiniteNumber(ev.alpha);
  const beta = getFiniteNumber(ev.beta);
  const gamma = getFiniteNumber(ev.gamma);

  // iOS can keep webkitCompassHeading at 0 when the phone is lying screen-up.
  // In that posture, alpha is the yaw around the vertical axis, which gives the
  // heading of the phone's top edge for flat walking use.
  if (isPhoneFlatScreenUp(beta, gamma)) {
    const alphaHeading = getCompassHeadingFromAlpha(alpha);
    if (Number.isFinite(alphaHeading)) return alphaHeading;
  }

  if (Number.isFinite(webkitHeading)) return normalizeHeading(webkitHeading);
  return getCompassHeadingFromAlpha(alpha);
}

function getHeadingSensorHelpMessage() {
  if (orientationEventCount === 0) {
    return [
      "No compass/orientation events yet.",
      "On older iPhones (for example iPhone 6 / iOS 12), open Settings > Safari > Motion & Orientation Access, turn it on, then reload this page.",
      "If it is already on, open the Compass app or move the phone in a figure-8 to calibrate, then start a new walk.",
    ].join(" ");
  }

  return [
    "Orientation events are arriving, but no usable heading value was found.",
    "On older iPhones, enable Settings > Safari > Motion & Orientation Access, calibrate Compass, then reload this page.",
  ].join(" ");
}

function clearHeadingSensorWarning({ clearUi = true } = {}) {
  if (headingWarningTimer) {
    clearTimeout(headingWarningTimer);
    headingWarningTimer = null;
  }
  if (clearUi && headingWarningMessage && errorBox.textContent === headingWarningMessage) {
    setError("");
  }
  headingWarningMessage = "";
}

function showHeadingSensorWarning(message) {
  headingWarningMessage = message;
  setError(message);
}

function scheduleHeadingSensorWarning() {
  clearHeadingSensorWarning({ clearUi: false });
  headingWarningTimer = window.setTimeout(() => {
    headingWarningTimer = null;
    if (!isRecording || Number.isFinite(headingDeg)) return;

    const message = getHeadingSensorHelpMessage();
    showHeadingSensorWarning(message);
    debugLog("[orientation] heading unavailable", {
      orientationEventCount,
      headingSampleCount,
      userAgent: navigator.userAgent,
    });
  }, HEADING_SENSOR_WARNING_MS);
}

function updatePositionForStep() {
  // Only update position if we have a valid heading.
  if (!Number.isFinite(headingDeg)) return;
  // x += stepLength * sin(heading), y += stepLength * cos(heading),
  // done inside the fusion so GPS can correct the drift.
  fusion.onStep(STEP_LENGTH_METERS, headingDeg);
  syncPositionFromFusion();
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
  // Start marker: the walk's first point (or where you are, before the first point).
  if (ptsPrimary.length) ptsPrimary[0] = { ...ptsPrimary[0], id: 0, kind: "origin" };
  else ptsPrimary.push({ x: xMeters, y: yMeters, id: 0, kind: "origin" });
  // Include the current live position while recording so the route updates even between nodes.
  if (isRecording) ptsPrimary.push({ x: xMeters, y: yMeters, id: -1, kind: "live" });

  // All saved historical routes (faint) while recording + Listen Mode — not currentRecordingRoute.
  const drawHistoricalListen = isRecording && listenModeEnabled && routes.length > 0;
  const ptsHistorical = [];
  if (drawHistoricalListen) {
    for (const r of routes) {
      for (const n of r.nodes) {
        ptsHistorical.push({ x: n.x, y: n.y, id: n.id, kind: "secondary" });
      }
    }
  }

  // Combine for bounds fitting.
  const ptsAll = ptsPrimary.concat(ptsHistorical);

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

  // Historical routes (each polyline from origin) under the live walk.
  if (drawHistoricalListen) {
    for (const r of routes) {
      if (!r.nodes.length) continue;
      const ptsH = r.nodes.map((n) => ({ x: n.x, y: n.y, id: n.id, kind: "secondary" }));
      strokePath(ptsH, { strokeStyle: "rgba(255,255,255,0.2)", lineWidth: 2 });
    }
  }

  // Draw primary (current route) on top.
  strokePath(ptsPrimary, { strokeStyle: "rgba(10,132,255,0.95)", lineWidth: 3 });

  // Markers: start (green) and, while recording, where you are (orange).
  // Track points every 2 s are too dense to mark individually.
  const ptsPrimaryMarkers = ptsPrimary.filter((p) => p.id === 0 || p.id === -1);
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
  if (isRecording && listenModeEnabled && listenNearest.routeId != null && listenNearest.nodeId != null) {
    const hr = getRouteById(listenNearest.routeId);
    const n = hr?.nodes.find((x) => x.id === listenNearest.nodeId);
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

// "Walk" panel: the walk being recorded, or the selected one.
function renderNodesList() {
  nodesList.innerHTML = "";
  const walk = getViewingRoute();
  nodesEmpty.hidden = Boolean(walk);
  if (!walk) return;

  const li = document.createElement("li");
  li.className = "node";

  const top = document.createElement("div");
  top.className = "node-top";
  const title = document.createElement("div");
  title.className = "node-title";
  title.textContent = walk.name;
  const meta = document.createElement("div");
  meta.className = "node-meta";
  meta.textContent = new Date(walk.createdAt).toLocaleString();
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
  const recording = walk === currentRecordingRoute;
  const located = walk.nodes.filter((n) => Number.isFinite(n.lat)).length;
  grid.appendChild(kv("Length", recording ? "Recording…" : formatClock(walk.durationS || 0)));
  grid.appendChild(kv("Track points", `${walk.nodes.length} (${located} with GPS)`));
  grid.appendChild(kv("Cloud", recording ? "—" : cloudStatusLabel(walk)));
  grid.appendChild(kv("Share code", walk.shareCode || "—"));
  li.appendChild(top);
  li.appendChild(grid);

  if (walk.cloudError && walk.cloud !== "saved") {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = walk.cloudError;
    li.appendChild(note);
  }

  if (!recording && walk.audioUrl) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = walk.audioUrl;
    li.appendChild(audio);
  }

  if (!recording && (walk.cloud === "failed" || walk.cloud === "pending")) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn-ghost";
    retry.textContent = "Upload now";
    retry.addEventListener("click", () => uploadWalkNow(walk));
    li.appendChild(retry);
  }

  nodesList.appendChild(li);
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
    sub.textContent = `${formatClock(route.durationS || 0)} · ${cloudStatusLabel(route)} · ${new Date(route.createdAt).toLocaleDateString()}`;

    btn.appendChild(title);
    btn.appendChild(sub);
    li.appendChild(btn);
    routesList.appendChild(li);
  }
}


function sanitizeFilenamePart(value) {
  return String(value || "route")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase() || "route";
}

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function getWalkAudioExtension(walk) {
  const type = walk.audioMime || walk.audioBlob?.type || "";
  if (type.includes("mp4") || type.includes("aac")) return "m4a";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("webm")) return "webm";
  return "m4a";
}

function getWalksWithAudio() {
  return routes.filter((r) => r.audioUrl);
}

function drawRouteDownloadImage(route, canvasSize = 900) {
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  const gridStep = 75;
  for (let gx = 0; gx <= w; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  for (let gy = 0; gy <= h; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = "#f3f3f6";
  ctx.font = "bold 34px system-ui, -apple-system, sans-serif";
  ctx.fillText(route.name, 42, 58);
  ctx.fillStyle = "#b8b8c3";
  ctx.font = "22px system-ui, -apple-system, sans-serif";
  ctx.fillText(`${formatClock(route.durationS || 0)} · ${new Date(route.createdAt).toLocaleString()}`, 42, 92);

  const pts = route.nodes.map((n, i) => ({ x: n.x, y: n.y, id: i === 0 ? 0 : n.id, kind: i === 0 ? "origin" : "node" }));
  if (pts.length === 0) pts.push({ x: 0, y: 0, id: 0, kind: "origin" });

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const pt of pts) {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minY = Math.min(minY, pt.y);
    maxY = Math.max(maxY, pt.y);
  }
  if (maxX - minX < 1) {
    const midX = (minX + maxX) / 2;
    minX = midX - 0.5;
    maxX = midX + 0.5;
  }
  if (maxY - minY < 1) {
    const midY = (minY + maxY) / 2;
    minY = midY - 0.5;
    maxY = midY + 0.5;
  }
  const pad = 84;
  const topPad = 130;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const scale = Math.min((w - pad * 2) / spanX, (h - topPad - pad) / spanY);

  function toCanvas(pt) {
    const cx = pad + (pt.x - minX) * scale;
    const cy = h - pad - (pt.y - minY) * scale;
    return { cx, cy };
  }


  if (pts.length > 1) {
    ctx.save();
    ctx.strokeStyle = "rgba(10,132,255,0.95)";
    ctx.lineWidth = 7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach((pt, idx) => {
      const { cx, cy } = toCanvas(pt);
      if (idx === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    ctx.restore();
  }

  const markers = pts.filter((pt) => pt.id === 0);
  for (const pt of markers) {
    const { cx, cy } = toCanvas(pt);
    const isOrigin = pt.id === 0;
    ctx.fillStyle = isOrigin ? "rgba(52,199,89,0.95)" : "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(cx, cy, isOrigin ? 12 : 9, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

async function downloadRouteImage(route) {
  const canvas = drawRouteDownloadImage(route);
  const filename = `${sanitizeFilenamePart(route.name)}-estimated-route.png`;
  const dataUrl = canvas.toDataURL("image/png");
  triggerDownload(dataUrl, filename);
  downloadStatus.textContent = `Started download: ${filename}`;
  debugLog("[download] route image", route.name, filename);
}

async function downloadAllNodeAudio() {
  const walks = getWalksWithAudio();
  if (walks.length === 0) {
    downloadStatus.textContent = "No walk audio to download yet.";
    return;
  }
  downloadStatus.textContent = `Starting ${walks.length} audio downloads…`;
  for (const walk of walks) {
    triggerDownload(walk.audioUrl, `${sanitizeFilenamePart(walk.name)}.${getWalkAudioExtension(walk)}`);
    // Give mobile Safari a moment between automatic downloads.
    await sleep(250);
  }
  downloadStatus.textContent = `Started ${walks.length} audio downloads.`;
}

function renderDownloadsPanel() {
  downloadRoutesList.innerHTML = "";
  downloadsEmpty.hidden = routes.length !== 0;

  downloadAllAudioBtn.disabled = getWalksWithAudio().length === 0;

  for (const route of routes) {
    const li = document.createElement("li");
    li.className = "download-route";

    const top = document.createElement("div");
    top.className = "download-route-top";

    const copy = document.createElement("div");
    const title = document.createElement("div");
    title.className = "download-route-title";
    title.textContent = route.name;
    const sub = document.createElement("div");
    sub.className = "download-route-sub";
    sub.textContent = `${formatClock(route.durationS || 0)} · PNG route map`;
    copy.appendChild(title);
    copy.appendChild(sub);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost";
    btn.textContent = "Download PNG";
    btn.addEventListener("click", () => {
      downloadRouteImage(route);
    });

    top.appendChild(copy);
    top.appendChild(btn);
    li.appendChild(top);
    downloadRoutesList.appendChild(li);
  }
}

function updateDeleteRouteButton() {
  // Only allow deleting when not recording, and a route is selected.
  deleteRouteBtn.disabled = isRecording || !selectedRoute;
}

function getListenSourceRoutes() {
  return routes.filter(
    (r) => r.audioUrl && r.nodes?.some((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
  );
}

function renderListenRouteOptions() {
  const hasListenSources = getListenSourceRoutes().length > 0;
  listenToggleBtn.disabled = !hasListenSources;
}

function setListenToggleUI() {
  listenToggleBtn.textContent = listenModeEnabled ? "Disable Listen Mode" : "Enable Listen Mode";
  listenToText.textContent = listenModeEnabled ? "All previous routes" : "—";
}

function stopListeningPlayback(reason) {
  if (currentlyPlayingNodeId != null) {
    console.log(
      "[listen] Stopping playback",
      currentlyPlayingRouteId,
      currentlyPlayingNodeId,
      reason ? `(${reason})` : "",
    );
  }
  clearTimeout(listenSegmentTimer);
  listenSegmentTimer = null;
  try {
    currentAudio?.pause();
  } catch {
    // ignore
  }
  if (volumeUpdateTimer) {
    clearInterval(volumeUpdateTimer);
    volumeUpdateTimer = null;
  }
  currentRouteDirectionDeg = NaN;
  currentAudio = null;
  currentlyPlayingRouteId = null;
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
    const playingRoute = currentlyPlayingRouteId ? getRouteById(currentlyPlayingRouteId) : null;
    const playingLabel = playingRoute ? playingRoute.name : "a walk";
    playbackText.textContent = `${playingLabel} (Angle ${angleDiff.toFixed(0)}° / v=${v.toFixed(2)})`;

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

function findDirectionalNearestNodeAcrossRoutes(currentX, currentY, heading, sourceRoutes) {
  const candidates = [];
  for (const sourceRoute of sourceRoutes) {
    if (!sourceRoute?.nodes?.length) continue;
    for (const n of sourceRoute.nodes) {
      const distance = getDistanceToNode(n, currentX, currentY);
      if (!(distance <= MAX_LISTEN_DISTANCE)) continue;

      const bearing = getBearingToNode(currentX, currentY, n);
      const angleDiff = getAngleDifference(heading, bearing);
      if (angleDiff > DIRECTION_CONE_DEGREES) continue;

      candidates.push({ node: n, route: sourceRoute, distance, bearing, angleDiff });
    }
  }

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    const rid = String(a.route.id).localeCompare(String(b.route.id));
    if (rid !== 0) return rid;
    return a.node.id - b.node.id;
  });
  console.log("[listen] Candidate nodes (all routes):", candidates.length);

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
    listenNearest = { routeId: null, nodeId: null, distance: Infinity };
    nearestNodeText.textContent = "—";
    distanceText.textContent = "—";
    playbackText.textContent = "No nearby sound";
    scheduleRouteRedraw();
    return;
  }

  const sourceRoutes = getListenSourceRoutes();
  if (sourceRoutes.length === 0) {
    setListenWarn("Save at least one route with audio nodes to use Listen Mode.");
    stopListeningPlayback("no listen sources");
    listenNearest = { routeId: null, nodeId: null, distance: Infinity };
    setListenToggleUI();
    scheduleRouteRedraw();
    return;
  }

  setListenWarn("");
  setListenToggleUI();

  // Listen Mode is intended for a new walk: only autoplay while recording.
  if (!isRecording) {
    playbackText.textContent = "Listen Mode enabled";
    stopListeningPlayback("not recording");
    listenNearest = { routeId: null, nodeId: null, distance: Infinity };
    nearestNodeText.textContent = "—";
    distanceText.textContent = "—";
    scheduleRouteRedraw();
    return;
  }

  // Heading is required to decide what's "in front".
  if (!Number.isFinite(heading)) {
    playbackText.textContent = "Waiting for heading…";
    nearestNodeText.textContent = "—";
    distanceText.textContent = "—";
    listenNearest = { routeId: null, nodeId: null, distance: Infinity };
    scheduleRouteRedraw();
    console.log("[listen] Waiting for heading…");
    return;
  }

  console.log("[listen] Heading:", heading.toFixed(0));

  // If audio is currently playing, do NOT interrupt.
  if (currentAudio && !currentAudio.paused && currentlyPlayingNodeId != null && currentlyPlayingRouteId != null) {
    console.log("[listen] Audio playing, not interrupting");
    const playingRoute = getRouteById(currentlyPlayingRouteId);
    playbackText.textContent = playingRoute
      ? `Playing ${playingRoute.name} · Node ${currentlyPlayingNodeId}`
      : `Playing Node ${currentlyPlayingNodeId}`;
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

  const best = findDirectionalNearestNodeAcrossRoutes(currentX, currentY, heading, sourceRoutes);
  if (!best) {
    nearestNodeText.textContent = "—";
    distanceText.textContent = "—";
    playbackText.textContent = "No node in front";
    listenNearest = { routeId: null, nodeId: null, distance: Infinity };
    console.log("[listen] No node in front");
    scheduleRouteRedraw();
    return;
  }

  const { node, route: ownerRoute, distance, bearing, angleDiff } = best;
  listenNearest = { routeId: ownerRoute.id, nodeId: node.id, distance };
  nearestNodeText.textContent = `${ownerRoute.name} · Node ${node.id}`;
  distanceText.textContent = `${distance.toFixed(1)}m / ${angleDiff.toFixed(0)}°`;
  console.log(
    "[listen] Selected directional node:",
    ownerRoute.name,
    `Node ${node.id}`,
    "distance",
    distance.toFixed(2),
    "angleDiff",
    angleDiff.toFixed(1),
    "bearing",
    bearing.toFixed(0),
  );

  // Play it (no interruption logic; this only runs when we're not already playing).
  currentlyPlayingRouteId = ownerRoute.id;
  currentlyPlayingNodeId = node.id;
  playbackText.textContent = `Playing ${ownerRoute.name} · Node ${node.id}`;
  currentRouteDirectionDeg = getRouteDirectionForNode(ownerRoute, node);
  if (Number.isFinite(currentRouteDirectionDeg)) {
    console.log("[listen] Route direction:", currentRouteDirectionDeg.toFixed(0));
  }
  // Play the walk's recording from the second this point was recorded.
  playWalkFrom(ownerRoute, node.t);
  startVolumeTracking();
  scheduleRouteRedraw();
}

function playWalkFrom(walk, seconds) {
  if (!currentAudio) currentAudio = listenAudio;
  const audio = currentAudio;
  const start = Math.max(0, Number(seconds) || 0);
  try {
    if (audio.src !== walk.audioUrl) {
      audio.preload = "auto";
      audio.src = walk.audioUrl;
    }
    audio.volume = 1;
    const seekAndPlay = () => {
      try {
        audio.currentTime = start;
      } catch (e) {
        console.log("[listen] seek failed", e);
      }
      const p = audio.play();
      if (p && typeof p.catch === "function") p.catch((e) => console.log("[listen] play() failed", e));
    };
    if (audio.readyState >= 1) seekAndPlay();
    else audio.addEventListener("loadedmetadata", seekAndPlay, { once: true });
  } catch (e) {
    console.log("[listen] play error", e);
  }
  clearTimeout(listenSegmentTimer);
  listenSegmentTimer = setTimeout(() => finishListenSegment("segment finished"), LISTEN_SEGMENT_SECONDS * 1000);
  debugLog("[listen] playing", walk.name, "from", `${start.toFixed(1)}s`);
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
  orientationEventCount = 0;
  headingSampleCount = 0;
  scheduleHeadingSensorWarning();

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
  // iOS Safari provides `webkitCompassHeading` (0..360, where 0 is North), but
  // some devices report a stuck 0 when the phone lies screen-up. For that flat
  // posture, use alpha/yaw so the route still follows the phone's top edge.
  onOrientation = (ev) => {
    if (!isRecording) return;
    orientationEventCount += 1;

    // Debug: orientation event received (throttled).
    const nowLog = performance.now();
    if (nowLog - lastOrientationLogMs > 900) {
      lastOrientationLogMs = nowLog;
      console.log("[orientation] event", {
        type: ev.type,
        webkitCompassHeading: typeof ev.webkitCompassHeading === "number" ? ev.webkitCompassHeading : null,
        alpha: typeof ev.alpha === "number" ? ev.alpha : null,
        beta: typeof ev.beta === "number" ? ev.beta : null,
        gamma: typeof ev.gamma === "number" ? ev.gamma : null,
        absolute: ev.absolute === true,
        flatScreenUp: isPhoneFlatScreenUp(getFiniteNumber(ev.beta), getFiniteNumber(ev.gamma)),
        calibrating: isCalibrating,
      });
    }

    const h = getHeadingFromOrientationEvent(ev);
    if (Number.isFinite(h)) {
      headingSampleCount += 1;
      headingDeg = h;
      clearHeadingSensorWarning();
      updateMetricsUI();
      // Debug: current heading (occasionally).
      if (nowLog - lastOrientationLogMs > 1500) {
        console.log("[orientation] headingDeg", headingDeg.toFixed(0));
      }
    }
  };

  onCompassCalibration = (ev) => {
    try {
      ev.preventDefault();
    } catch {
      // ignore
    }
    const message = "Compass needs calibration. Move the phone in a figure-8, or open the Compass app, then start a new walk.";
    showHeadingSensorWarning(message);
    debugLog("[orientation] compass calibration requested");
  };

  window.addEventListener("devicemotion", onMotion, { passive: true });
  window.addEventListener("deviceorientation", onOrientation, { passive: true });
  window.addEventListener("deviceorientationabsolute", onOrientation, { passive: true });
  window.addEventListener("compassneedscalibration", onCompassCalibration);

  // GPS: anchors the walk to the real world so it can start anywhere.
  const hadOrigin = fusion.hasOrigin;
  fusion.startGps({
    onFix: (f, pos) => {
      const firstAnchor = !hadOrigin && f.hasOrigin && f.lastFix?.used;
      syncPositionFromFusion();
      if (firstAnchor) {
        debugLog("[gps] anchored", { lat: f.origin.lat.toFixed(6), lng: f.origin.lng.toFixed(6) });
        fillNodeLatLng();
        projectWalks();
      }
      if (f.hasOrigin) fillNodeLatLng();
      updateMetricsUI();
      scheduleRouteRedraw();
      if (isRecording) updateListenModeThrottled();
      const now = performance.now();
      if (now - lastGpsLogMs > 5000) {
        lastGpsLogMs = now;
        debugLog("[gps] fix", {
          accuracy: Math.round(pos.coords.accuracy),
          used: f.lastFix?.used,
          blendedUncertainty: Math.round(f.uncertaintyM),
        });
      }
    },
    onError: (err) => {
      const denied = err?.code === 1;
      gpsText.textContent = denied ? "Location permission denied" : "GPS unavailable";
      debugLog("[gps] error", err?.code, err?.message || err);
      if (denied) {
        showHeadingSensorWarning(
          "Location is off for this site, so walks fall back to steps + compass only (start each walk from the same point). To turn it on: iPhone Settings → Privacy & Security → Location Services → Safari Websites → While Using.",
        );
      }
    },
  });
  updateLocationUI();
}

function stopSensorTracking() {
  clearHeadingSensorWarning({ clearUi: false });
  if (onMotion) {
    window.removeEventListener("devicemotion", onMotion);
    console.log("[sensors] Removed devicemotion listener");
  }
  if (onOrientation) {
    window.removeEventListener("deviceorientation", onOrientation);
    window.removeEventListener("deviceorientationabsolute", onOrientation);
    console.log("[sensors] Removed deviceorientation listener");
  }
  if (onCompassCalibration) {
    window.removeEventListener("compassneedscalibration", onCompassCalibration);
    console.log("[sensors] Removed compass calibration listener");
  }
  onMotion = null;
  onOrientation = null;
  onCompassCalibration = null;
  fusion.stopGps();
}

function resetSessionState() {
  // Movement + step detection MUST reset fully on every new walk.
  stepCount = 0;
  headingDeg = NaN;
  // Once anchored to GPS, a new walk starts wherever you are; before that,
  // it starts at (0, 0) like the original same-start-point prototype.
  fusion.beginWalk();
  syncPositionFromFusion();

  lastStepMs = 0;
  smoothedMag = 0;
  lastMagDelta = 0;
  lastMotionLogMs = 0;
  lastOrientationLogMs = 0;
  orientationEventCount = 0;
  headingSampleCount = 0;
  clearHeadingSensorWarning({ clearUi: false });
  isCalibrating = false;
  listenNearest = { routeId: null, nodeId: null, distance: Infinity };
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

    // 5) One continuous recording for the whole walk (max 5 minutes), plus a
    // track point every 2 seconds that remembers the second of audio it matches.
    if (!window.MediaRecorder) {
      throw new Error("MediaRecorder is not supported in this browser.");
    }

    const walk = currentRecordingRoute;
    let rec;
    try {
      rec = new MediaRecorder(mediaStream, { audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    } catch (e) {
      debugLog("[audio] bitrate option rejected, using defaults", e?.message || e);
      rec = new MediaRecorder(mediaStream);
    }
    mediaRecorder = rec;
    const chunks = [];

    recordingLoopPromise = new Promise((resolve) => {
      let done = false;
      const finish = (why) => {
        if (done) return;
        done = true;
        const blob = new Blob(chunks, { type: chunks[0]?.type || rec.mimeType || "audio/mp4" });
        walk.audioBlob = blob;
        walk.audioMime = blob.type || rec.mimeType || "audio/mp4";
        walk.durationS = Math.min(MAX_WALK_SECONDS, Math.max(0, (Date.now() - walk.recordStartMs) / 1000));
        if (walk.audioUrl) URL.revokeObjectURL(walk.audioUrl);
        walk.audioUrl = blob.size > 0 ? URL.createObjectURL(blob) : null;
        debugLog("[audio] recording finished", { why, bytes: blob.size, mime: walk.audioMime, seconds: walk.durationS });
        resolve();
      };
      rec.addEventListener("dataavailable", (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      });
      rec.addEventListener("error", (e) => {
        const err = e.error || e;
        debugLog("[audio] MediaRecorder error", err?.name, err?.message || err);
        setError(`Audio recording error: ${err?.message || err}. Tap End Walk to keep what was recorded.`);
      });
      rec.addEventListener("stop", () => finish("stop event"));
      walk.finishRecording = finish;
    });

    rec.start();
    walk.recordStartMs = Date.now();
    recordTrackPoint(walk); // t = 0: where the walk starts
    trackPointTimer = setInterval(() => recordTrackPoint(walk), POINT_INTERVAL_MS);
    recordingClockTimer = setInterval(updateRecordingClock, 1000);
    walkLimitTimer = setTimeout(() => {
      debugLog("[rec] 5-minute limit reached");
      endWalk();
    }, MAX_WALK_SECONDS * 1000);
    debugLog("[audio] recording started", { mime: rec.mimeType });

    updateRecordingClock();
    permText.textContent = formatPermStatus(["Microphone OK", "Motion listening", "Orientation listening", "Location on"]);
    updateMetricsUI();

    // Important: audio playback must be user-initiated on iOS. We only render controls;
    // user tapping play is a gesture, so that's OK.
    debugLog("[rec] session started", { route: currentRecordingRoute?.name });
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
  // Last track point, so the walk ends where you stopped.
  if (isRecording && currentRecordingRoute?.recordStartMs) recordTrackPoint(currentRecordingRoute);
  clearInterval(trackPointTimer);
  clearInterval(recordingClockTimer);
  clearTimeout(walkLimitTimer);
  trackPointTimer = null;
  recordingClockTimer = null;
  walkLimitTimer = null;

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

  // Wait for the recorder to hand over the audio (Safari sometimes never fires
  // `stop`; then keep whatever arrived).
  try {
    if (recordingLoopPromise) {
      const walk = currentRecordingRoute;
      await Promise.race([
        recordingLoopPromise,
        sleep(RECORDER_STOP_TIMEOUT_MS).then(() => walk?.finishRecording?.("stop timeout")),
      ]);
    }
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

function defaultWalkName(ms) {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `Walk ${date}, ${time}`;
}

function hasLocatedNodes(walk) {
  return walk.nodes.some((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng));
}

async function endWalk() {
  if (!currentRecordingRoute || endingWalk) return;
  endingWalk = true;
  try {
    if (isRecording || mediaRecorder || mediaStream) {
      await stopRecordingSession({ keepNodes: true, silent: false });
    }
    const walk = currentRecordingRoute;
    currentRecordingRoute = null;
    delete walk.finishRecording;

    if (!walk.audioBlob || walk.audioBlob.size === 0) {
      setError("No audio was recorded, so this walk was not saved.");
      debugLog("[route] discarded: no audio", walk.id);
      selectedRoute = routes[0] || null;
      renderAll();
      setButtonsForRecording(false);
      return;
    }

    const suggested = defaultWalkName(walk.createdAt);
    let typed = null;
    try {
      typed = window.prompt("Name this walk", suggested);
    } catch {
      // ignore: some contexts block prompts
    }
    walk.name = (typed && typed.trim().slice(0, 80)) || suggested;
    walk.isPublic = false;

    routes.unshift(walk);
    selectedRoute = walk;
    debugLog("[route] walk saved on device", walk.name, { points: walk.nodes.length, seconds: walk.durationS });
    renderAll();
    setButtonsForRecording(false);
    stopListeningPlayback("walk ended");

    await keepAndUpload(walk);
  } finally {
    endingWalk = false;
  }
}

// Store the walk in this browser first, then upload it. If the upload fails,
// it stays on the device and is retried next time the page opens.
async function keepAndUpload(walk) {
  if (!hasLocatedNodes(walk)) {
    walk.cloud = "device";
    walk.cloudError = "No GPS position during this walk, so it stays on this device until you reload.";
    renderAll();
    return;
  }
  walk.cloud = "pending";
  try {
    await savePendingWalk({
      id: walk.id,
      name: walk.name,
      createdAt: walk.createdAt,
      durationS: walk.durationS,
      audioMime: walk.audioMime,
      audioBlob: walk.audioBlob,
      nodes: walk.nodes.map(({ id, t, timestamp, stepCount, heading, x, y, lat, lng, uncertaintyM }) => ({
        id, t, timestamp, stepCount, heading, x, y, lat, lng, uncertaintyM,
      })),
    });
  } catch (e) {
    debugLog("[store] could not keep walk on device", e?.message || e);
  }
  await uploadWalkNow(walk);
}

async function uploadWalkNow(walk) {
  walk.cloud = "uploading";
  walk.cloudError = "";
  renderAll();
  try {
    const cloud = await import("./cloud.js");
    const result = await cloud.uploadWalk(walk);
    walk.audioPath = result.audioPath;
    walk.shareCode = result.shareCode;
    walk.isPublic = result.isPublic;
    walk.cloud = "saved";
    await deletePendingWalk(walk.id).catch(() => {});
    debugLog("[cloud] walk uploaded", walk.name, result.shareCode);
  } catch (e) {
    walk.cloud = "failed";
    walk.cloudError = e?.message || String(e);
    debugLog("[cloud] upload failed", walk.cloudError);
  }
  renderAll();
}

function cloudStatusLabel(walk) {
  switch (walk.cloud) {
    case "saved":
      return walk.isPublic ? "Saved · public" : "Saved · private";
    case "uploading":
      return "Uploading…";
    case "pending":
      return "Waiting to upload";
    case "failed":
      return "Upload failed · will retry";
    case "device":
      return "On this device only";
    default:
      return "Not saved yet";
  }
}

async function deleteSelectedRoute() {
  if (isRecording) return;
  if (!selectedRoute) return;
  const walk = selectedRoute;

  if (walk.cloud === "uploading") {
    setError("This walk is still uploading. Try again in a moment.");
    return;
  }
  const ok = window.confirm(
    `Delete “${walk.name}”?\n\nIts recording and route are removed for good, including from anyone who saved it.`,
  );
  if (!ok) return;

  setError("");
  try {
    if (walk.cloud === "saved") {
      setStatus("Deleting…");
      const cloud = await import("./cloud.js");
      await cloud.deleteWalk(walk);
    } else if (walk.cloud === "failed" || walk.audioPath) {
      // A half-finished upload may have left something in the cloud: try to
      // clean it up, but don't block deleting the copy on this device.
      try {
        const cloud = await import("./cloud.js");
        await cloud.deleteWalk(walk);
      } catch (e) {
        debugLog("[cloud] cleanup of unfinished upload failed", e?.message || e);
      }
    }
    await deletePendingWalk(walk.id).catch(() => {});
  } catch (e) {
    setStatus("Not recording");
    setError(`Could not delete this walk: ${e?.message || e}`);
    return;
  }
  setStatus("Walk deleted");

  if (walk.audioUrl?.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(walk.audioUrl);
    } catch {
      // ignore
    }
  }

  const deletedRouteId = walk.id;
  routes = routes.filter((r) => r.id !== deletedRouteId);
  debugLog("[route] deleted", walk.name);
  selectedRoute = routes[0] || null;

  if (listenModeEnabled && currentlyPlayingRouteId === deletedRouteId) {
    stopListeningPlayback("playing route deleted");
  }
  if (listenModeEnabled && listenNearest.routeId === deletedRouteId) {
    listenNearest = { routeId: null, nodeId: null, distance: Infinity };
  }
  if (listenModeEnabled && getListenSourceRoutes().length === 0) {
    listenModeEnabled = false;
    stopListeningPlayback("no listenable routes left");
    setListenToggleUI();
  }
  renderAll();
  if (listenModeEnabled) {
    lastDirectionUpdateMs = 0;
    updateListenMode(xMeters, yMeters, headingDeg);
  }
}

function renderAll() {
  renderRoutesPanel();
  renderListenRouteOptions();
  renderDownloadsPanel();
  updateMetricsUI();
  renderNodesList();
  drawRoutePreview();
  updateDeleteRouteButton();
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

downloadAllAudioBtn.addEventListener("click", () => {
  downloadAllNodeAudio();
});

// Initial UI
setButtonsForRecording(false);
setStatus("Not recording");
updateMetricsUI();
drawRoutePreview();
renderRoutesPanel();
updateDeleteRouteButton();
renderListenRouteOptions();
renderDownloadsPanel();
setListenToggleUI();
updateListenMode();

debugLog("[init] SoundRoute prototype loaded");

// Cloud connection (Supabase). Loaded with a dynamic import so the on-device
// prototype keeps working even if the network or the CDN is unavailable.
const accountText = document.getElementById("accountText");
const cloudText = document.getElementById("cloudText");

async function connectCloud() {
  try {
    const { ensureVisitor, checkDatabase } = await import("./supabase.js");
    const visitor = await ensureVisitor();
    const kind = visitor.is_anonymous ? "Anonymous" : visitor.email || "Signed in";
    accountText.textContent = `${kind} · ${visitor.id.slice(0, 8)}`;
    debugLog("[cloud] signed in", visitor.id, visitor.is_anonymous ? "(anonymous)" : "");

    const visibleWalks = await checkDatabase();
    cloudText.textContent = `Connected · ${visibleWalks} walk${visibleWalks === 1 ? "" : "s"} visible`;
    debugLog("[cloud] database ok, visible walks:", visibleWalks);
    await loadMyWalks();
  } catch (err) {
    const message = err?.message || String(err);
    if (accountText.textContent === "Connecting…") accountText.textContent = "Not connected";
    cloudText.textContent = message;
    debugLog("[cloud] error", message);
  }
}

// Walks waiting on this device (an upload that didn't finish) — shown even offline.
async function loadPendingWalks() {
  try {
    const pending = await listPendingWalks();
    for (const p of pending) {
      if (routes.some((r) => r.id === p.id)) continue;
      routes.push({
        ...p,
        audioUrl: p.audioBlob ? URL.createObjectURL(p.audioBlob) : null,
        cloud: "pending",
        isPublic: false,
      });
    }
    if (pending.length) debugLog("[store] walks waiting to upload:", pending.length);
  } catch (e) {
    debugLog("[store] could not read walks on this device", e?.message || e);
  }
}

let audioUrlsSignedAt = 0;
async function refreshAudioUrls(cloud) {
  const saved = routes.filter((r) => r.cloud === "saved" && r.audioPath);
  if (!saved.length) return;
  const urls = await cloud.signAudioUrls(saved.map((r) => r.audioPath));
  for (const r of saved) {
    const url = urls.get(r.audioPath);
    if (url) r.audioUrl = url;
  }
  audioUrlsSignedAt = Date.now();
}

async function loadMyWalks() {
  await loadPendingWalks();
  const cloud = await import("./cloud.js");
  const mine = await cloud.loadMyWalks();
  for (const w of mine) {
    if (routes.some((r) => r.id === w.id)) continue;
    routes.push({ ...w, cloud: "saved", fromCloud: true });
  }
  await refreshAudioUrls(cloud);
  routes.sort((a, b) => b.createdAt - a.createdAt);
  projectWalks();
  if (!selectedRoute && !currentRecordingRoute) selectedRoute = routes[0] || null;
  renderAll();
  debugLog("[cloud] my walks loaded:", mine.length);

  // Signed audio links expire after an hour: renew them in good time.
  setInterval(() => {
    refreshAudioUrls(cloud).catch((e) => debugLog("[cloud] could not renew audio links", e?.message || e));
  }, 40 * 60 * 1000);

  // Retry walks that didn't finish uploading last time.
  for (const r of routes.filter((x) => x.cloud === "pending")) {
    await uploadWalkNow(r);
  }
}

loadPendingWalks().then(() => {
  projectWalks();
  renderAll();
});
connectCloud();

