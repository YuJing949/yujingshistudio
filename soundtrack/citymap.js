// The blue-white map behind City and My map.
// No base map and no place names: blue light where walks are (the bluer and
// bigger, the more walks), white dashed lines for routes, a black dot for you.
// Drag to move, pinch or scroll to zoom, tap a light or a route.

import { simplify, smoothPath } from "./orb.js";

const R = 6378137; // Web Mercator radius, metres
const DEG = Math.PI / 180;
const MIN_SCALE = 0.12; // px per metre
const MAX_SCALE = 4;
const TAP_SLOP_PX = 8;
const CELL_TAP_RADIUS_PX = 110;
const ROUTE_TAP_PX = 16;
const ns = "http://www.w3.org/2000/svg";

const project = (lat, lng) => ({
  x: R * lng * DEG,
  y: R * Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * DEG) / 2)),
});
// Mercator metres are stretched by 1/cos(lat); divide it out so 1 px ≈ k real metres.
const stretch = (lat) => 1 / Math.cos(lat * DEG);

// Four strengths of light, from the canvas (colour at the centre, size in metres).
const TIERS = [
  { min: 10, rgba: [62, 122, 255, 0.95], mid: [118, 168, 255, 0.7], m: 600 },
  { min: 5, rgba: [104, 158, 255, 0.9], mid: [150, 192, 255, 0.6], m: 470 },
  { min: 2, rgba: [146, 188, 255, 0.75], mid: [184, 212, 255, 0.45], m: 300 },
  { min: 1, rgba: [176, 206, 255, 0.6], mid: [206, 226, 255, 0.35], m: 260 },
];
const tierFor = (n) => TIERS.find((t) => n >= t.min) || TIERS.at(-1);
const rgba = (c) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;

export class CityMap {
  /**
   * el: a positioned element filling the screen.
   * onTapCell(cell), onTapRoute(id), onTapEmpty()
   */
  constructor(el, { onTapCell = () => {}, onTapRoute = () => {}, onTapEmpty = () => {} } = {}) {
    this.el = el;
    this.onTapCell = onTapCell;
    this.onTapRoute = onTapRoute;
    this.onTapEmpty = onTapEmpty;
    this.cells = [];
    this.routes = [];
    this.me = null;
    this.meGrey = false;
    this.view = { cx: 0, cy: 0, scale: 0.9, k: 1 }; // centre (Mercator m), px per real metre
    this.focus = null; // { ids: Set, selected } — area mode
    this.anchor = { x: 195, y: 420 }; // where the view centre sits on screen

    this.glowLayer = document.createElement("div");
    this.glowLayer.className = "map-glows";
    this.svg = document.createElementNS(ns, "svg");
    this.svg.setAttribute("class", "map-routes");
    this.svg.setAttribute("aria-hidden", "true");
    this.meHalo = document.createElement("div");
    this.meHalo.className = "me-halo sr-here";
    this.meHalo.setAttribute("aria-hidden", "true");
    this.meDot = document.createElement("div");
    this.meDot.className = "me-dot";
    this.meDot.setAttribute("role", "img");
    this.meDot.setAttribute("aria-label", "You are here");
    el.append(this.glowLayer, this.svg, this.meHalo, this.meDot);
    this.#bindGestures();
    this.raf = 0;
  }

  get size() {
    return { w: this.el.clientWidth || 390, h: this.el.clientHeight || 844 };
  }

  setAnchor(x, y) {
    this.anchor = { x, y };
    this.draw();
  }

  /** cells: [{ lat, lng, walks }] */
  setCells(cells) {
    this.cells = cells.map((c) => ({ ...c, p: project(c.lat, c.lng), tier: tierFor(c.walks) }));
    this.#buildGlows();
    this.draw();
  }

