// City plaza: public walks as lights on a dark ground, like a city at night
// seen from above. No base map: the shape of the city comes from where people
// have walked. Each light is a ~200 m grid cell (exact routes are never shown);
// the more walks in a cell, the brighter it glows.
//
// Drag to move, pinch or scroll to zoom, tap a light to choose it.

const R = 6378137; // Web Mercator radius, metres
const DEG = Math.PI / 180;
const MIN_SPAN_M = 2500; // never zoom in closer than this when fitting
const TAP_RADIUS_PX = 28;

const project = (lat, lng) => ({
  x: R * lng * DEG,
  y: R * Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * DEG) / 2)),
});

export class PlazaMap {
  constructor(canvas, { onSelect = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onSelect = onSelect;
    this.cells = [];
    this.maxWalks = 1;
    this.view = { cx: 0, cy: 0, scale: 0.05 }; // centre (Mercator m), px per metre
    this.selected = null;
    this.you = null; // { lat, lng }
    this.dpr = 1;
    this.#bindGestures();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setCells(cells) {
    this.cells = cells.map((c) => ({ ...c, p: project(c.lat, c.lng) }));
    this.maxWalks = Math.max(1, ...this.cells.map((c) => c.walks));
    if (this.selected) {
      this.selected = this.cells.find((c) => c.lat === this.selected.lat && c.lng === this.selected.lng) || null;
    }
    this.draw();
  }

  setYou(latLng) {
    this.you = latLng ? { ...latLng, p: project(latLng.lat, latLng.lng) } : null;
    this.draw();
  }

  /** Fit all lights (and you, if known) into view. */
  fit() {
    const pts = this.cells.map((c) => c.p);
    if (this.you) pts.push(this.you.p);
    if (pts.length === 0) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const { w, h } = this.#size();
    const span = Math.max(MIN_SPAN_M, (maxX - minX) * 1.3, (maxY - minY) * 1.3 * (w / h));
    this.view = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: w / span };
    this.draw();
  }

  /** Centre on a place, about 3 km across. */
  centreOn(latLng) {
    const p = project(latLng.lat, latLng.lng);
    const { w } = this.#size();
    this.view = { cx: p.x, cy: p.y, scale: w / 3000 };
    this.draw();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.draw();
  }

  draw() {
    const { ctx } = this;
    const { w, h } = this.#size();
    if (!w) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#04050a";
    ctx.fillRect(0, 0, w, h);

    // Lights, added on top of each other so dense areas bloom.
    ctx.globalCompositeOperation = "lighter";
    const cellPx = 200 * this.view.scale;
    for (const c of this.cells) {
      const { sx, sy } = this.#toScreen(c.p);
      const k = Math.log2(1 + c.walks) / Math.log2(1 + this.maxWalks); // 0..1
      const radius = Math.max(7, cellPx * (0.9 + 0.9 * k));
      if (sx < -radius || sy < -radius || sx > w + radius || sy > h + radius) continue;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
      const a = 0.35 + 0.65 * k;
      g.addColorStop(0, `rgba(255, 246, 214, ${a})`);
      g.addColorStop(0.18, `rgba(255, 205, 120, ${a * 0.85})`);
      g.addColorStop(0.5, `rgba(255, 150, 60, ${a * 0.28})`);
      g.addColorStop(1, "rgba(255, 120, 40, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    if (this.selected) {
      const { sx, sy } = this.#toScreen(this.selected.p);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(14, cellPx * 0.9), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.you) {
      const { sx, sy } = this.#toScreen(this.you.p);
      ctx.fillStyle = "rgba(10, 132, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(10, 132, 255, 0.45)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Scale bar
    const targetPx = 90;
    const metres = targetPx / this.view.scale;
    const nice = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000].find((m) => m >= metres) || 1000000;
    const barPx = nice * this.view.scale;
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(14, h - 16);
    ctx.lineTo(14 + barPx, h - 16);
    ctx.moveTo(14, h - 20);
    ctx.lineTo(14, h - 12);
    ctx.moveTo(14 + barPx, h - 20);
    ctx.lineTo(14 + barPx, h - 12);
    ctx.stroke();
    ctx.font = "11px system-ui, -apple-system, sans-serif";
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 14, h - 24);
  }

  #size() {
    return { w: this.canvas.width / this.dpr, h: this.canvas.height / this.dpr };
  }

  #toScreen(p) {
    const { w, h } = this.#size();
    return { sx: w / 2 + (p.x - this.view.cx) * this.view.scale, sy: h / 2 - (p.y - this.view.cy) * this.view.scale };
  }

  #zoomAt(factor, sx, sy) {
    const { w, h } = this.#size();
    const mx = this.view.cx + (sx - w / 2) / this.view.scale;
    const my = this.view.cy - (sy - h / 2) / this.view.scale;
    const scale = Math.max(1e-5, Math.min(2, this.view.scale * factor));
    this.view = { scale, cx: mx - (sx - w / 2) / scale, cy: my + (sy - h / 2) / scale };
    this.draw();
  }

  #pick(sx, sy) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.cells) {
      const s = this.#toScreen(c.p);
      const d = Math.hypot(s.sx - sx, s.sy - sy);
      const reach = Math.max(TAP_RADIUS_PX, 200 * this.view.scale);
      if (d <= reach && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    this.selected = best;
    this.draw();
    this.onSelect(best);
  }

  #bindGestures() {
    const el = this.canvas;
    const pointers = new Map();
    let moved = 0;
    let pinchStart = null;
    const local = (e) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.view.scale };
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      const cur = local(e);
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        moved += Math.abs(dx) + Math.abs(dy);
        this.view.cx -= dx / this.view.scale;
        this.view.cy += dy / this.view.scale;
        this.draw();
      } else if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const target = pinchStart.scale * (d / pinchStart.d);
        moved += 10;
        this.#zoomAt(target / this.view.scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0 && moved < 8) this.#pick(p.x, p.y);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", (e) => {
      pointers.delete(e.pointerId);
      pinchStart = null;
    });
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = local(e);
        this.#zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
      },
      { passive: false },
    );
  }
}
