// The walking engine: sensors, position, recording and listening.
// No DOM here. The interface (app.js) calls these functions and gets news
// back through `hooks`.
//
// Position: GPS anchors the walk to the real world; steps + compass smooth it
// between fixes (location.js). Recording: one continuous audio file per walk
// (max 5 minutes) and a track point every 2 seconds that remembers the second
// of audio it matches. Listening: decideListen() (listen.js) picks what to
// hear from where you are and which way you face.

import { LocationFusion } from "./location.js";
import { ListenPlayer, LISTEN_CONFIG, decideListen, nearestPoint } from "./listen.js";

export const MAX_WALK_SECONDS = 5 * 60;
export const POINT_INTERVAL_MS = 2000;
const AUDIO_BITS_PER_SECOND = 32000;
const RECORDER_STOP_TIMEOUT_MS = 6000; // Safari sometimes never fires `stop`
const STEP_LENGTH_METERS = 0.7;
const STEP_COOLDOWN_MS = 380;
const PEAK_THRESHOLD = 1.15;
const SMOOTHING_ALPHA = 0.85;
const FLAT_PHONE_TILT_DEGREES = 35;
const LISTEN_UPDATE_MS = 300;
const PREFETCH_DISTANCE_M = 120;
const CALIBRATION_MS = 1500;

export const hooks = {
  log: (...a) => console.log(...a),
  /** Position, heading or recording time changed (throttle in the UI). */
  onChange: () => {},
  /** A GPS fix arrived. `firstAnchor` is true when the frame was just anchored. */
  onFix: (_fix, _firstAnchor) => {},
  onGpsError: (_err) => {},
  /** What is playing changed: { walk, gain } or null. */
  onHear: (_hearing) => {},
  /** The 5-minute limit was reached. */
  onLimit: () => {},
  /** Which walks can be heard (with audio and positions). */
  listenSources: () => [],
};

export const fusion = new LocationFusion();
export const player = new ListenPlayer({ log: (...a) => hooks.log(...a) });

export const state = {
  sensing: false, // motion, compass and GPS running
  recording: false, // a walk is being recorded (may be paused)
  paused: false,
  listening: false, // decide what to hear while sensing
  stepCount: 0,
  heading: NaN,
  x: 0,
  y: 0,
  hearingId: null,
};

let mediaStream = null;
let mediaRecorder = null;
let walk = null; // the walk being recorded
let recordingDone = null; // Promise resolved when the recorder handed over its audio
let pointTimer = null;
let tickTimer = null;
let calibrateUntil = 0;
let lastStepMs = 0;
let smoothedMag = 0;
let lastMagDelta = 0;
let lastListenMs = 0;
let lastPrefetchMs = 0;
let lastGpsLogMs = 0;
let onMotion = null;
let onOrientation = null;
let anchoredOnce = false;
const cooldowns = new Map(); // walkId → time it may play again

player.onEnded = (walkId) => {
  // A walk played to its end: let it rest so it doesn't loop its last seconds.
  cooldowns.set(walkId, Date.now() + LISTEN_CONFIG.cooldownMs);
  hooks.log("[listen] walk finished", walkId);
  lastListenMs = 0;
  if (state.listening) updateListening(true);
  else setHearing(null);
};

// ─────────────────────────────────────────────
// Permissions (call straight from a tap: iPhone needs the gesture)
// ─────────────────────────────────────────────

/**
 * Asks for motion & compass, then (optionally) the microphone, then location.
 * The motion request MUST be the first thing a tap does on iPhone: nothing may
 * be awaited before it. Returns { motion, mic, location }: "granted" | "denied".
 */