  /** routes: [{ id, nodes: [{ lat, lng }] }] (already trimmed for privacy). */
  setRoutes(routes, { clipTo = null } = {}) {
    this.routes = routes
      .map((r) => {
        let pts = (r.nodes || []).filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng)).map((n) => project(n.lat, n.lng));
        if (clipTo) {
          const c = clipTo(r);
          if (c) {
            const cp = project(c.lat, c.lng);
            const rad = c.radiusM * stretch(c.lat);
            pts = pts.filter((p) => Math.hypot(p.x - cp.x, p.y - cp.y) <= rad);
          }
        }
        return { id: r.id, pts: simplify(pts, 3) };
      })
      .filter((r) => r.pts.length >= 2);
    this.#buildRoutes();
    this.draw();
  }

  setMe(latLng, { grey = false } = {}) {
    this.me = latLng ? { ...latLng, p: project(latLng.lat, latLng.lng) } : null;
    this.meGrey = grey;
    this.draw();
  }

  /** Area mode: highlight `ids`, thicken `selected`, dim the rest. null = normal. */
  setFocus(focus) {
    this.focus = focus;
    this.#styleRoutes();
  }

  /** Centre on a place; `acrossM` = metres across the screen width. */
  centreOn(latLng, acrossM = 420, { animate = false } = {}) {
    const p = project(latLng.lat, latLng.lng);
    const k = stretch(latLng.lat);
    const next = { cx: p.x, cy: p.y, scale: this.size.w / acrossM, k };
    this.#goTo(next, animate);
  }

  /** Fit a set of lat/lng points, at least `minAcrossM` across. */
  fit(latLngs, { minAcrossM = 420, animate = false, pad = 1.4 } = {}) {
    if (!latLngs.length) return;
    const ps = latLngs.map((l) => project(l.lat, l.lng));
    const xs = ps.map((p) => p.x);
    const ys = ps.map((p) => p.y);
    const lat = latLngs.reduce((s, l) => s + l.lat, 0) / latLngs.length;
    const k = stretch(lat);
    const { w } = this.size;
    const spanM = Math.max(minAcrossM, ((Math.max(...xs) - Math.min(...xs)) / k) * pad, ((Math.max(...ys) - Math.min(...ys)) / k) * pad * 1.2);
    this.#goTo({ cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, scale: w / spanM, k }, animate);
  }

  /** Screen position of a lat/lng (artboard px). */
  toScreen(p) {
    const s = this.view.scale / this.view.k;
    return { x: this.anchor.x + (p.x - this.view.cx) * s, y: this.anchor.y - (p.y - this.view.cy) * s };
  }

  #goTo(next, animate) {
    cancelAnimationFrame(this.anim);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduce) {
      this.view = next;
      this.draw();
      return;
    }
    const from = { ...this.view };
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / 450);
      const e = 1 - (1 - t) ** 3;
      this.view = {
        cx: from.cx + (next.cx - from.cx) * e,
        cy: from.cy + (next.cy - from.cy) * e,
        scale: from.scale + (next.scale - from.scale) * e,
        k: next.k,
      };
      this.draw();
      if (t < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  #buildGlows() {
    this.glowLayer.replaceChildren();
    this.cells.forEach((c, i) => {
      const g = document.createElement("div");
      g.className = "glow sr-glow";
      g.style.animationDelay = `${(-((i * 5.3) % 17)).toFixed(1)}s`;
      const t = c.tier;
      g.style.background = `radial-gradient(circle closest-side, ${rgba(t.rgba)} 0%, ${rgba(t.mid)} 40%, rgba(214, 229, 255, 0.3) 72%, rgba(255, 255, 255, 0) 100%)`;
      c.el = g;
      this.glowLayer.appendChild(g);
    });
  }

  #buildRoutes() {
    this.svg.replaceChildren();
    for (const r of this.routes) {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "#FFFFFF");
      r.el = p;
      this.svg.appendChild(p);
    }
    this.#styleRoutes();
  }

  #styleRoutes() {
    const f = this.focus;
    for (const r of this.routes) {
      const el = r.el;
      if (!el) continue;
      let cls = "route";
      if (f) {
        if (r.id === f.selected) cls += " is-selected";
        else if (f.ids?.has(r.id)) cls += " is-near";
        else cls += " is-dim";
      }
      el.setAttribute("class", cls);
    }
    // Draw the selected route last so it sits on top.
    const sel = f && this.routes.find((r) => r.id === f.selected);
    if (sel?.el) this.svg.appendChild(sel.el);
    this.glowLayer.classList.toggle("is-dim", false);
  }

  draw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.#drawNow();
    });
  }

  #drawNow() {
    const { w, h } = this.size;
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.svg.setAttribute("width", w);
    this.svg.setAttribute("height", h);
    const s = this.view.scale;
    for (const c of this.cells) {
      const q = this.toScreen(c.p);
      const size = Math.max(120, Math.min(620, c.tier.m * s));
      const st = c.el.style;
      st.width = `${size.toFixed(0)}px`;
      st.height = st.width;
      st.left = `${(q.x - size / 2).toFixed(1)}px`;
      st.top = `${(q.y - size / 2).toFixed(1)}px`;
    }
    for (const r of this.routes) {
      r.screen = r.pts.map((p) => this.toScreen(p));
      r.el?.setAttribute("d", smoothPath(r.screen));
    }
    if (this.me) {
      const q = this.toScreen(this.me.p);
      this.meDot.hidden = false;
      this.meHalo.hidden = this.meGrey;
      this.meDot.classList.toggle("is-grey", this.meGrey);
      this.meDot.style.left = `${(q.x - 8.5).toFixed(1)}px`;
      this.meDot.style.top = `${(q.y - 8.5).toFixed(1)}px`;
      this.meHalo.style.left = `${(q.x - 22).toFixed(1)}px`;
      this.meHalo.style.top = `${(q.y - 22).toFixed(1)}px`;
    } else {
      this.meDot.hidden = true;
      this.meHalo.hidden = true;
    }
  }

  #tap(x, y) {
    // A route first (only in area mode, where routes are what you choose)…
    if (this.focus) {
      let best = null;
      let bestD = ROUTE_TAP_PX;
      for (const r of this.routes) {
        if (!this.focus.ids?.has(r.id) || !r.screen) continue;
        for (let i = 1; i < r.screen.length; i += 1) {
          const d = segDist(x, y, r.screen[i - 1], r.screen[i]);
          if (d < bestD) {
            bestD = d;
            best = r;
          }
        }
      }
      if (best) {
        this.onTapRoute(best.id);
        return;
      }
    }
    // …then the nearest light.
    let cell = null;
    let bestD = CELL_TAP_RADIUS_PX;
    for (const c of this.cells) {
      const q = this.toScreen(c.p);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bestD) {
        bestD = d;
        cell = c;
      }
    }
    if (cell) this.onTapCell(cell);
    else this.onTapEmpty();
  }

  #local(e) {
    const r = this.el.getBoundingClientRect();
    const zoom = r.width / (this.el.clientWidth || r.width);
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  }

  #bindGestures() {
    const el = this.el;
    const pointers = new Map();
    let start = null;
    let moved = false;
    let pinch = null;

    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, a, input")) return;
      el.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, this.#local(e));
      if (pointers.size === 1) {
        start = { ...this.#local(e), view: { ...this.view } };
        moved = false;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), view: { ...this.view }, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        moved = true;
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = this.#local(e);
      pointers.set(e.pointerId, p);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.#zoomAt(pinch.mid, pinch.view, d / pinch.d);
      } else if (start) {
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (!moved && Math.hypot(dx, dy) < TAP_SLOP_PX) return;
        moved = true;
        const s = start.view.scale / start.view.k;
        this.view = { ...start.view, cx: start.view.cx - dx / s, cy: start.view.cy + dy / s };
        this.draw();
      }
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = this.#local(e);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        if (!moved && start && e.type === "pointerup") this.#tap(p.x, p.y);
        start = null;
      } else if (pointers.size === 1) {
        const [q] = [...pointers.values()];
        start = { ...q, view: { ...this.view } };
      }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.#zoomAt(this.#local(e), { ...this.view }, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  #zoomAt(at, base, factor) {
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, base.scale * factor));
    const s0 = base.scale / base.k;
    const s1 = scale / base.k;
    // Keep the point under the fingers still.
    const mx = base.cx + (at.x - this.anchor.x) / s0;
    const my = base.cy - (at.y - this.anchor.y) / s0;
    this.view = { ...base, scale, cx: mx - (at.x - this.anchor.x) / s1, cy: my + (at.y - this.anchor.y) / s1 };
    this.draw();
  }
}

function segDist(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L)) : 0;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
