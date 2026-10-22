// Listening to walks while you move.
//
// Two layers:
// - decideListen(): pure decision, no audio. Given where you are, which way
//   you face and what is playing, decide to start, keep, re-sync, switch or
//   stop. Easy to test without a browser.
// - ListenPlayer: the audio. Two players for crossfades, each routed through a
//   Web Audio gain node, because iPhone Safari ignores <audio>.volume.

export const LISTEN_CONFIG = {
  enterDistanceM: 20, // start hearing a walk this close to one of its points
  leaveDistanceM: 28, // stop once you are this far from the walk you hear
  fullVolumeDistanceM: 6, // full volume within this distance
  minDistanceGain: 0.15, // volume at the edge
  frontConeDeg: 75, // a new walk starts only if it lies roughly in front
  switchMarginM: 8, // another walk must be this much closer to take over
  behindPenaltyM: 10, // walks behind you count as this much farther
  resyncSeconds: 12, // re-seek when playback drifts this far from the place
  resyncMaxDistanceM: 15, // only re-seek when you are really on the route
  cooldownMs: 45000, // a walk that finished playing rests this long
  fullDirectionDeg: 30, // facing the sound within this angle = full volume
  minDirectionGain: 0.35, // facing away
};

const DEG = Math.PI / 180;

export function angleDiff(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function bearingDeg(fromX, fromY, toX, toY) {
  const deg = Math.atan2(toX - fromX, toY - fromY) / DEG;
  return (deg + 360) % 360;
}

/** Nearest point of a walk to (x, y): { point, distance }. */
export function nearestPoint(walk, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const p of walk.nodes) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ? { point: best, distance: bestD } : null;
}

/** Volume from distance and facing: 0..1. */
export function listenGain(distance, angle, cfg = LISTEN_CONFIG) {
  let dist = 1;
  if (distance > cfg.fullVolumeDistanceM) {
    const k = (distance - cfg.fullVolumeDistanceM) / (cfg.leaveDistanceM - cfg.fullVolumeDistanceM);
    dist = 1 - Math.min(1, Math.max(0, k)) * (1 - cfg.minDistanceGain);
  }
  let dir = 1;
  // Standing on the route itself, direction doesn't matter.
  if (Number.isFinite(angle) && distance > cfg.fullVolumeDistanceM) {
    if (angle > cfg.fullDirectionDeg) {
      const k = (angle - cfg.fullDirectionDeg) / (180 - cfg.fullDirectionDeg);
      dir = 1 - Math.min(1, k) * (1 - cfg.minDirectionGain);
    }
  }
  return Math.max(0, Math.min(1, dist * dir));
}

/**
 * Decide what to hear.
 * state = { x, y, heading, walks, current: { walkId, audioTime } | null, cooldowns: Map(walkId → untilMs), nowMs }
 * returns { action: "none" | "start" | "keep" | "resync" | "switch" | "stop", walk, point, distance, angle, gain }
 */
export function decideListen(state, cfg = LISTEN_CONFIG) {
  const { x, y, heading, walks, current, cooldowns, nowMs } = state;
  const hasHeading = Number.isFinite(heading);

  const candidates = [];
  for (const walk of walks) {
    const near = nearestPoint(walk, x, y);
    if (!near) continue;
    const bearing = bearingDeg(x, y, near.point.x, near.point.y);
    const angle = hasHeading && near.distance > 1 ? angleDiff(heading, bearing) : 0;
    const behind = angle > 90;
    candidates.push({
      walk,
      point: near.point,
      distance: near.distance,
      angle,
      score: near.distance + (behind ? cfg.behindPenaltyM : 0),
    });
  }
  const byId = new Map(candidates.map((c) => [c.walk.id, c]));
  const restingUntil = (id) => cooldowns?.get(id) ?? 0;

  const fresh = candidates
    .filter((c) => c.distance <= cfg.enterDistanceM)
    .filter((c) => !hasHeading || c.angle <= cfg.frontConeDeg || c.distance <= cfg.fullVolumeDistanceM)
    .filter((c) => (current ? c.walk.id !== current.walkId : true))
    .filter((c) => restingUntil(c.walk.id) <= nowMs)
    .sort((a, b) => a.score - b.score);
  const bestNew = fresh[0] || null;

  const withGain = (c, action) => ({ action, ...c, gain: listenGain(c.distance, c.angle, cfg) });

  if (current) {
    const cur = byId.get(current.walkId);
    if (!cur || cur.distance > cfg.leaveDistanceM) {
      return bestNew ? withGain(bestNew, "switch") : { action: "stop", walk: cur?.walk ?? null };
    }
    // The walk you're hearing counts by plain distance (no "behind" penalty):
    // you may be walking along it, with its nearest point beside or behind you.
    if (bestNew && bestNew.score + cfg.switchMarginM < cur.distance) {
      return withGain(bestNew, "switch");
    }
    const drift = Math.abs((current.audioTime ?? 0) - cur.point.t);
    if (drift > cfg.resyncSeconds && cur.distance <= cfg.resyncMaxDistanceM) {
      return withGain(cur, "resync");
    }
    return withGain(cur, "keep");
  }

  return bestNew ? withGain(bestNew, "start") : { action: "none", walk: null };
}