export async function requestPermissions({ mic = true } = {}) {
  const result = { motion: "granted", mic: mic ? "granted" : "skipped", location: "granted" };
  try {
    const DME = window.DeviceMotionEvent;
    const DOE = window.DeviceOrientationEvent;
    const asks = [];
    if (DME && typeof DME.requestPermission === "function") asks.push(DME.requestPermission());
    if (DOE && typeof DOE.requestPermission === "function") asks.push(DOE.requestPermission());
    const answers = await Promise.all(asks.map((p) => p.catch(() => "denied")));
    if (answers.some((a) => a !== "granted")) result.motion = "denied";
  } catch (e) {
    hooks.log("[perm] motion request failed", e?.message || e);
    result.motion = "denied";
  }
  hooks.log("[perm] motion", result.motion);

  if (mic) {
    try {
      if (!mediaStream || !mediaStream.getAudioTracks().some((t) => t.readyState === "live")) {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      hooks.log("[perm] microphone granted");
    } catch (e) {
      hooks.log("[perm] microphone", e?.name || e?.message || e);
      result.mic = "denied";
    }
  }

  result.location = await new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve("denied");
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (err) => resolve(err?.code === 1 ? "denied" : "granted"), // timeout ≠ refusal
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  });
  hooks.log("[perm] location", result.location);
  return result;
}

/** Let go of the microphone (cancelled before recording started). */
export function releaseMicrophone() {
  if (state.recording) return;
  try {
    mediaStream?.getTracks().forEach((t) => t.stop());
  } catch {
    // ignore
  }
  mediaStream = null;
}

// ─────────────────────────────────────────────
// Sensors
// ─────────────────────────────────────────────

const normalizeHeading = (deg) => ((deg % 360) + 360) % 360;
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

function headingFromEvent(ev) {
  const webkit = finite(ev.webkitCompassHeading);
  const alpha = finite(ev.alpha);
  const beta = finite(ev.beta);
  const gamma = finite(ev.gamma);
  // iOS can keep webkitCompassHeading at 0 while the phone lies screen-up; then
  // alpha (yaw) gives the heading of the phone's top edge.
  const flat =
    Number.isFinite(beta) &&
    Number.isFinite(gamma) &&
    Math.abs(beta) <= FLAT_PHONE_TILT_DEGREES &&
    Math.abs(gamma) <= FLAT_PHONE_TILT_DEGREES;
  if (flat && Number.isFinite(alpha)) return normalizeHeading(360 - alpha);
  if (Number.isFinite(webkit)) return normalizeHeading(webkit);
  return Number.isFinite(alpha) ? normalizeHeading(360 - alpha) : NaN;
}

function syncPosition() {
  state.x = fusion.x;
  state.y = fusion.y;
}

/** Start motion, compass and GPS (no microphone). Safe to call twice. */
export function startSensing() {
  if (state.sensing) return;
  state.sensing = true;
  state.stepCount = 0;
  state.heading = NaN;
  smoothedMag = 0;
  lastMagDelta = 0;
  lastStepMs = 0;
  calibrateUntil = performance.now() + CALIBRATION_MS;
  fusion.beginWalk();
  syncPosition();

  onMotion = (ev) => {
    const a = ev.accelerationIncludingGravity || ev.acceleration;
    if (!a) return;
    const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
    if (smoothedMag === 0) smoothedMag = mag;
    smoothedMag = SMOOTHING_ALPHA * smoothedMag + (1 - SMOOTHING_ALPHA) * mag;
    const delta = mag - smoothedMag;
    const now = performance.now();
    if (now < calibrateUntil || state.paused) {
      lastMagDelta = delta;
      return;
    }
    if (lastMagDelta <= PEAK_THRESHOLD && delta > PEAK_THRESHOLD && now - lastStepMs > STEP_COOLDOWN_MS) {
      lastStepMs = now;
      state.stepCount += 1;
      if (Number.isFinite(state.heading)) {
        fusion.onStep(STEP_LENGTH_METERS, state.heading);
        syncPosition();
        updateListening();
      }
      hooks.onChange();
    }
    lastMagDelta = delta;
  };

  onOrientation = (ev) => {
    const h = headingFromEvent(ev);
    if (!Number.isFinite(h)) return;
    state.heading = h;
    updateListening();
  };

  window.addEventListener("devicemotion", onMotion, { passive: true });
  window.addEventListener("deviceorientation", onOrientation, { passive: true });
  window.addEventListener("deviceorientationabsolute", onOrientation, { passive: true });

  fusion.startGps({
    onFix: (f, pos) => {
      const firstAnchor = !anchoredOnce && f.hasOrigin && Boolean(f.lastFix?.used);
      if (firstAnchor) anchoredOnce = true;
      syncPosition();
      if (f.hasOrigin && walk) fillLatLng(walk);
      if (firstAnchor) hooks.log("[gps] anchored", { lat: f.origin.lat.toFixed(6), lng: f.origin.lng.toFixed(6) });
      const now = performance.now();
      if (now - lastGpsLogMs > 5000) {
        lastGpsLogMs = now;
        hooks.log("[gps] fix", { accuracy: Math.round(pos.coords.accuracy), used: f.lastFix?.used });
      }
      hooks.onFix(f.lastFix, firstAnchor);
      updateListening();
      hooks.onChange();
    },
    onError: (err) => {
      hooks.log("[gps] error", err?.code, err?.message || err);
      hooks.onGpsError(err);
    },
  });
  hooks.log("[sensors] started");
}

