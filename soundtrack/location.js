// Position for SoundRoute: GPS anchored, smoothed by steps + compass.
//
// Steps and compass (dead reckoning) react instantly but drift over time.
// GPS never drifts but jumps around by 5–30 m in a city. A small Kalman-style
// filter blends the two: each step moves the estimate and makes it less
// certain; each GPS fix pulls the estimate towards the fix, by how much
// depends on how uncertain the estimate is compared to the GPS accuracy.
//
// Positions are kept in a local flat frame in metres (x = east, y = north)
// so the existing route drawing and listen-mode maths keep working.
// The frame's origin is pinned to real latitude/longitude by the first GPS
// fix, which is what lets walks start anywhere.

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

export class LocationFusion {
  constructor({
    maxAccuracyM = 50, // ignore fixes worse than this
    minAccuracyM = 3, // never trust a fix more than this
    stepVarianceM2 = 0.15, // uncertainty added per step (length + heading error)
    timeVarianceM2PerS = 1.0, // uncertainty added per second (undetected movement)
  } = {}) {
    this.maxAccuracyM = maxAccuracyM;
    this.minAccuracyM = minAccuracyM;
    this.stepVarianceM2 = stepVarianceM2;
    this.timeVarianceM2PerS = timeVarianceM2PerS;

    this.origin = null; // { lat, lng } of local (0, 0)
    this.x = 0;
    this.y = 0;
    this.variance = 100; // m², before any GPS
    this.lastUpdateMs = null;
    this.lastFix = null; // { lat, lng, accuracy, timestamp, used }
    this.watchId = null;
  }

  get hasOrigin() {
    return this.origin != null;
  }

  /** Uncertainty of the blended position, in metres (1 sigma). */
  get uncertaintyM() {
    return Math.sqrt(this.variance);
  }

  /**
   * Call at the start of a walk. Without GPS yet, walks start at (0, 0) as in
   * the original prototype; once anchored, the position simply carries on.
   */
  beginWalk() {
    if (!this.hasOrigin) {
      this.x = 0;
      this.y = 0;
    }
    this.lastUpdateMs = null;
  }

  /** Dead-reckoning step: heading in degrees, 0 = north, 90 = east. */
  onStep(lengthM, headingDeg, nowMs = performance.now()) {
    if (!Number.isFinite(headingDeg)) return;
    this.#growUncertainty(nowMs);
    const h = headingDeg * DEG;
    this.x += lengthM * Math.sin(h);
    this.y += lengthM * Math.cos(h);
    this.variance += this.stepVarianceM2;
  }

  /**
   * GPS fix from navigator.geolocation. Returns true when it moved the estimate.
   */
  onFix(coords, timestamp = Date.now(), nowMs = performance.now()) {
    const lat = coords.latitude;
    const lng = coords.longitude;
    const accuracy = Number.isFinite(coords.accuracy) ? coords.accuracy : Infinity;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    const used = accuracy <= this.maxAccuracyM;
    this.lastFix = { lat, lng, accuracy, timestamp, used };
    if (!used) return false;

    const sigma = Math.max(accuracy, this.minAccuracyM);
    const measurementVariance = sigma * sigma;

    if (!this.hasOrigin) {
      // Pin the frame so the current local position sits exactly on this fix.
      // Anything already drawn in the frame keeps its shape.
      const cosLat = Math.cos(lat * DEG);
      this.origin = {
        lat: lat - (this.y / EARTH_RADIUS_M) / DEG,
        lng: lng - (this.x / (EARTH_RADIUS_M * cosLat)) / DEG,
      };
      this.variance = measurementVariance;
      this.lastUpdateMs = nowMs;
      return true;
    }

    this.#growUncertainty(nowMs);
    const z = this.toLocal(lat, lng);
    const gain = this.variance / (this.variance + measurementVariance);
    this.x += gain * (z.x - this.x);
    this.y += gain * (z.y - this.y);
    this.variance = (1 - gain) * this.variance;
    return true;
  }

  /** Latitude/longitude → local metres. Needs an origin. */
  toLocal(lat, lng) {
    if (!this.hasOrigin) return null;
    const cosLat = Math.cos(this.origin.lat * DEG);
    return {
      x: (lng - this.origin.lng) * DEG * EARTH_RADIUS_M * cosLat,
      y: (lat - this.origin.lat) * DEG * EARTH_RADIUS_M,
    };
  }

  /** Local metres → latitude/longitude. Null until the first GPS fix. */
  toLatLng(x, y) {
    if (!this.hasOrigin) return null;
    const cosLat = Math.cos(this.origin.lat * DEG);
    return {
      lat: this.origin.lat + (y / EARTH_RADIUS_M) / DEG,
      lng: this.origin.lng + (x / (EARTH_RADIUS_M * cosLat)) / DEG,
    };
  }

  /** Start watching GPS. onFix(fusion, position) / onError(error). */
  startGps({ onFix, onError } = {}) {
    if (this.watchId != null) return true;
    if (!("geolocation" in navigator)) {
      onError?.(new Error("This browser has no GPS / geolocation support."));
      return false;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.onFix(pos.coords, pos.timestamp);
        onFix?.(this, pos);
      },
      (err) => onError?.(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    return true;
  }

  stopGps() {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  #growUncertainty(nowMs) {
    if (this.lastUpdateMs != null && nowMs > this.lastUpdateMs) {
      this.variance += ((nowMs - this.lastUpdateMs) / 1000) * this.timeVarianceM2PerS;
    }
    this.lastUpdateMs = nowMs;
  }
}

/** Distance in metres between two lat/lng points (haversine). */
export function distanceM(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}