// ─────────────────────────────────────────────
// Audio
// ─────────────────────────────────────────────

// 0.05 s of silence (8 kHz, 8-bit mono WAV), used to prime players on iPhone.
const SILENT_WAV = (() => {
  const n = 400;
  const bytes = new Uint8Array(44 + n);
  const v = new DataView(bytes.buffer);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, "data"); v.setUint32(40, n, true); bytes.fill(128, 44);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
})();

const FADE_IN_S = 1.2;
const FADE_OUT_S = 1.5;
const GAIN_SMOOTHING_S = 0.35;

export class ListenPlayer {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.ctx = null;
    this.players = [this.#makePlayer(), this.#makePlayer()];
    this.active = null; // the player currently "on"
    this.primed = false;
    this.onEnded = null; // (walkId) => void
    this.blobCache = new Map(); // walkId → { url, bytes }
  }

  /**
   * Call from a tap: iPhone only lets audio start inside a user gesture.
   * Never waits on anything that might not finish, so the caller can't hang.
   */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        this.ctx = new Ctx();
        for (const p of this.players) this.#connect(p);
        // Starting the microphone on iPhone can suspend or "interrupt" audio
        // output. Whenever that happens, try to bring it back.
        this.ctx.addEventListener("statechange", () => {
          this.log("[listen] audio output", this.ctx.state);
          if (this.ctx.state !== "running" && this.ctx.state !== "closed") this.resume();
        });
      }
    }
    this.resume();
    // Prime idle players once with a tiny silent clip (not an empty element:
    // Safari can leave play() on an element without a source pending forever).
    if (this.primed) return;
    this.primed = true;
    for (const p of this.players) {
      if (p.walkId || p === this.active) continue;
      try {
        p.audio.muted = true;
        p.audio.src = SILENT_WAV;
        const done = () => {
          if (!p.walkId) p.audio.pause();
          p.audio.muted = false;
        };
        const pr = p.audio.play();
        if (pr && typeof pr.then === "function") pr.then(done, done);
        else done();
        setTimeout(done, 1500);
      } catch {
        p.audio.muted = false;
      }
    }
  }

  /** Make sure audio output is running (cheap; safe to call often). */
  resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    try {
      const pr = ctx.resume();
      if (pr && typeof pr.catch === "function") pr.catch((e) => this.log("[listen] audio resume failed", e?.message || e));
    } catch (e) {
      this.log("[listen] audio resume failed", e?.message || e);
    }
  }

  get outputState() {
    return this.ctx ? this.ctx.state : "no Web Audio";
  }

  get playingWalkId() {
    return this.active?.walkId ?? null;
  }

  get currentTime() {
    return this.active?.audio.currentTime ?? 0;
  }

  /** Download nearby walks' audio ahead of time (fewer pauses, and same-origin for Web Audio). */
  async prefetch(walk) {
    if (!walk?.audioUrl || this.blobCache.has(walk.id)) return;
    if (walk.audioUrl.startsWith("blob:") || walk.audioUrl.startsWith("data:")) {
      this.blobCache.set(walk.id, { url: walk.audioUrl, bytes: 0, own: false });
      return;
    }
    this.blobCache.set(walk.id, { url: null, bytes: 0, own: true }); // in progress
    try {
      const res = await fetch(walk.audioUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      this.blobCache.set(walk.id, { url: URL.createObjectURL(blob), bytes: blob.size, own: true });
      this.log("[listen] cached audio", walk.name, `${Math.round(blob.size / 1024)} KB`);
      this.#trimCache();
    } catch (e) {
      this.blobCache.delete(walk.id);
      this.log("[listen] prefetch failed", walk.name, e?.message || e);
    }
  }

  /** Start a walk from `seconds`, fading in (and fading out whatever played). */
  play(walk, seconds, gain = 1) {
    this.resume();
    const next = this.players.find((p) => p !== this.active) || this.players[0];
    const prev = this.active;
    if (prev) this.#fadeOutAndPause(prev);

    const url = this.blobCache.get(walk.id)?.url || walk.audioUrl;
    next.walkId = walk.id;
    next.endedHandled = false;
    const audio = next.audio;
    if (audio.src !== url) {
      // Remote files need CORS to pass through Web Audio; cached ones are local blobs.
      audio.crossOrigin = url.startsWith("http") ? "anonymous" : null;
      audio.src = url;
    }
    this.#setGain(next, 0, 0);
    const start = Math.max(0, seconds || 0);
    const go = () => {
      try {
        audio.currentTime = start;
      } catch (e) {
        this.log("[listen] seek failed", e?.message || e);
      }
      audio.play().catch((e) => this.log("[listen] play() failed", e?.message || e));
      this.#setGain(next, gain, FADE_IN_S);
    };
    if (audio.readyState >= 1) go();
    else audio.addEventListener("loadedmetadata", go, { once: true });
    this.active = next;
    this.log("[listen] play", walk.name, `from ${start.toFixed(1)}s`);
  }

  /** Jump within the playing walk, with a short dip so it doesn't click. */
  resync(seconds) {
    const p = this.active;
    if (!p) return;
    const target = this.#currentGain(p);
    this.#setGain(p, 0, 0.15);
    setTimeout(() => {
      try {
        p.audio.currentTime = Math.max(0, seconds);
      } catch {
        // ignore
      }
      this.#setGain(p, target, 0.4);
    }, 250);
    this.log("[listen] re-sync to", `${seconds.toFixed(1)}s`);
  }

  /** Follow distance and facing smoothly. */
  setVolume(gain) {
    this.resume();
    if (this.active) this.#setGain(this.active, gain, GAIN_SMOOTHING_S);
  }

  stop() {
    if (this.active) this.#fadeOutAndPause(this.active);
    this.active = null;
  }

  #makePlayer() {
    const audio = new Audio();
    audio.preload = "auto";
    audio.playsInline = true;
    const p = { audio, source: null, gain: null, walkId: null, endedHandled: false, fallbackGain: 1 };
    audio.addEventListener("ended", () => {
      if (p.endedHandled) return;
      p.endedHandled = true;
      const id = p.walkId;
      if (this.active === p) this.active = null;
      this.onEnded?.(id);
    });
    return p;
  }

  #connect(p) {
    try {
      p.source = this.ctx.createMediaElementSource(p.audio);
      p.gain = this.ctx.createGain();
      p.gain.gain.value = 0;
      p.source.connect(p.gain).connect(this.ctx.destination);
    } catch (e) {
      this.log("[listen] Web Audio unavailable, volume control limited", e?.message || e);
    }
  }

  #currentGain(p) {
    return p.gain ? p.gain.gain.value : p.fallbackGain;
  }

  #setGain(p, value, seconds) {
    const v = Math.max(0, Math.min(1, value));
    if (p.gain && this.ctx) {
      const now = this.ctx.currentTime;
      p.gain.gain.cancelScheduledValues(now);
      p.gain.gain.setValueAtTime(p.gain.gain.value, now);
      if (seconds > 0) p.gain.gain.linearRampToValueAtTime(v, now + seconds);
      else p.gain.gain.setValueAtTime(v, now);
    } else {
      p.fallbackGain = v;
      try {
        p.audio.volume = v; // works on desktop; iPhone ignores it
      } catch {
        // ignore
      }
    }
  }

  #fadeOutAndPause(p) {
    this.#setGain(p, 0, FADE_OUT_S);
    const id = p.walkId;
    setTimeout(() => {
      if (this.active !== p && p.walkId === id) {
        try {
          p.audio.pause();
        } catch {
          // ignore
        }
      }
    }, FADE_OUT_S * 1000 + 100);
  }

  #trimCache(max = 12) {
    const own = [...this.blobCache.entries()].filter(([, v]) => v.own && v.url);
    while (own.length > max) {
      const [id, v] = own.shift();
      if (this.players.some((p) => p.walkId === id)) continue;
      URL.revokeObjectURL(v.url);
      this.blobCache.delete(id);
    }
  }
}