export function stopSensing() {
  if (!state.sensing) return;
  state.sensing = false;
  if (onMotion) window.removeEventListener("devicemotion", onMotion);
  if (onOrientation) {
    window.removeEventListener("deviceorientation", onOrientation);
    window.removeEventListener("deviceorientationabsolute", onOrientation);
  }
  onMotion = null;
  onOrientation = null;
  fusion.stopGps();
  hooks.log("[sensors] stopped");
}

/** True once a GPS fix good enough to place a walk has arrived. */
export function hasGoodFix() {
  return Boolean(fusion.hasOrigin && fusion.lastFix?.used);
}

/** Where I am now, or null before GPS anchors the frame. */
export function hereLatLng() {
  return fusion.hasOrigin ? fusion.toLatLng(state.x, state.y) : null;
}

function fillLatLng(w) {
  if (!fusion.hasOrigin) return;
  for (const n of w.nodes) {
    if (Number.isFinite(n.lat)) continue;
    const ll = fusion.toLatLng(n.x, n.y);
    n.lat = ll.lat;
    n.lng = ll.lng;
  }
}

// Walks loaded from the cloud only have latitude/longitude. Give their points
// x/y in this session's frame (or, before GPS anchors it, in a display-only
// frame) so drawing and listening can use them like walks recorded here.
let displayFrame = null;
export function projectWalks(walks) {
  for (const r of walks) {
    for (const n of r.nodes || []) {
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

// ─────────────────────────────────────────────
// Recording
// ─────────────────────────────────────────────

const makeId = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

/** Seconds of audio recorded so far (pauses excluded). */
export function recordedSeconds() {
  if (!walk?.recordStartMs) return 0;
  const pausedNow = state.paused && walk.pausedAt ? Date.now() - walk.pausedAt : 0;
  return Math.min(MAX_WALK_SECONDS, Math.max(0, (Date.now() - walk.recordStartMs - walk.pausedMs - pausedNow) / 1000));
}

export function currentWalk() {
  return walk;
}

function addTrackPoint() {
  if (!walk?.recordStartMs || state.paused) return;
  const ll = fusion.hasOrigin ? fusion.toLatLng(state.x, state.y) : null;
  walk.nodes.push({
    id: walk.nodes.length + 1,
    t: recordedSeconds(),
    timestamp: Date.now(),
    stepCount: state.stepCount,
    heading: state.heading,
    x: state.x,
    y: state.y,
    lat: ll ? ll.lat : null,
    lng: ll ? ll.lng : null,
    uncertaintyM: fusion.hasOrigin ? fusion.uncertaintyM : null,
  });
}

/**
 * Starts recording a new walk. Needs the microphone (requestPermissions) and
 * sensing already running. Returns the walk object.
 */
export function startRecording() {
  if (state.recording) return walk;
  if (!mediaStream) throw new Error("The microphone isn't on.");
  if (!window.MediaRecorder) throw new Error("This browser can't record audio.");
  if (!state.sensing) startSensing();
  fusion.beginWalk();
  syncPosition();

  walk = {
    id: makeId(),
    name: "New Walk",
    createdAt: Date.now(),
    nodes: [],
    pausedMs: 0,
    pausedAt: 0,
    isPublic: false,
  };
  let rec;
  try {
    rec = new MediaRecorder(mediaStream, { audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
  } catch (e) {
    hooks.log("[audio] bitrate option rejected, using defaults", e?.message || e);
    rec = new MediaRecorder(mediaStream);
  }
  mediaRecorder = rec;
  const chunks = [];
  const w = walk;
  recordingDone = new Promise((resolve) => {
    let done = false;
    const finish = (why) => {
      if (done) return;
      done = true;
      const blob = new Blob(chunks, { type: chunks[0]?.type || rec.mimeType || "audio/mp4" });
      w.audioBlob = blob;
      w.audioMime = blob.type || rec.mimeType || "audio/mp4";
      w.durationS = recordedSecondsOf(w);
      w.audioUrl = blob.size > 0 ? URL.createObjectURL(blob) : null;
      hooks.log("[audio] recording finished", { why, bytes: blob.size, mime: w.audioMime, seconds: w.durationS });
      resolve();
    };
    rec.addEventListener("dataavailable", (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    });
    rec.addEventListener("error", (e) => hooks.log("[audio] MediaRecorder error", e.error?.message || e));
    rec.addEventListener("stop", () => finish("stop event"));
    w.finishRecording = finish;
  });

  rec.start(1000);
  walk.recordStartMs = Date.now();
  state.recording = true;
  state.paused = false;
  addTrackPoint(); // t = 0: where the walk starts
  pointTimer = setInterval(addTrackPoint, POINT_INTERVAL_MS);
  tickTimer = setInterval(() => {
    hooks.onChange();
    if (recordedSeconds() >= MAX_WALK_SECONDS) {
      hooks.log("[rec] 5-minute limit reached");
      clearInterval(tickTimer);
      tickTimer = null;
      hooks.onLimit();
    }
  }, 500);
  // Starting the microphone can interrupt audio output on iPhone.
  player.resume();
  hooks.log("[audio] recording started", { mime: rec.mimeType });
  return walk;
}

function recordedSecondsOf(w) {
  if (!w.recordStartMs) return 0;
  const pausedNow = w.pausedAt ? Date.now() - w.pausedAt : 0;
  return Math.min(MAX_WALK_SECONDS, Math.max(0, (Date.now() - w.recordStartMs - w.pausedMs - pausedNow) / 1000));
}

export function pauseRecording() {
  if (!state.recording || state.paused) return;
  try {
    if (mediaRecorder?.state === "recording") mediaRecorder.pause();
  } catch (e) {
    hooks.log("[rec] pause failed", e?.message || e);
  }
  addTrackPoint();
  walk.pausedAt = Date.now();
  state.paused = true;
  hooks.log("[rec] paused");
  hooks.onChange();
}

export function resumeRecording() {
  if (!state.recording || !state.paused) return;
  walk.pausedMs += Date.now() - walk.pausedAt;
  walk.pausedAt = 0;
  state.paused = false;
  try {
    if (mediaRecorder?.state === "paused") mediaRecorder.resume();
  } catch (e) {
    hooks.log("[rec] resume failed", e?.message || e);
  }
  addTrackPoint();
  hooks.log("[rec] resumed");
  hooks.onChange();
}

/**
 * Stops recording and hands back the walk, with its audio (audioBlob,
 * audioUrl, durationS). The microphone is released; sensing keeps running
 * only if listening is on.
 */
export async function stopRecording() {
  if (!walk) return null;
  const w = walk;
  if (state.paused) {
    w.pausedMs += Date.now() - w.pausedAt;
    w.pausedAt = 0;
    state.paused = false;
  }
  addTrackPoint(); // the walk ends where you stopped
  clearInterval(pointTimer);
  clearInterval(tickTimer);
  pointTimer = null;
  tickTimer = null;
  state.recording = false;
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  } catch (e) {
    hooks.log("[rec] recorder stop error", e?.message || e);
  }
  try {
    await Promise.race([
      recordingDone,
      new Promise((r) => setTimeout(r, RECORDER_STOP_TIMEOUT_MS)).then(() => w.finishRecording?.("stop timeout")),
    ]);
  } catch (e) {
    hooks.log("[rec] stop wait error", e?.message || e);
  }
  delete w.finishRecording;
  fillLatLng(w);
  mediaRecorder = null;
  recordingDone = null;
  walk = null;
  releaseMicrophone();
  if (!state.listening) stopSensing();
  hooks.onChange();
  return w;
}

// ─────────────────────────────────────────────
// Listening while walking
// ─────────────────────────────────────────────

/** Turn location-driven listening on or off. Call `player.unlock()` from a tap first. */
export function setListening(on) {
  state.listening = on;
  lastListenMs = 0;
  if (on) {
    if (!state.sensing) startSensing();
    updateListening(true);
  } else {
    if (player.playingWalkId) player.stop();
    setHearing(null);
    if (!state.recording) stopSensing();
  }
}

function setHearing(w, gain = 0) {
  const id = w?.id ?? null;
  if (id !== state.hearingId) {
    state.hearingId = id;
    hooks.onHear(w ? { walk: w, gain } : null);
  }
}

function prefetchNearby(sources) {
  const now = performance.now();
  if (now - lastPrefetchMs < 5000) return;
  lastPrefetchMs = now;
  for (const w of sources) {
    const near = nearestPoint(w, state.x, state.y);
    if (near && near.distance <= PREFETCH_DISTANCE_M) player.prefetch(w);
  }
}

/** Nearest walk on my map (metres), for "nothing nearby" messages. */
export function nearestWalkDistance() {
  let best = Infinity;
  for (const w of hooks.listenSources()) {
    const n = nearestPoint(w, state.x, state.y);
    if (n) best = Math.min(best, n.distance);
  }
  return best;
}

// - near a walk and facing it → it fades in from the second recorded there
// - keep walking along it → it keeps playing; it re-syncs if you drift apart
// - another walk clearly closer → crossfade to it
// - walk away → it fades out
export function updateListening(force = false) {
  if (!state.listening || !state.sensing) return;
  const now = performance.now();
  if (!force && now - lastListenMs < LISTEN_UPDATE_MS) return;
  lastListenMs = now;

  const sources = hooks.listenSources();
  prefetchNearby(sources);
  player.resume();
  const playingId = player.playingWalkId;
  const d = decideListen({
    x: state.x,
    y: state.y,
    heading: state.heading,
    walks: sources,
    current: playingId ? { walkId: playingId, audioTime: player.currentTime } : null,
    cooldowns,
    nowMs: Date.now(),
  });

  switch (d.action) {
    case "start":
    case "switch":
      player.play(d.walk, d.point.t, d.gain);
      break;
    case "resync":
      player.resync(d.point.t);
      player.setVolume(d.gain);
      break;
    case "keep":
      player.setVolume(d.gain);
      break;
    case "stop":
      player.stop();
      break;
    default:
      break;
  }
  if (d.action !== "keep" && d.action !== "none") {
    hooks.log("[listen]", d.action, d.walk?.name ?? "", {
      t: d.point?.t,
      distance: Number.isFinite(d.distance) ? Math.round(d.distance) : null,
      angle: Number.isFinite(d.angle) ? Math.round(d.angle) : null,
      gain: Number.isFinite(d.gain) ? d.gain.toFixed(2) : null,
    });
  }
  const hearing = player.playingWalkId ? sources.find((w) => w.id === player.playingWalkId) : null;
  state.gain = hearing ? d.gain ?? 0 : 0;
  setHearing(hearing, state.gain);
}

/** Forget cooldowns etc. after the list of walks changed. */
export function walksChanged() {
  lastListenMs = 0;
  if (player.playingWalkId && !hooks.listenSources().some((w) => w.id === player.playingWalkId)) {
    player.stop();
    setHearing(null);
  }
  updateListening(true);
}
