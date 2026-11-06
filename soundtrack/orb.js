// Drawing a walk inside the blue orb (Journey screens).
// Positions are in the 390 × 844 artboard frame; the orb is centred at
// ORB.cx, ORB.cy. Routes are smoothed and the first 30 m left out, so where
// a walk set off from is never drawn.

export const ORB = { cx: 195.2, cy: 403.5, fit: 300 };
const PASS_DISTANCE_M = 25; // another walk counts as "passed" this close
const MAX_PASSES = 5;
const PRIVATE_START_M = 30;
const DOT_SOLID = 25.35;
const DOT_PASS = 26.2;
const DOT_SELECTED = 35.49;

const located = (nodes) => (nodes || []).filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));

/** Drop the first `metres` of a list of {x, y} (a third of a short walk). */
export function trimStart(points, metres = PRIVATE_START_M) {
  if (points.length < 3) return points;
  const along = [0];
  for (let i = 1; i < points.length; i += 1) {
    along.push(along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const cut = Math.min(metres, along.at(-1) / 3);
  const kept = points.filter((_, i) => along[i] >= cut);
  return kept.length >= 2 ? kept : points.slice(-2);
}

/** Ramer–Douglas–Peucker: keep the shape, drop the jitter. */
export function simplify(points, eps) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = points[a];
    const B = points[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = eps;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs(dy * points[i].x - dx * points[i].y + B.x * A.y - B.y * A.x) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const f1 = (v) => (Math.round(v * 10) / 10).toString();

/** A smooth SVG path through screen points (Catmull–Rom as cubic Béziers). */
export function smoothPath(pts) {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${f1(pts[0].x)} ${f1(pts[0].y)}`;
  let d = `M${f1(pts[0].x)} ${f1(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f1(c1.x)} ${f1(c1.y)} ${f1(c2.x)} ${f1(c2.y)} ${f1(p2.x)} ${f1(p2.y)}`;
  }
  return d;
}

function lengthOf(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
}

/**
 * Lay a walk out in the orb.
 * walk: { nodes: [{x, y}] } in metres (x east, y north).
 * others: walks that might cross it.
 * trim: leave out the first 30 m (true for walks recorded on this phone;
 *       walks from the cloud were already trimmed when uploaded).
 * Returns { d, start, end, passes: [{ walk, x, y, at }], thin: [d] } or null.
 */
export function layoutWalk(walk, others = [], { trim = true } = {}) {
  let pts = located(walk.nodes);
  if (pts.length < 2) return null;
  if (trim) pts = trimStart(pts);
  pts = simplify(pts, 1.5);
  if (pts.length < 2) return null;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 12); // never blow a few metres up to full size
  const scale = ORB.fit / span;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const toScreen = (p) => ({ x: ORB.cx + (p.x - mx) * scale, y: ORB.cy - (p.y - my) * scale });
  const screen = pts.map(toScreen);

  // Along-route distances, to place passes in drawing order.
  const along = [0];
  for (let i = 1; i < pts.length; i += 1) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = along.at(-1) || 1;

  const passes = [];
  const thin = [];
  const radiusM = (ORB.fit / 2 / scale) * 1.25;
  for (const o of others) {
    if (o.id === walk.id) continue;
    const op = located(o.nodes);
    if (op.length < 2) continue;
    let best = Infinity;
    let at = -1;
    for (const q of op) {
      for (let i = 0; i < pts.length; i += 1) {
        const d = Math.hypot(q.x - pts[i].x, q.y - pts[i].y);
        if (d < best) {
          best = d;
          at = i;
        }
      }
    }
    if (best > PASS_DISTANCE_M || at < 0) continue;
    const s = toScreen(pts[at]);
    passes.push({ walk: o, x: s.x, y: s.y, at: along[at] / total });
    // The part of the other walk near this one, as a thin line.
    const near = op.filter((q) => Math.hypot(q.x - mx, q.y - my) <= radiusM);
    if (near.length >= 2) thin.push(smoothPath(simplify(near, 2).map(toScreen)));
  }
  passes.sort((a, b) => a.at - b.at);
  // Two passes on top of each other read as one: keep them apart.
  const kept = [];
  for (const p of passes) {
    if (kept.length >= MAX_PASSES) break;
    if (kept.some((k) => Math.hypot(k.x - p.x, k.y - p.y) < 30)) continue;
    if (Math.hypot(p.x - screen[0].x, p.y - screen[0].y) < 26) continue;
    if (Math.hypot(p.x - screen.at(-1).x, p.y - screen.at(-1).y) < 26) continue;
    kept.push(p);
  }
  return {
    d: smoothPath(screen),
    start: screen[0],
    end: screen.at(-1),
    passes: kept,
    thin,
    length: lengthOf(screen),
  };
}

const ns = "http://www.w3.org/2000/svg";

function dot(x, y, size, color, cls = "") {
  const el = document.createElement("div");
  el.className = `orb-dot ${cls}`.trim();
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = `left:${(x - size / 2).toFixed(2)}px;top:${(y - size / 2).toFixed(2)}px;width:${size}px;height:${size}px;background:${color}`;
  return el;
}

/**
 * Fill an orb layer (a 390 × 844 positioned element) with a walk's route.
 * opts.selectedId: the passed walk shown orange.
 * opts.onPass(walk): tap on a passed walk's dot.
 * opts.animate: play the Ending drawing once (CSS classes in style.css).
 */
export function renderOrbRoute(layer, layout, { selectedId = null, onPass = null, animate = false } = {}) {
  layer.replaceChildren();
  if (!layout) return;
  const startDelay = 2.65;
  const drawStart = 2.7;
  const drawLen = 3.6;

  for (const p of layout.passes) {
    const selected = p.walk.id === selectedId;
    const el = selected ? dot(p.x, p.y, DOT_SELECTED, "#FF7B04", "is-selected") : dot(p.x, p.y, DOT_PASS, "rgba(255,255,255,0.6)");
    if (animate) {
      el.classList.add("end-dot");
      el.style.animationDelay = `${(drawStart + drawLen * p.at - 0.05).toFixed(2)}s`;
    }
    layer.appendChild(el);
  }

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "orb-svg");
  svg.setAttribute("viewBox", "0 0 390 844");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", layout.d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#FFFFFF");
  path.setAttribute("stroke-width", "3.3");
  path.setAttribute("stroke-dasharray", "4.2 3");
  if (animate) {
    const id = `reveal-${Math.random().toString(36).slice(2, 8)}`;
    const defs = document.createElementNS(ns, "defs");
    const mask = document.createElementNS(ns, "mask");
    mask.setAttribute("id", id);
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("x", "0");
    mask.setAttribute("y", "0");
    mask.setAttribute("width", "390");
    mask.setAttribute("height", "844");
    const m = document.createElementNS(ns, "path");
    m.setAttribute("d", layout.d);
    m.setAttribute("pathLength", "1");
    m.setAttribute("fill", "none");
    m.setAttribute("stroke", "#FFFFFF");
    m.setAttribute("stroke-width", "9");
    m.setAttribute("stroke-linecap", "round");
    m.setAttribute("stroke-dasharray", "1 1");
    m.setAttribute("class", "end-draw");
    mask.appendChild(m);
    defs.appendChild(mask);
    svg.appendChild(defs);
    path.setAttribute("mask", `url(#${id})`);
  }
  svg.appendChild(path);
  layer.appendChild(svg);

  const start = dot(layout.start.x, layout.start.y, DOT_SOLID, "#FFFFFF");
  const end = dot(layout.end.x, layout.end.y, DOT_SOLID, "#FFFFFF");
  if (animate) {
    start.classList.add("end-dot");
    start.style.animationDelay = `${startDelay}s`;
    end.classList.add("end-dot");
    end.style.animationDelay = `${(drawStart + drawLen - 0.05).toFixed(2)}s`;
  }
  layer.append(start, end);

  if (layout.thin.length) {
    const thinSvg = document.createElementNS(ns, "svg");
    thinSvg.setAttribute("class", `orb-svg orb-thin${animate ? " end-thin" : ""}`);
    thinSvg.setAttribute("viewBox", "0 0 390 844");
    thinSvg.setAttribute("aria-hidden", "true");
    for (const d of layout.thin) {
      const t = document.createElementNS(ns, "path");
      t.setAttribute("d", d);
      t.setAttribute("fill", "none");
      t.setAttribute("stroke", "#FFFFFF");
      t.setAttribute("stroke-opacity", "0.72");
      t.setAttribute("stroke-width", "1");
      t.setAttribute("stroke-dasharray", "3.4 2.6");
      thinSvg.appendChild(t);
    }
    layer.appendChild(thinSvg);
  }

  if (onPass) {
    for (const p of layout.passes) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "orb-hit";
      b.setAttribute("aria-label", `Open ${p.walk.name || "a walk you passed"}`);
      b.style.cssText = `left:${(p.x - 22).toFixed(1)}px;top:${(p.y - 22).toFixed(1)}px`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        onPass(p.walk);
      });
      layer.appendChild(b);
    }
  }
}
