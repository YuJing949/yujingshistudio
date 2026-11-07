// SoundRoute — the Blue interface.
// Screens follow the design canvas (design/blue-spec.md). The walking engine
// (sensors, recording, listening) lives in walker.js; walks in the cloud in
// cloud.js; walks waiting to upload in localstore.js.

import * as W from "./walker.js";
import { layoutWalk, renderOrbRoute } from "./orb.js";
import { CityMap } from "./citymap.js";
import { savePendingWalk, listPendingWalks, deletePendingWalk } from "./localstore.js";

const PREVIEW_SECONDS = 20;
const SHORT_WALK_SECONDS = 10;
const GPS_PATIENCE_MS = 20000;
const NEARBY_M = 3000;
const PLAZA_CELL = { lat: 0.0018, lng: 0.0029 }; // same grid as cloud.js / soundroute.sql
const NAME_MAX = 40;

const $ = (id) => document.getElementById(id);
const cloud = () => import("./cloud.js");
const sb = () => import("./supabase.js");

// ─────────────────────────────────────────────
// Debug log (open with ?debug)
// ─────────────────────────────────────────────

const debugPre = $("debugLogPre");
function log(...args) {
  console.log(...args);
  const ts = new Date().toISOString().slice(11, 23);
  const text = args
    .map((a) => {
      if (a == null || typeof a !== "object") return String(a);
      if (a instanceof Error) return a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  debugPre.textContent += `[${ts}] ${text}\n`;
  const lines = debugPre.textContent.split("\n");
  if (lines.length > 300) debugPre.textContent = lines.slice(-300).join("\n");
}
if (new URLSearchParams(location.search).has("debug")) $("debug").hidden = false;

const readFlag = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeFlag = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // private mode
  }
};

// ─────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────

const ICONS = {
  back: '<svg class="icon" width="32" height="20" viewBox="0 0 32 20" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M31 10H1M11 1 1 10l10 9"/></svg>',
  "arrow-up": '<svg class="icon" width="32" height="34" viewBox="0 0 32 34" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 33V1M1 16 16 1l15 15"/></svg>',
  "arrow-up-sm": '<svg class="icon" width="18" height="20" viewBox="0 0 32 34" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 33V1M1 16 16 1l15 15"/></svg>',
  journey: '<svg class="icon" width="29" height="26" viewBox="0 0 29 26" fill="currentColor"><path d="M0 1h16v13h7c3.5 0 6 2.7 6 7.2 0 2.8-1 4.3-3 4.3H12C5 25.5 0 21 0 15z"/></svg>',
  city: '<svg class="icon" width="26" height="30" viewBox="0 0 26 30" fill="currentColor"><circle cx="7" cy="7" r="6"/><circle cx="19" cy="15.5" r="4"/><circle cx="8" cy="23" r="7"/></svg>',
  mymap: '<svg class="icon" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><path d="M6 25c0-6 4-9 8-9s7 2 10-1 1-7 2-9"/><circle cx="6" cy="26" r="5" fill="currentColor" stroke="none"/><circle cx="26" cy="6" r="5" fill="currentColor" stroke="none"/></svg>',
  mic: '<svg class="icon" width="24" height="36" viewBox="0 0 24 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="7" y="1" width="10" height="21" rx="5" fill="currentColor" stroke="none"/><path d="M2 15v3a10 10 0 0 0 20 0v-3M12 28v7"/></svg>',
  "mic-sm": '<svg class="icon" width="18" height="26" viewBox="0 0 24 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="7" y="1" width="10" height="21" rx="5" fill="currentColor" stroke="none"/><path d="M2 15v3a10 10 0 0 0 20 0v-3M12 28v7"/></svg>',
  headphones: '<svg class="icon" width="30" height="28" viewBox="0 0 30 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 18v-3a12 12 0 0 1 24 0v3"/><rect x="1.5" y="17" width="6.5" height="10" rx="3" fill="currentColor" stroke="none"/><rect x="22" y="17" width="6.5" height="10" rx="3" fill="currentColor" stroke="none"/></svg>',
  "headphones-lg": '<svg class="icon" width="40" height="37" viewBox="0 0 30 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 18v-3a12 12 0 0 1 24 0v3"/><rect x="1.5" y="17" width="6.5" height="10" rx="3" fill="currentColor" stroke="none"/><rect x="22" y="17" width="6.5" height="10" rx="3" fill="currentColor" stroke="none"/></svg>',
  pen: '<svg class="icon" width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M12.6.6a1.3 1.3 0 0 1 1.9 0l1.9 1.9a1.3 1.3 0 0 1 0 1.9L6.3 14.5.9 16.4a.3.3 0 0 1-.4-.4l1.9-5.3z"/></svg>',
  heart: '<svg class="icon" width="26" height="24" viewBox="0 0 26 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M13 22.2S1.5 15.7 1.5 8A6.5 6.5 0 0 1 13 4.1 6.5 6.5 0 0 1 24.5 8c0 7.7-11.5 14.2-11.5 14.2z"/></svg>',
  "heart-sm": '<svg class="icon" width="24" height="22" viewBox="0 0 26 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M13 22.2S1.5 15.7 1.5 8A6.5 6.5 0 0 1 13 4.1 6.5 6.5 0 0 1 24.5 8c0 7.7-11.5 14.2-11.5 14.2z"/></svg>',
  play: '<svg class="icon" width="16" height="18" viewBox="0 0 16 18" fill="currentColor"><path d="M2 1.5v15L15 9z"/></svg>',
  stop: '<svg class="icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="3.5"/></svg>',
  lock: '<svg class="icon" width="11" height="13" viewBox="0 0 11 13" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1" y="5.5" width="9" height="6.8" rx="1.5" fill="currentColor" stroke="none"/><path d="M3 5.5V4a2.5 2.5 0 0 1 5 0v1.5"/></svg>',
  globe: '<svg class="icon" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.1"><circle cx="6.5" cy="6.5" r="5.7"/><path d="M.8 6.5h11.4M6.5.8c-3 3.2-3 8.2 0 11.4M6.5.8c3 3.2 3 8.2 0 11.4"/></svg>',
  download: '<svg class="icon" width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v11M3.5 7.5 8 12l4.5-4.5M1 17h14"/></svg>',
  person: '<svg class="icon" width="20" height="22" viewBox="0 0 20 22" fill="currentColor"><circle cx="10" cy="6" r="5"/><path d="M0 21.5C0 15.7 4.5 13 10 13s10 2.7 10 8.5z"/></svg>',
  compass: '<svg class="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="10.5"/><path d="M15.5 8.5 13.3 13.3 8.5 15.5 10.7 10.7z" fill="currentColor" stroke-linejoin="round"/></svg>',
  pin: '<svg class="icon" width="20" height="26" viewBox="0 0 20 26" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M10 25S1 15.5 1 9.5a9 9 0 0 1 18 0C19 15.5 10 25 10 25z"/><circle cx="10" cy="9.5" r="3.2" fill="currentColor" stroke="none"/></svg>',
  share: '<svg class="icon" width="18" height="23" viewBox="0 0 18 23" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14V1M4.5 5.5 9 1l4.5 4.5M6 9H2.5A1.5 1.5 0 0 0 1 10.5v10A1.5 1.5 0 0 0 2.5 22h13a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 15.5 9H12"/></svg>',
  "add-square": '<svg class="icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="1" y="1" width="18" height="18" rx="4.5"/><path d="M10 5.5v9M5.5 10h9"/></svg>',
  envelope: '<svg class="icon" width="30" height="22" viewBox="0 0 30 22" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="1" y="1" width="28" height="20" rx="4"/><path d="m2 3 13 10L28 3"/></svg>',
  check: '<svg class="icon" width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7.5 6.5 13 17 1"/></svg>',
  "check-sm": '<svg class="icon" width="13" height="10" viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7.5 6.5 13 17 1"/></svg>',
  chevron: '<svg class="icon" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="m1 1 6 6-6 6"/></svg>',
};
const icon = (name) => ICONS[name] || "";

function fillIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon);
    el.setAttribute("aria-hidden", "true");
  });
  root.querySelectorAll('[data-bg="drift"]').forEach((el) => {
    if (el.firstElementChild) return;
    el.innerHTML = '<div class="drift-c sr-c"></div><div class="drift-a sr-a"></div><div class="drift-b sr-b"></div>';
  });
}

function navHtml(tab) {
  const item = (t, label, ic) =>
    `<button type="button" data-tab-go="${t}" aria-label="${label}"${t === tab ? ' aria-current="page"' : ""}>${icon(ic)}</button>`;
  return `<nav class="nav" aria-label="Pages">${item("journey", "Journey", "journey")}${item("city", "City", "city")}${item("mymap", "My map", "mymap")}</nav>`;
}

// ─────────────────────────────────────────────
// Stage: the 390 × 844 artboard, scaled to the phone
// ─────────────────────────────────────────────

const stage = $("stage");
let stageScale = 1;
let stageH = 844;
let stageW = 390;
// The artboard is 390 × 844, but Safari's bars leave less height than that.
// Scale so at least 390 × MIN_H fits; extra width goes to the sides, and the
// things that sit in the middle (orb, nav, pill, dialogs) stay centred.
const MIN_H = 760;
function fitStage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  stageScale = vw < 600 ? Math.min(vw / 390, vh / MIN_H) : Math.min(1, vh / MIN_H);
  stageW = vw < 600 ? vw / stageScale : 390;
  stageH = Math.max(560, vh / stageScale);
  const root = document.documentElement.style;
  root.setProperty("--s", stageScale.toFixed(4));
  root.setProperty("--w", `${stageW.toFixed(1)}px`);
  root.setProperty("--h", `${stageH.toFixed(1)}px`);
  updateKeyboard();
  cityMap?.setAnchor(stageW / 2, stageH * 0.5);
  myMap?.setAnchor(stageW / 2, stageH * 0.45);
}
function updateKeyboard() {
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) / stageScale : 0;
  document.documentElement.style.setProperty("--kb", `${kb.toFixed(0)}px`);
}
window.addEventListener("resize", fitStage);
window.visualViewport?.addEventListener("resize", updateKeyboard);
window.visualViewport?.addEventListener("scroll", updateKeyboard);

// ─────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────

let routes = []; // my walks
let savedWalks = []; // saved from other people
let publicWalks = []; // public walks for the City
let plazaCells = [];
let homeWalk = null; // the walk shown on Journey's Home
let draftWalk = null; // recorded, not yet saved or discarded
const reportedIds = new Set();

const mine = (w) => Boolean(w) && routes.some((r) => r.id === w.id);
const isSaved = (w) => Boolean(w) && savedWalks.some((s) => s.id === w.id);
const listenSources = () =>
  routes.concat(savedWalks).filter((r) => r.audioUrl && r.nodes?.some((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
const othersFor = (w) => {
  const seen = new Set([w.id, ...routes.map((r) => r.id)]);
  const out = [];
  for (const o of savedWalks.concat(publicWalks)) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
};
function projectAll() {
  W.projectWalks(routes.concat(savedWalks, publicWalks).filter((w) => w.fromCloud));
}

// ─────────────────────────────────────────────
// Words
// ─────────────────────────────────────────────

function durationText(s) {
  const secs = Math.max(0, Math.round(s || 0));
  if (secs < 60) return `${secs} sec${secs === 1 ? "" : "s"}`;
  const m = Math.round(secs / 60);
  return `${m} min${m === 1 ? "" : "s"}`;
}
function timeOfDay(ms) {
  const h = new Date(ms).getHours();
  if (h >= 5 && h < 12) return "Morning";
  if (h >= 12 && h < 17) return "Afternoon";
  if (h >= 17 && h < 21) return "Evening";
  return "Night";
}
function clock(ms) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}
function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ─────────────────────────────────────────────
// Screens and navigation
// ─────────────────────────────────────────────

const screens = {}; // id → { el, show(params), hide() }
const stacks = { journey: [], city: [], mymap: [] };
let tab = "journey";
let current = null; // { id, params }

function screen(id, def) {
  screens[id] = { el: $(`s-${id}`), show: () => {}, hide: () => {}, ...def };
}

function transition(fromEl, toEl, how) {
  for (const el of [fromEl, toEl]) {
    if (!el) continue;
    el.classList.remove("enter-push", "leave-push", "enter-pop", "leave-pop", "enter-fade", "leave-fade");
  }
  toEl.hidden = false;
  if (fromEl === toEl) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!fromEl || how === "none" || reduce) {
    if (fromEl) fromEl.hidden = true;
    return;
  }
  toEl.classList.add(`enter-${how}`);
  fromEl.classList.add(`leave-${how}`);
  // Entering screen on top for push/fade; the leaving one on top for pop.
  toEl.style.zIndex = how === "pop" ? "1" : "2";
  fromEl.style.zIndex = how === "pop" ? "2" : "1";
  const done = () => {
    fromEl.classList.remove(`leave-${how}`);
    toEl.classList.remove(`enter-${how}`);
    if (current && screens[current.id]?.el !== fromEl) fromEl.hidden = true;
    fromEl.style.zIndex = "";
    toEl.style.zIndex = "";
  };
  setTimeout(done, how === "fade" ? 220 : 370);
}

function display(entry, how) {
  const prev = current;
  const prevScreen = prev && screens[prev.id];
  const next = screens[entry.id];
  if (prevScreen && prev !== entry) prevScreen.hide(prev.params || {}, entry);
  current = entry;
  next.show(entry.params || {}, prev);
  transition(prevScreen?.el, next.el, how);
}

/** Open a screen on top of the current tab. */
function go(id, params = {}, how = "push") {
  const entry = { id, params };
  stacks[tab].push(entry);
  display(entry, how);
}

/** Replace the current screen (same tab). */
function replace(id, params = {}, how = "fade") {
  const entry = { id, params };
  stacks[tab][stacks[tab].length - 1] = entry;
  display(entry, how);
}

/** Start a tab over from one screen. */
function resetTab(t, id, params = {}, how = "fade") {
  stacks[t] = [{ id, params }];
  if (t !== tab) tab = t;
  display(stacks[t][0], how);
}

function back() {
  const s = stacks[tab];
  if (s.length <= 1) return;
  s.pop();
  display(s[s.length - 1], "pop");
}

function switchTab(t) {
  // Home is shown once, right after saving; coming back to Journey starts over.
  if (t !== tab && tab === "journey" && stacks.journey.at(-1)?.id === "home") stacks.journey = [{ id: "intro" }];
  if (t === tab && stacks[t].length) {
    // Tapping the current tab goes back to its first screen.
    if (stacks[t].length > 1) {
      stacks[t] = [stacks[t][0]];
      display(stacks[t][0], "fade");
    }
    return;
  }
  tab = t;
  if (!stacks[t].length) stacks[t] = [{ id: rootOf(t) }];
  display(stacks[t][stacks[t].length - 1], "fade");
}

function rootOf(t) {
  if (t === "city") return "city";
  if (t === "mymap") return "mymap";
  return "intro";
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab-go]");
  if (t) {
    switchTab(t.dataset.tabGo);
    return;
  }
  if (e.target.closest("[data-back]")) back();
});

// ─────────────────────────────────────────────
// Toast, dialog, offline
// ─────────────────────────────────────────────

let toastTimer = null;
let toastUndo = null;
function toast(text, { undo = null, ms = 3000, delay = 0 } = {}) {
  const el = $("toast");
  clearTimeout(toastTimer);
  const showIt = () => {
    $("toastText").textContent = text;
    toastUndo = undo;
    $("toastUndo").hidden = !undo;
    el.hidden = false;
    el.classList.remove("sr-sink");
    el.classList.remove("sr-rise");
    void el.offsetWidth;
    el.classList.add("sr-rise");
    toastTimer = setTimeout(hideToast, undo ? 5000 : ms);
  };
  if (delay) toastTimer = setTimeout(showIt, delay);
  else showIt();
}
function hideToast() {
  const el = $("toast");
  if (el.hidden) return;
  el.classList.remove("sr-rise");
  el.classList.add("sr-sink");
  toastUndo = null;
  setTimeout(() => {
    if (el.classList.contains("sr-sink")) el.hidden = true;
  }, 300);
}
$("toastUndo").addEventListener("click", () => {
  const u = toastUndo;
  hideToast();
  u?.();
});

let dialogResolve = null;
function openVeil(onTap) {
  const v = $("veil");
  v.classList.remove("is-closing");
  v.hidden = false;
  v.onclick = onTap;
}
function closeVeil() {
  const v = $("veil");
  v.classList.add("is-closing");
  setTimeout(() => {
    v.hidden = true;
    v.classList.remove("is-closing");
  }, 300);
}
function closeLayer(el) {
  el.classList.remove("sr-rise");
  el.classList.add("sr-sink");
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove("sr-sink");
  }, 300);
}
/** A confirm dialog in the Blue style. Resolves true for the right-hand (black) button. */
function confirmDialog({ title, text, no = "Keep", yes }) {
  dialogResolve?.(false);
  $("dialogTitle").textContent = title;
  $("dialogText").textContent = text;
  $("dialogNo").textContent = no;
  $("dialogYes").textContent = yes;
  const d = $("dialog");
  openVeil(() => answer(false));
  d.hidden = false;
  d.classList.remove("sr-sink");
  d.classList.add("sr-rise");
  $("dialogNo").focus({ preventScroll: true });
  return new Promise((resolve) => {
    dialogResolve = resolve;
  });
  function answer(v) {
    finishDialog(v);
  }
}
function finishDialog(v) {
  const r = dialogResolve;
  dialogResolve = null;
  closeVeil();
  closeLayer($("dialog"));
  r?.(v);
}
$("dialogNo").addEventListener("click", () => finishDialog(false));
$("dialogYes").addEventListener("click", () => finishDialog(true));

function updateOnline() {
  $("offline").hidden = navigator.onLine !== false;
}
window.addEventListener("online", () => {
  updateOnline();
  retryUploads();
});
window.addEventListener("offline", updateOnline);

// ─────────────────────────────────────────────
// Short previews (City cards, found card, a walk you passed)
// ─────────────────────────────────────────────

const previewAudio = new Audio();
previewAudio.preload = "none";
previewAudio.playsInline = true;
let previewId = null;
let previewTimer = null;
let previewChanged = () => {};

async function togglePreview(walk, onChange = () => {}) {
  if (previewId === walk.id) {
    stopPreview();
    return;
  }
  stopPreview();
  previewId = walk.id;
  previewChanged = onChange;
  onChange(walk.id);
  try {
    let url = walk.audioUrl;
    if (!url || !url.startsWith("blob:")) {
      const c = await cloud();
      const urls = await c.signAudioUrls([walk.audioPath]);
      url = urls.get(walk.audioPath) || url;
    }
    if (!url) throw new Error("No audio for this walk");
    if (previewId !== walk.id) return;
    previewAudio.src = url;
    previewAudio.currentTime = 0;
    await previewAudio.play();
    previewTimer = setTimeout(stopPreview, PREVIEW_SECONDS * 1000);
  } catch (e) {
    log("[preview] failed", e?.message || e);
    if (previewId === walk.id) stopPreview();
    toast("Couldn’t play this walk. Try again.");
  }
}
function stopPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;
  const had = previewId;
  previewId = null;
  if (had) {
    // Fade out over 0.3 s rather than cutting.
    const a = previewAudio;
    const v0 = a.volume;
    let i = 0;
    const fade = setInterval(() => {
      i += 1;
      try {
        a.volume = Math.max(0, v0 * (1 - i / 6));
      } catch {
        // iPhone ignores volume
      }
      if (i >= 6) {
        clearInterval(fade);
        a.pause();
        try {
          a.volume = 1;
        } catch {
          // ignore
        }
      }
    }, 50);
    previewChanged(null);
  }
}
previewAudio.addEventListener("ended", stopPreview);

// ─────────────────────────────────────────────
// Guide
// ─────────────────────────────────────────────

const isStandalone = () => window.navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInAppBrowser = () => /FBAN|FBAV|Instagram|MicroMessenger|Line\/|GSA\//i.test(navigator.userAgent);

const guideTrack = document.querySelector(".guide-track");
let guideSingle = false;
function guidePages() {
  return [...guideTrack.querySelectorAll(".gpage")].filter((p) => !p.hidden);
}
function guideIndex() {
  return Math.round(guideTrack.scrollLeft / guideTrack.clientWidth);
}
function updateGuideChrome() {
  const pages = guidePages();
  const i = Math.min(pages.length - 1, guideIndex());
  [...$("guideDots").children].forEach((d, k) => {
    d.hidden = k >= pages.length;
    d.classList.toggle("on", k === i);
  });
  const last = pages[i]?.dataset.page === "4";
  $("guideNext").hidden = guideSingle || last;
  $("guideSkip").hidden = guideSingle;
  $("guideDots").hidden = guideSingle;
  $("guideBack").hidden = !guideSingle;
}
guideTrack.addEventListener("scroll", () => requestAnimationFrame(updateGuideChrome), { passive: true });
$("guideNext").addEventListener("click", () => {
  guideTrack.scrollTo({ left: (guideIndex() + 1) * guideTrack.clientWidth, behavior: "smooth" });
});
$("guideSkip").addEventListener("click", () => closeGuide());
$("guideBack").addEventListener("click", () => back());
function closeGuide(then = null) {
  writeFlag("soundroute-guide", "seen");
  if (then === "city") {
    stacks.journey = [{ id: rootOf("journey") }];
    resetTab("city", "city");
  } else if (then === "code") {
    stacks.journey = [{ id: rootOf("journey") }];
    resetTab("city", "city", { openCode: true });
  } else {
    resetTab("journey", rootOf("journey"));
  }
}
guideTrack.addEventListener("click", (e) => {
  const c = e.target.closest(".choice");
  if (!c) return;
  if (c.dataset.go === "record") {
    writeFlag("soundroute-guide", "seen");
    stacks.journey = [{ id: rootOf("journey") }];
    tab = "journey";
    startFlow();
  } else closeGuide(c.dataset.go);
});

screen("guide", {
  show(p) {
    guideSingle = Boolean(p.single);
    const steps = isIOS() && !isInAppBrowser() ? "safari" : "other";
    guideTrack.querySelectorAll("[data-steps]").forEach((ol) => (ol.hidden = ol.dataset.steps !== steps));
    for (const page of guideTrack.querySelectorAll(".gpage")) {
      const n = page.dataset.page;
      page.hidden = guideSingle ? n !== "3" : n === "3" && isStandalone();
    }
    guideTrack.style.overflowX = guideSingle ? "hidden" : "";
    guideTrack.scrollLeft = 0;
    updateGuideChrome();
  },
});

// ─────────────────────────────────────────────
// Journey: Intro
// ─────────────────────────────────────────────

screen("intro", {
  show() {
    const waiting = routes.filter((r) => r.cloud === "failed" || r.cloud === "pending").length;
    const el = $("introPending");
    el.hidden = waiting === 0;
    el.textContent = `${plural(waiting, "walk")} waiting to upload`;
  },
});
$("introPending").addEventListener("click", () => retryUploads());
$("startBtn").addEventListener("click", () => startFlow());
$("introTitle").addEventListener("click", () => startFlow());
$("justListenBtn").addEventListener("click", () => startListening());

// ─────────────────────────────────────────────
// Before you walk (permissions)
// ─────────────────────────────────────────────

let permsFor = "walk"; // "walk" | "listen"

/** Start a walk. Must run straight from a tap (iPhone permissions). */
function startFlow() {
  stopPreview();
  if (readFlag("soundroute-perms") !== "granted") {
    permsFor = "walk";
    go("perms", { for: "walk" });
    return;
  }
  askAndGo("walk");
}

screen("perms", {
  show(p) {
    permsFor = p.for || "walk";
    const listen = permsFor === "listen";
    $("permsLead").textContent = listen
      ? "Your phone will ask twice. Allow both so you can hear the walks around you."
      : "Your phone will ask three times. Allow all three so your walk can be heard later.";
    document.querySelector('[data-perm="mic"]').hidden = listen;
    $("permsGo").textContent = listen ? "Allow and listen" : "Allow and start";
    for (const li of document.querySelectorAll("[data-perm]")) {
      li.classList.remove("is-ok", "is-off");
      const note = li.querySelector(".perm-note");
      note.textContent = note.dataset.note;
    }
  },
});
$("permsGo").addEventListener("click", () => askAndGo(permsFor));

function markPerm(name, value) {
  const li = document.querySelector(`[data-perm="${name}"]`);
  if (!li) return;
  li.classList.toggle("is-ok", value === "granted");
  li.classList.toggle("is-off", value === "denied");
  const ic = li.querySelector(".perm-icon");
  if (value === "granted") ic.innerHTML = icon("check");
  const note = li.querySelector(".perm-note");
  note.textContent = value === "denied" ? "Turned off. Allow it in Settings › Safari, then come back." : note.dataset.note;
}

async function askAndGo(what) {
  // The motion request inside requestPermissions() must be the first thing
  // this tap does; unlocking audio output comes right after.
  const asking = W.requestPermissions({ mic: what === "walk" });
  W.player.unlock();
  const r = await asking;
  const onPerms = current?.id === "perms";
  if (onPerms) {
    markPerm("motion", r.motion);
    if (what === "walk") markPerm("mic", r.mic);
    markPerm("location", r.location);
  }
  const blocked = (what === "walk" && r.mic === "denied") || r.location === "denied";
  if (blocked) {
    if (!onPerms) go("perms", { for: what });
    setTimeout(() => {
      markPerm("motion", r.motion);
      if (what === "walk") markPerm("mic", r.mic);
      markPerm("location", r.location);
      $("permsGo").textContent = "Try again";
    }, 0);
    return;
  }
  writeFlag("soundroute-perms", "granted");
  if (r.motion === "denied") log("[perm] no motion: volume follows distance only");
  if (what === "walk") {
    W.setListening(true);
    W.startSensing();
    if (onPerms) setTimeout(() => replace("gps", {}, "push"), 450);
    else go("gps", {}, "fade");
  } else {
    if (listenSources().length === 0) {
      switchTab("mymap");
      return;
    }
    W.setListening(true);
    if (onPerms) replace("listen", { mode: "live" }, "push");
    else go("listen", { mode: "live" }, "fade");
  }
}

// ─────────────────────────────────────────────
// Finding you (GPS)
// ─────────────────────────────────────────────

let gpsTimer = null;
let gpsWaiting = false;
screen("gps", {
  show() {
    $("gpsCore").classList.remove("is-found");
    $("gpsAnyway").hidden = true;
    $("gpsNote").textContent = "Step outside for a moment. Recording starts as soon as GPS finds you.";
    gpsWaiting = true;
    clearTimeout(gpsTimer);
    if (W.hasGoodFix()) {
      setTimeout(gpsFound, 300);
      return;
    }
    gpsTimer = setTimeout(() => {
      if (!gpsWaiting) return;
      $("gpsNote").textContent = "Still looking. You can start anyway and we’ll place your walk once GPS finds you.";
      $("gpsAnyway").hidden = false;
    }, GPS_PATIENCE_MS);
  },
  hide() {
    gpsWaiting = false;
    clearTimeout(gpsTimer);
  },
});
function gpsFound() {
  if (!gpsWaiting) return;
  gpsWaiting = false;
  clearTimeout(gpsTimer);
  $("gpsCore").classList.add("is-found");
  setTimeout(beginRecording, 650);
}
$("gpsAnyway").addEventListener("click", () => {
  gpsWaiting = false;
  beginRecording();
});
$("gpsCancel").addEventListener("click", () => {
  gpsWaiting = false;
  W.setListening(false);
  W.stopSensing();
  W.releaseMicrophone();
  resetTab("journey", rootOf("journey"), {}, "pop");
});

function beginRecording() {
  try {
    W.startRecording();
  } catch (e) {
    log("[rec] could not start", e?.message || e);
    toast("Couldn’t start recording. Try again.");
    W.setListening(false);
    resetTab("journey", rootOf("journey"));
    return;
  }
  replace("walking", {}, "fade");
}

// ─────────────────────────────────────────────
// Walking
// ─────────────────────────────────────────────

screen("walking", {
  show() {
    const orb = $("walkOrb");
    orb.classList.remove("sr-in", "is-paused");
    void orb.offsetWidth;
    orb.classList.add("sr-in");
    updateWalking();
  },
});
function updateWalking() {
  const p = W.recordedSeconds() / W.MAX_WALK_SECONDS;
  $("micArc").setAttribute("stroke-dasharray", `${(p * 182.2).toFixed(1)} 182.2`);
  const paused = W.state.paused;
  const mic = $("micBtn");
  mic.setAttribute("aria-pressed", String(!paused));
  mic.setAttribute("aria-label", paused ? "Paused, tap to keep recording" : "Recording, tap to pause");
  $("walkOrb").classList.toggle("is-paused", paused);
}
$("micBtn").addEventListener("click", () => {
  if (W.state.paused) W.resumeRecording();
  else W.pauseRecording();
  updateWalking();
});
$("endBtn").addEventListener("click", () => finishWalk(false));

let finishing = false;
async function finishWalk(atLimit) {
  if (finishing || !W.state.recording) return;
  if (!atLimit && W.recordedSeconds() < SHORT_WALK_SECONDS) {
    const discard = await confirmDialog({
      title: "Too short to keep",
      text: "Walks shorter than 10 seconds can’t be heard later.",
      no: "Keep walking",
      yes: "Discard",
    });
    if (!discard || !W.state.recording) return;
    finishing = true;
    const w = await W.stopRecording();
    W.setListening(false);
    if (w?.audioUrl) URL.revokeObjectURL(w.audioUrl);
    finishing = false;
    resetTab("journey", rootOf("journey"));
    return;
  }
  finishing = true;
  const walk = W.currentWalk();
  // Start the Ending at once; the recorder hands over its audio meanwhile.
  draftWalk = walk;
  replace("walk", { walk, mode: "new", ending: true }, "none");
  const done = await W.stopRecording();
  W.setListening(false);
  finishing = false;
  if (!done?.audioBlob || done.audioBlob.size === 0) {
    draftWalk = null;
    toast("No sound was recorded, so this walk wasn’t kept.");
    resetTab("journey", rootOf("journey"));
    return;
  }
  done.cloud = "draft";
  // Kept on the phone straight away, so closing the page can't lose it.
  savePendingWalk(pendingRecord(done)).catch((e) => log("[store] could not keep the draft", e?.message || e));
  if (current?.id === "walk" && current.params.walk === done) renderWalkScreen(current.params, { keepEnding: true });
}

function pendingRecord(w) {
  return {
    id: w.id,
    name: w.name,
    createdAt: w.createdAt,
    durationS: w.durationS,
    audioMime: w.audioMime,
    audioBlob: w.audioBlob,
    nodes: w.nodes.map(({ id, t, timestamp, stepCount, heading, x, y, lat, lng, uncertaintyM }) => ({
      id, t, timestamp, stepCount, heading, x, y, lat, lng, uncertaintyM,
    })),
  };
}

// ─────────────────────────────────────────────
// A walk in the orb: Ending → Mine, My walk, Other
// ─────────────────────────────────────────────

let walkParams = null;
let renaming = false;

screen("walk", {
  show(p) {
    renderWalkScreen(p);
  },
  hide(p) {
    if (renaming) commitRename();
    stopPreview();
    clearTimeout(renderWalkScreen.endTimer);
    if (p) p.ending = false;
    $("s-walk").classList.remove("is-ending");
  },
});

function walkMeta(w, mode) {
  if (mode === "other") return `${timeOfDay(w.createdAt)}<br><br>${durationText(w.durationS)}`;
  let when = mode === "new" ? clock(w.createdAt) : `${dayLabel(w.createdAt)}, ${clock(w.createdAt)}`;
  if (when.length > 13) when = when.replace(", ", ",<br>"); // the panel is 148 px wide
  const dur = w.durationS != null ? durationText(w.durationS) : durationText(W.recordedSeconds());
  return `${when}<br><br>${dur}`;
}

function renderWalkScreen(p, { keepEnding = false } = {}) {
  walkParams = p;
  renaming = false;
  const w = p.walk;
  const mode = p.mode;
  const sec = $("s-walk");
  const stillDrawing = keepEnding && sec.classList.contains("is-ending");
  if (p.ending && !keepEnding) {
    sec.classList.remove("is-ending");
    void sec.offsetWidth;
    sec.classList.add("is-ending");
    clearTimeout(renderWalkScreen.endTimer);
    renderWalkScreen.endTimer = setTimeout(() => {
      sec.classList.remove("is-ending");
      p.ending = false;
    }, 9600);
  } else if (!p.ending) {
    sec.classList.remove("is-ending");
  }

  // Orb and route
  const ctx = p.context || null; // { walk, selectedId } when opened from a dot on another walk
  const base = ctx?.walk || w;
  const layout = layoutWalk(base, othersFor(base), { trim: !base.fromCloud });
  if (!stillDrawing) renderOrbRoute($("walkRoute"), layout, {
    selectedId: ctx?.selectedId ?? null,
    animate: Boolean(p.ending) && !keepEnding,
    onPass: mode === "other" ? null : (o) => openOther(o, { walk: base, selectedId: o.id }),
  });
  if (mode === "other" && ctx && !stillDrawing) {
    // Tap the orange dot to hear 20 seconds.
    const sel = $("walkRoute").querySelector(".orb-dot.is-selected");
    const pass = layout?.passes.find((x) => x.walk.id === ctx.selectedId);
    if (sel && pass) {
      const hit = document.createElement("button");
      hit.type = "button";
      hit.className = "orb-hit";
      hit.setAttribute("aria-label", `Listen to ${w.name}`);
      hit.style.cssText = `left:${(pass.x - 22).toFixed(1)}px;top:${(pass.y - 22).toFixed(1)}px`;
      hit.addEventListener("click", () => togglePreview(w, (id) => sel.classList.toggle("is-previewing", id === w.id)));
      $("walkRoute").appendChild(hit);
    }
  }

  // Panel
  $("renameBox").hidden = true;
  $("renameHint").hidden = true;
  $("walkTitle").hidden = false;
  $("walkTitleBtn").textContent = w.name || "New Walk";
  $("walkTitleBtn").disabled = mode === "other";
  $("penBtn").hidden = mode === "other";
  $("walkAuthor").hidden = mode !== "other";
  $("walkMeta").innerHTML = walkMeta(w, mode);

  // Sharing (My walk)
  const share = mode === "mine" && w.cloud === "saved" && w.shareCode;
  $("walkShare").hidden = !share;
  if (share) {
    $("publicSwitch").setAttribute("aria-checked", String(Boolean(w.isPublic)));
    $("publicNote").textContent = w.isPublic ? "On: shown in the City, near its area" : "Off: only people with the code can add it.";
    $("shareCode").textContent = w.shareCode;
    $("copyBtn").textContent = "Copy";
  }
  const status = $("walkStatus");
  status.hidden = true;
  if (mode === "mine" && w.cloud !== "saved") {
    status.hidden = false;
    status.textContent =
      w.cloud === "uploading" || w.cloud === "pending"
        ? "Uploading…"
        : w.cloud === "device"
          ? "No GPS during this walk, so it stays on this phone."
          : "Not uploaded yet. Tap to retry";
  } else if (mode === "mine" && w.hidden) {
    status.hidden = false;
    status.textContent = "Hidden for review";
  }

  // Corner link and main button
  const corner = $("walkCorner");
  $("walkReported").hidden = true;
  corner.hidden = false;
  corner.disabled = false;
  $("walkSave").hidden = mode !== "new";
  $("walkHeart").hidden = mode !== "other";
  $("walkPlay").hidden = mode !== "mine";
  if (mode === "new") {
    corner.textContent = "Discard";
    $("walkSave").disabled = !w.audioBlob && finishing;
  } else if (mode === "mine") {
    corner.textContent = "Delete";
    $("walkPlay").setAttribute("aria-label", `Play ${w.name}`);
  } else {
    corner.textContent = "Report";
    if (reportedIds.has(w.id)) {
      corner.hidden = true;
      $("walkReported").hidden = false;
    }
    setHeart(isSaved(w));
  }
}

function setHeart(on) {
  const h = $("walkHeart");
  h.setAttribute("aria-pressed", String(on));
  h.setAttribute("aria-label", on ? "Remove from My map" : "Save to My map");
}

function openOther(walk, context = null) {
  stopPreview();
  go("walk", { walk, mode: "other", context });
}

$("skipEnding").addEventListener("click", () => {
  const sec = $("s-walk");
  sec.classList.remove("is-ending");
  if (walkParams) walkParams.ending = false;
  clearTimeout(renderWalkScreen.endTimer);
});

$("walkBack").addEventListener("click", () => {
  if (walkParams?.mode === "new") saveDraft();
  else back();
});
$("walkSave").addEventListener("click", () => saveDraft());
$("walkTitleBtn").addEventListener("click", () => startRename());
$("penBtn").addEventListener("click", () => startRename());

$("walkCorner").addEventListener("click", async () => {
  const p = walkParams;
  if (!p) return;
  if (renaming) {
    commitRename();
    return;
  }
  if (p.mode === "new") {
    const yes = await confirmDialog({
      title: "Discard this walk?",
      text: "The recording and the route will be deleted from this phone. This can’t be undone.",
      yes: "Discard",
    });
    if (yes) discardDraft();
  } else if (p.mode === "mine") {
    deleteWalkFlow(p.walk);
  } else {
    openReport(p.walk);
  }
});

async function saveDraft() {
  const w = draftWalk;
  if (!w) {
    resetTab("journey", rootOf("journey"));
    return;
  }
  if (renaming) commitRename();
  if (!w.audioBlob) {
    toast("Still finishing the recording…");
    return;
  }
  draftWalk = null;
  routes = routes.filter((r) => r.id !== w.id);
  routes.unshift(w);
  homeWalk = w;
  resetTab("journey", "home", {}, "fade");
  keepAndUpload(w);
}

async function discardDraft() {
  const w = draftWalk;
  draftWalk = null;
  if (w) {
    deletePendingWalk(w.id).catch(() => {});
    if (w.audioUrl?.startsWith("blob:")) URL.revokeObjectURL(w.audioUrl);
  }
  resetTab("journey", rootOf("journey"), {}, "fade");
}

// Rename in place
function startRename() {
  const p = walkParams;
  if (!p || p.mode === "other" || renaming) return;
  renaming = true;
  const input = $("renameInput");
  input.value = p.walk.name || "";
  $("walkTitle").hidden = true;
  $("penBtn").hidden = true;
  $("renameBox").hidden = false;
  $("renameHint").hidden = false;
  $("walkCorner").textContent = "Done";
  autosize();
  input.focus();
  input.select();
}
function autosize() {
  const input = $("renameInput");
  input.style.height = "39px";
  input.style.height = `${Math.min(195, input.scrollHeight)}px`;
  $("walkCorner").disabled = !input.value.trim();
}
$("renameInput").addEventListener("input", () => {
  const input = $("renameInput");
  if (input.value.includes("\n")) {
    input.value = input.value.replace(/\n/g, "");
    commitRename();
    return;
  }
  autosize();
});
$("renameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    commitRename();
  } else if (e.key === "Escape") {
    commitRename(true);
  }
});
$("renameInput").addEventListener("blur", () => {
  // Leaving the field without Done keeps what was typed.
  setTimeout(() => {
    if (renaming && document.activeElement !== $("renameInput")) commitRename();
  }, 150);
});

async function commitRename(cancel = false) {
  if (!renaming) return;
  renaming = false;
  const p = walkParams;
  const w = p.walk;
  const typed = $("renameInput").value.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  $("renameInput").blur();
  const old = w.name;
  if (!cancel && typed && typed !== old) {
    w.name = typed;
    if (w.cloud === "saved") {
      try {
        const c = await cloud();
        await c.updateWalk(w.id, { name: typed });
      } catch (e) {
        w.name = old;
        toast("Couldn’t rename. Try again.");
        log("[cloud] rename failed", e?.message || e);
      }
    } else if (w.audioBlob) {
      savePendingWalk(pendingRecord(w)).catch(() => {});
    }
  }
  if (current?.id === "walk" && walkParams === p) renderWalkScreen(p, { keepEnding: true });
}

// Heart, report, share, delete
$("walkHeart").addEventListener("click", async () => {
  const w = walkParams?.walk;
  if (!w) return;
  const was = isSaved(w);
  setHeart(!was);
  try {
    if (was) await unsave(w);
    else await save(w);
    toast(was ? "Removed from My map" : "Saved to My map");
  } catch (e) {
    log("[cloud] save failed", e?.message || e);
    setHeart(was);
    toast("Couldn’t save. Try again.");
  }
});

async function save(w) {
  const c = await cloud();
  // By code when we have it: that also works for walks shared privately.
  if (w.shareCode) await c.saveByCode(w.shareCode);
  else await c.saveWalk(w.id);
  await refreshSavedWalks();
}
async function unsave(w) {
  const c = await cloud();
  await c.unsaveWalk(w.id);
  savedWalks = savedWalks.filter((s) => s.id !== w.id);
  W.walksChanged();
  renderMyMapIfShown();
}

$("publicSwitch").addEventListener("click", async () => {
  const w = walkParams?.walk;
  if (!w) return;
  const on = !w.isPublic;
  w.isPublic = on;
  renderWalkScreen(walkParams, { keepEnding: true });
  try {
    const c = await cloud();
    await c.updateWalk(w.id, { isPublic: on });
    plazaStale = true;
  } catch (e) {
    w.isPublic = !on;
    renderWalkScreen(walkParams, { keepEnding: true });
    toast("Couldn’t change this walk. Try again.");
  }
});
$("copyBtn").addEventListener("click", async () => {
  const w = walkParams?.walk;
  if (!w?.shareCode) return;
  try {
    await navigator.clipboard.writeText(w.shareCode);
  } catch {
    // Clipboard blocked: select the code so it can be copied by hand.
    const range = document.createRange();
    range.selectNodeContents($("shareCode"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }
  $("copyBtn").textContent = "Copied";
  setTimeout(() => ($("copyBtn").textContent = "Copy"), 1500);
});
$("downloadBtn").addEventListener("click", () => downloadWalk(walkParams?.walk));
$("walkPlay").addEventListener("click", () => {
  const w = walkParams?.walk;
  if (w) playDirect(w);
});
$("walkStatus").addEventListener("click", () => {
  const w = walkParams?.walk;
  if (w && w.cloud === "failed") uploadWalkNow(w);
});

async function deleteWalkFlow(w) {
  if (w.cloud === "uploading") {
    toast("Still uploading. Try again in a moment.");
    return;
  }
  let n = null;
  if (w.cloud === "saved") {
    try {
      n = await (await cloud()).saveCount(w.id);
    } catch {
      n = null;
    }
  }
  const text = n
    ? `It will also disappear from the My map of ${plural(n, "person", "people")} who saved it. This can’t be undone.`
    : "The recording and the route will be deleted. This can’t be undone.";
  const yes = await confirmDialog({ title: "Delete this walk?", text, yes: "Delete" });
  if (!yes) return;
  try {
    if (w.cloud === "saved" || w.audioPath) {
      try {
        await (await cloud()).deleteWalk(w);
      } catch (e) {
        if (w.cloud === "saved") throw e;
        log("[cloud] cleanup of an unfinished upload failed", e?.message || e);
      }
    }
    await deletePendingWalk(w.id).catch(() => {});
  } catch (e) {
    toast("Couldn’t delete this walk. Try again.");
    log("[cloud] delete failed", e?.message || e);
    return;
  }
  if (w.audioUrl?.startsWith("blob:")) URL.revokeObjectURL(w.audioUrl);
  routes = routes.filter((r) => r.id !== w.id);
  if (homeWalk?.id === w.id) homeWalk = routes[0] || null;
  if (w.isPublic) plazaStale = true;
  W.walksChanged();
  log("[route] deleted", w.name);
  stacks.journey = [{ id: rootOf("journey") }];
  back();
  toast("Walk deleted");
}

function sanitize(s) {
  return String(s || "walk").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "walk";
}
function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function downloadWalk(w) {
  if (!w) return;
  const base = sanitize(w.name);
  try {
    let url = w.audioUrl;
    if (!url?.startsWith("blob:")) {
      const res = await fetch(url);
      url = URL.createObjectURL(await res.blob());
    }
    const m = (w.audioMime || "").toLowerCase();
    const ext = m.includes("webm") ? "webm" : m.includes("ogg") ? "ogg" : "m4a";
    triggerDownload(url, `${base}.${ext}`);
  } catch (e) {
    log("[download] audio failed", e?.message || e);
  }
  const coords = w.nodes.filter((n) => Number.isFinite(n.lat)).map((n) => [n.lng, n.lat]);
  const geo = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { name: w.name, createdAt: new Date(w.createdAt).toISOString(), seconds: w.durationS }, geometry: { type: "LineString", coordinates: coords } }],
  };
  const blob = new Blob([JSON.stringify(geo)], { type: "application/geo+json" });
  setTimeout(() => triggerDownload(URL.createObjectURL(blob), `${base}.geojson`), 400);
}

// Report
let reportWalkTarget = null;
function openReport(w) {
  reportWalkTarget = w;
  const sheet = $("reportSheet");
  sheet.reset();
  $("reportSend").disabled = true;
  openVeil(closeReport);
  sheet.hidden = false;
  sheet.classList.remove("sr-sink");
  sheet.classList.add("sr-rise");
}
function closeReport() {
  closeVeil();
  closeLayer($("reportSheet"));
}
$("reportSheet").addEventListener("change", () => {
  $("reportSend").disabled = !$("reportSheet").querySelector("input:checked");
});
$("reportCancel").addEventListener("click", closeReport);
$("reportSheet").addEventListener("submit", async (e) => {
  e.preventDefault();
  const w = reportWalkTarget;
  const reason = $("reportSheet").querySelector("input:checked")?.value;
  if (!w || !reason) return;
  $("reportSend").disabled = true;
  try {
    const result = await (await cloud()).reportWalk(w.id, reason);
    reportedIds.add(w.id);
    closeReport();
    if (current?.id === "walk" && walkParams?.walk === w) renderWalkScreen(walkParams, { keepEnding: true });
    toast(result === "already" ? "You already reported this walk." : "Report sent. We’ll review it.", { delay: 300 });
  } catch (err) {
    $("reportSend").disabled = false;
    const msg = err?.message || String(err);
    log("[cloud] report failed", msg);
    closeReport();
    toast(/daily limit/i.test(msg) ? "You’ve sent a lot of reports today. Try again tomorrow." : "Couldn’t send the report. Try again.", { delay: 300 });
  }
});

// ─────────────────────────────────────────────
// Home (after saving)
// ─────────────────────────────────────────────

screen("home", {
  show() {
    renderHome();
  },
});
function renderHome() {
  const w = homeWalk;
  if (!w) return;
  $("homeTitle").textContent = w.name;
  const layout = layoutWalk(w, othersFor(w), { trim: !w.fromCloud });
  renderOrbRoute($("homeRoute"), layout, { onPass: (o) => openOther(o, { walk: w, selectedId: o.id }) });
  const st = $("homeStatus");
  st.hidden = false;
  if (w.cloud === "uploading" || w.cloud === "pending") st.textContent = "Saving…";
  else if (w.cloud === "failed") st.textContent = "Not uploaded yet. Tap to retry";
  else if (w.cloud === "device") st.textContent = "No GPS during this walk, so it stays on this phone.";
  else st.hidden = true;
}
$("homeTitle").addEventListener("click", () => {
  if (homeWalk) go("walk", { walk: homeWalk, mode: "mine" });
});
$("homeStatus").addEventListener("click", () => {
  if (homeWalk?.cloud === "failed") uploadWalkNow(homeWalk);
});
$("homeAgain").addEventListener("click", () => startFlow());
$("homeOrbBtn").addEventListener("click", () => startFlow());

// ─────────────────────────────────────────────
// Listening
// ─────────────────────────────────────────────

let listenMode = null; // "live" | "direct"
let directWalk = null;

/** Just listen: from a tap (iPhone permissions). */
function startListening() {
  stopPreview();
  if (listenSources().length === 0 && routes.length + savedWalks.length === 0) {
    switchTab("mymap");
    return;
  }
  if (readFlag("soundroute-perms") !== "granted") {
    go("perms", { for: "listen" });
    return;
  }
  askAndGo("listen");
}

/** Play one walk from the start, wherever you are. From a tap. */
function playDirect(w) {
  stopPreview();
  W.player.unlock();
  go("listen", { mode: "direct", walk: w });
}

screen("listen", {
  show(p) {
    listenMode = p.mode;
    directWalk = p.walk || null;
    $("listenHint").hidden = listenMode !== "live";
    if (listenMode === "direct") {
      W.setListening(false);
      W.player.play(directWalk, 0, 1);
      showHearing(directWalk, { direct: true });
    } else {
      showHearing(W.state.hearingId ? listenSources().find((x) => x.id === W.state.hearingId) : null);
    }
  },
  hide() {
    if (listenMode === "live") W.setListening(false);
    else W.player.stop();
    listenMode = null;
    directWalk = null;
  },
});

function describeSource(w) {
  if (mine(w)) return `A walk you recorded in the ${timeOfDay(w.createdAt).toLowerCase()}`;
  return `A walk you saved, recorded in the ${timeOfDay(w.createdAt).toLowerCase()}`;
}
let shownHearingId;
function showHearing(w, { direct = false, ended = false } = {}) {
  const id = w?.id ?? null;
  const title = $("listenTitle");
  const sub = $("listenSub");
  const orb = $("listenOrb");
  const apply = () => {
    if (w) {
      title.textContent = w.name;
      sub.textContent = ended ? "Played to the end" : describeSource(w).replace(" in the night", " at night");
    } else {
      title.textContent = "Nothing nearby yet";
      sub.textContent = "Walk toward a walk on your map";
    }
    title.classList.remove("is-swapping");
    sub.classList.remove("is-swapping");
  };
  orb.classList.toggle("is-quiet", !w || ended);
  if (shownHearingId === undefined || (shownHearingId === id && !ended)) {
    shownHearingId = id;
    apply();
    return;
  }
  shownHearingId = id;
  title.classList.add("is-swapping");
  sub.classList.add("is-swapping");
  setTimeout(apply, 400);
  if (direct) orb.style.transform = "";
}
$("listenStop").addEventListener("click", () => back());

// ─────────────────────────────────────────────
// City
// ─────────────────────────────────────────────

let cityMap = null;
let plazaStale = true;
let cityArea = null; // { cell, walks, index }
let cityMe = null;
let codeState = null; // { id, walk, wasSaved, confirmed }

screen("city", {
  show(p) {
    if (!cityMap) {
      cityMap = new CityMap($("cityMap"), {
        onTapCell: (cell) => {
          if (!codeState && $("codeSheet").hidden) openArea(cell);
        },
        onTapRoute: (id) => scrollToCard($("areaCards"), cityArea?.walks.findIndex((w) => w.id === id) ?? -1),
        onTapEmpty: () => {},
      });
      cityMap.setAnchor(stageW / 2, stageH * 0.5);
    }
    if (!cityArea && !codeState) setCityChrome("browse");
    loadCity();
    if (p.openCode) {
      p.openCode = false;
      openCodeSheet(p.code || "");
    }
  },
  hide() {
    stopPreview();
  },
});

function setCityChrome(state) {
  const browse = state === "browse";
  const area = state === "area";
  const found = state === "found";
  $("cityArea").hidden = !area;
  $("foundCard").hidden = !found;
  $("foundBack").hidden = !found;
  $("addCodeBtn").hidden = found;
  document.querySelector("#s-city .nav").hidden = !browse;
  $("cityMap").classList.toggle("is-faded", state === "code");
  $("s-city").querySelector(".city-head").style.opacity = found ? "0.35" : "";
}

function myPlace() {
  const here = W.hereLatLng();
  if (here) {
    cityMe = here;
    return Promise.resolve(here);
  }
  if (cityMe) return Promise.resolve(cityMe);
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cityMe = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve(cityMe);
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 },
    );
  });
}

const cellKey = (lat, lng) => `${Math.floor(lat / PLAZA_CELL.lat)}:${Math.floor(lng / PLAZA_CELL.lng)}`;
const cellCentre = (lat, lng) => ({
  lat: (Math.floor(lat / PLAZA_CELL.lat) + 0.5) * PLAZA_CELL.lat,
  lng: (Math.floor(lng / PLAZA_CELL.lng) + 0.5) * PLAZA_CELL.lng,
});
function walkCentre(w) {
  if (Number.isFinite(w.centerLat) && Number.isFinite(w.centerLng)) return { lat: w.centerLat, lng: w.centerLng };
  const pts = w.nodes.filter((n) => Number.isFinite(n.lat));
  if (!pts.length) return null;
  return { lat: pts.reduce((s, n) => s + n.lat, 0) / pts.length, lng: pts.reduce((s, n) => s + n.lng, 0) / pts.length };
}
function distM(a, b) {
  const D = Math.PI / 180;
  const x = (b.lng - a.lng) * D * Math.cos(((a.lat + b.lat) / 2) * D);
  const y = (b.lat - a.lat) * D;
  return Math.hypot(x, y) * 6371008.8;
}

let cityLoading = null;
async function loadCity() {
  const me = await myPlace();
  cityMap.setMe(me, { grey: Boolean(codeState) });
  if (!plazaStale) {
    renderCitySummary(me);
    return;
  }
  if (cityLoading) return cityLoading;
  $("citySummary").textContent = "Looking around…";
  cityLoading = (async () => {
    try {
      const c = await cloud();
      const [cells, walks] = await Promise.all([c.loadPlazaCells(), c.loadPublicWalks()]);
      plazaCells = cells;
      publicWalks = walks.map((w) => ({ ...w, fromCloud: true }));
      projectAll();
      plazaStale = false;
      cityMap.setCells(plazaCells);
      setCityRoutes();
      if (me) cityMap.centreOn(me, 440);
      else if (plazaCells.length) cityMap.fit(plazaCells, { minAcrossM: 440 });
      renderCitySummary(me);
      log("[plaza] loaded", { cells: cells.length, walks: walks.length });
    } catch (e) {
      $("citySummary").textContent = "Couldn’t load the City. Check your connection.";
      log("[plaza] load failed", e?.message || e);
    } finally {
      cityLoading = null;
    }
  })();
  return cityLoading;
}

function setCityRoutes() {
  // Only a stretch inside each light is drawn, never a whole walk.
  cityMap.setRoutes(publicWalks, {
    clipTo: (w) => {
      const c = walkCentre(w);
      return c ? { ...cellCentre(c.lat, c.lng), radiusM: 170 } : null;
    },
  });
}

function renderCitySummary(me) {
  let n;
  if (me) n = plazaCells.filter((c) => distM(me, c) <= NEARBY_M).reduce((s, c) => s + c.walks, 0);
  else n = plazaCells.reduce((s, c) => s + c.walks, 0);
  $("citySummary").textContent = me ? `${plural(n, "walk")} nearby` : `${plural(n, "public walk")}`;
  $("cityEmpty").hidden = n > 0 || Boolean(cityArea) || Boolean(codeState) || !$("codeSheet").hidden;
}
$("cityEmptyCode").addEventListener("click", () => openCodeSheet());

// Area: the walks in one light
async function openArea(cell) {
  stopPreview();
  const key = cellKey(cell.lat, cell.lng);
  let walks = publicWalks.filter((w) => {
    const c = walkCentre(w);
    return c && cellKey(c.lat, c.lng) === key;
  });
  if (!walks.length) {
    try {
      walks = await (await cloud()).loadPlazaCellWalks(cell);
      walks = walks.map((w) => ({ ...w, nodes: [], fromCloud: true }));
    } catch (e) {
      log("[plaza] cell load failed", e?.message || e);
      toast("Couldn’t load these walks. Try again.");
      return;
    }
  }
  if (!walks.length) return;
  cityArea = { cell, walks, index: 0 };
  setCityChrome("area");
  $("cityEmpty").hidden = true;
  $("areaCount").textContent = `${plural(walks.length, "walk")} here`;
  $("areaCount").className = "t-sub area-count sr-up";
  $("areaCount").style.animationDelay = "0.4s";
  renderCards($("areaCards"), walks, "city");
  renderDots($("areaDots"), walks.length, 0);
  $("areaDots").className = "page-dots centred sr-up";
  $("areaDots").style.animationDelay = "0.9s";
  cityMap.setFocus({ ids: new Set(walks.map((w) => w.id)), selected: walks[0].id });
  // Keep the light above the cards.
  cityMap.setAnchor(stageW / 2, Math.min(stageH * 0.5, stageH - 380));
  cityMap.centreOn(cell, 460, { animate: true });
}
function closeArea() {
  stopPreview();
  cityArea = null;
  cityMap.setFocus(null);
  cityMap.setAnchor(stageW / 2, stageH * 0.5);
  setCityChrome("browse");
  renderCitySummary(cityMe);
}
$("areaBack").addEventListener("click", closeArea);

// Cards (City area and My map)
function renderCards(container, walks, kind) {
  container.replaceChildren();
  walks.forEach((w, i) => {
    const card = document.createElement("div");
    card.className = `card${i === 0 ? " is-current" : ""}${kind === "city" && i < 4 ? " sr-up" : ""}`;
    if (kind === "city" && i < 4) card.style.animationDelay = `${(0.55 + i * 0.1).toFixed(2)}s`;
    card.setAttribute("role", "listitem");
    card.dataset.id = w.id;
    let meta;
    if (kind === "mine") meta = `${dayLabel(w.createdAt)}, ${durationText(w.durationS)}`;
    else if (kind === "saved" && w.isPublic === false) meta = `Shared with you, ${durationText(w.durationS)}`;
    else meta = `${timeOfDay(w.createdAt)}, ${durationText(w.durationS)}`;
    card.innerHTML = `
      <button type="button" class="card-open" aria-label="Open ${escapeHtml(w.name)}"></button>
      <div class="card-meta"><span class="card-dot" aria-hidden="true"></span>${escapeHtml(meta)}</div>
      <div class="card-title">${escapeHtml(w.name)}</div>`;
    if (kind === "mine") {
      const st = cardState(w);
      const el = document.createElement(st.retry ? "button" : "span");
      el.className = "card-state";
      if (st.retry) el.type = "button";
      el.innerHTML = `${st.icon ? icon(st.icon) : ""}${escapeHtml(st.text)}`;
      if (st.retry) el.addEventListener("click", () => uploadWalkNow(w));
      card.appendChild(el);
    } else if (kind === "saved") {
      const heart = document.createElement("button");
      heart.type = "button";
      heart.className = "card-heart";
      heart.setAttribute("aria-label", `Remove ${w.name} from My map`);
      heart.setAttribute("aria-pressed", "true");
      heart.innerHTML = icon("heart-sm");
      heart.addEventListener("click", () => removeSavedCard(w, card));
      card.appendChild(heart);
    }
    const play = document.createElement("button");
    play.type = "button";
    play.className = "circle-56 card-play";
    play.setAttribute("aria-label", `Listen to ${w.name}`);
    play.innerHTML = icon("play");
    if (kind === "city") {
      play.addEventListener("click", () =>
        togglePreview(w, (id) => {
          card.classList.toggle("is-playing", id === w.id);
          play.innerHTML = icon(id === w.id ? "stop" : "play");
          play.setAttribute("aria-label", id === w.id ? `Stop ${w.name}` : `Listen to ${w.name}`);
        }),
      );
    } else {
      play.addEventListener("click", () => playDirect(w));
    }
    card.appendChild(play);
    card.querySelector(".card-open").addEventListener("click", () => {
      if (kind === "mine") go("walk", { walk: w, mode: "mine" });
      else openOther(w);
    });
    container.appendChild(card);
  });
  container.scrollLeft = 0;
}

function cardState(w) {
  if (w.cloud === "uploading" || w.cloud === "pending") return { text: "Uploading…" };
  if (w.cloud === "failed") return { text: "Not uploaded · Retry", retry: true };
  if (w.cloud === "device") return { text: "On this phone only" };
  if (w.hidden) return { text: "Hidden for review" };
  return w.isPublic ? { icon: "globe", text: "Public" } : { icon: "lock", text: "Private" };
}

function renderDots(el, n, i) {
  el.innerHTML = n > 1 ? Array.from({ length: Math.min(n, 12) }, (_, k) => `<span class="${k === i ? "on" : ""}"></span>`).join("") : "";
}

function cardIndex(container) {
  return Math.max(0, Math.round(container.scrollLeft / 262));
}
function scrollToCard(container, i) {
  if (i < 0) return;
  container.scrollTo({ left: i * 262, behavior: "smooth" });
}
function onCarousel(container, handler) {
  let last = -1;
  container.addEventListener(
    "scroll",
    () => {
      const i = cardIndex(container);
      if (i === last) return;
      last = i;
      [...container.children].forEach((c, k) => c.classList.toggle("is-current", k === i));
      handler(i);
    },
    { passive: true },
  );
}
onCarousel($("areaCards"), (i) => {
  if (!cityArea) return;
  cityArea.index = i;
  renderDots($("areaDots"), cityArea.walks.length, i);
  cityMap.setFocus({ ids: new Set(cityArea.walks.map((w) => w.id)), selected: cityArea.walks[i]?.id });
});

// Add a walk by code
$("addCodeBtn").addEventListener("click", () => {
  if (!$("codeSheet").hidden) closeCodeSheet();
  else openCodeSheet();
});
function openCodeSheet(prefill = "") {
  if (cityArea) closeArea();
  setCityChrome("code");
  $("cityEmpty").hidden = true;
  $("addCodeBtn").textContent = "Cancel";
  $("codeVeil").hidden = false;
  const sheet = $("codeSheet");
  sheet.hidden = false;
  sheet.classList.remove("sr-sink");
  sheet.classList.add("sr-rise");
  const input = $("codeInput");
  input.value = prefill;
  resetCodeError();
  setTimeout(() => input.focus(), 60);
  if (prefill) setTimeout(() => sheet.requestSubmit(), 300);
}
function closeCodeSheet() {
  $("codeInput").blur();
  $("addCodeBtn").textContent = "Add code";
  $("codeVeil").hidden = true;
  closeLayer($("codeSheet"));
  setCityChrome("browse");
  renderCitySummary(cityMe);
}
$("codeVeil").addEventListener("click", closeCodeSheet);
function resetCodeError() {
  $("codeInput").classList.remove("is-wrong", "sr-shake");
  const hint = $("codeHint");
  hint.classList.remove("is-error");
  hint.textContent = "Codes look like misty-parrot-0417. A walk added by code stays private to you.";
}
$("codeInput").addEventListener("input", () => {
  const input = $("codeInput");
  const pos = input.selectionStart;
  const clean = input.value.toLowerCase().replace(/\s/g, "-");
  if (clean !== input.value) {
    input.value = clean;
    input.setSelectionRange(pos, pos);
  }
  resetCodeError();
});
function codeError(text) {
  const input = $("codeInput");
  input.classList.remove("sr-shake");
  void input.offsetWidth;
  input.classList.add("is-wrong", "sr-shake");
  const hint = $("codeHint");
  hint.classList.add("is-error");
  hint.textContent = text;
}
$("codeSheet").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("codeInput").value.trim();
  if (!code) {
    codeError("Type a share code first.");
    return;
  }
  const btn = $("codeAdd");
  if (btn.classList.contains("is-busy")) return;
  btn.classList.add("is-busy");
  try {
    const c = await cloud();
    const before = new Set(savedWalks.map((w) => w.id));
    const id = await c.saveByCode(code);
    if (routes.some((r) => r.id === id)) {
      codeError("That’s one of your own walks. It’s already on your map.");
      return;
    }
    await refreshSavedWalks();
    const walk = savedWalks.find((w) => w.id === id);
    if (!walk) {
      codeError("No walk has this code. Check the spelling and try again.");
      return;
    }
    codeState = { id, walk, wasSaved: before.has(id), confirmed: before.has(id) };
    showFound();
  } catch (err) {
    const msg = err?.message || String(err);
    log("[code] lookup failed", msg);
    if (/no walk/i.test(msg)) codeError("No walk has this code. Check the spelling and try again.");
    else codeError("Couldn’t check the code. Check your connection and try again.");
  } finally {
    btn.classList.remove("is-busy");
  }
});

function showFound() {
  const { walk, wasSaved } = codeState;
  $("codeInput").blur();
  $("codeVeil").hidden = true;
  closeLayer($("codeSheet"));
  $("addCodeBtn").textContent = "Add code";
  setCityChrome("found");
  $("foundMeta").textContent = walk.isPublic ? `${timeOfDay(walk.createdAt)}, ${durationText(walk.durationS)}` : `Shared with you, ${durationText(walk.durationS)}`;
  $("foundCard").querySelector('[data-icon="lock"]').hidden = Boolean(walk.isPublic);
  $("foundTitle").textContent = walk.name;
  $("foundCode").textContent = walk.shareCode || "";
  const saveBtn = $("foundSave");
  saveBtn.disabled = wasSaved;
  saveBtn.querySelector(".label").textContent = wasSaved ? "On your map ✓" : "Save to My map";
  saveBtn.querySelector("[data-icon]").hidden = wasSaved;
  const card = $("foundCard");
  card.classList.remove("sr-rise");
  void card.offsetWidth;
  card.classList.add("sr-rise");
  // The route, where it is.
  cityMap.setRoutes([walk]);
  cityMap.setFocus({ ids: new Set([walk.id]), selected: walk.id });
  cityMap.setMe(cityMe, { grey: true });
  const pts = walk.nodes.filter((n) => Number.isFinite(n.lat));
  if (pts.length) {
    cityMap.setAnchor(stageW / 2, Math.min(stageH * 0.42, stageH - 360));
    cityMap.fit(pts, { minAcrossM: 360, animate: true, pad: 1.4 });
  }
}
async function leaveFound(keep) {
  const s = codeState;
  codeState = null;
  stopPreview();
  if (s && !keep && !s.wasSaved) {
    // Only looked: take it back off the map.
    try {
      await unsave(s.walk);
    } catch (e) {
      log("[code] could not undo the tentative save", e?.message || e);
    }
  }
  setCityRoutes();
  cityMap.setFocus(null);
  cityMap.setAnchor(stageW / 2, stageH * 0.5);
  cityMap.setMe(cityMe, { grey: false });
  if (cityMe) cityMap.centreOn(cityMe, 440, { animate: true });
  setCityChrome("browse");
  renderCitySummary(cityMe);
}
$("foundBack").addEventListener("click", () => leaveFound(false));
$("foundPlay").addEventListener("click", () => {
  const w = codeState?.walk;
  if (!w) return;
  togglePreview(w, (id) => {
    $("foundPlay").innerHTML = icon(id === w.id ? "stop" : "play");
  });
});
$("foundSave").addEventListener("click", async () => {
  if (!codeState) return;
  codeState.confirmed = true;
  await leaveFound(true);
  mymapSegment = "saved";
  resetTab("mymap", "mymap");
  toast("Saved to My map");
});

// ─────────────────────────────────────────────
// My map
// ─────────────────────────────────────────────

let myMap = null;
let mymapSegment = "mine";

screen("mymap", {
  show() {
    if (!myMap) {
      myMap = new CityMap($("myMap"), {
        onTapRoute: (id) => {
          const list = segmentWalks();
          scrollToCard($("myCards"), list.findIndex((w) => w.id === id));
        },
        onTapCell: () => {},
      });
      myMap.setAnchor(stageW / 2, stageH * 0.45);
    }
    renderMyMap();
  },
  hide() {
    stopPreview();
  },
});

function segmentWalks() {
  return mymapSegment === "mine" ? routes : savedWalks;
}
function renderMyMapIfShown() {
  if (current?.id === "mymap") renderMyMap();
}
function renderMyMap() {
  const empty = routes.length === 0 && savedWalks.length === 0;
  $("mymapEmpty").hidden = !empty;
  $("emptyMe").hidden = !empty;
  $("mymapList").hidden = empty;
  $("myMap").hidden = empty;
  const yours = routes.length === 1 ? "1 walk of yours" : `${routes.length} of your walks`;
  $("mymapSummary").textContent = empty ? "" : `${yours}, ${savedWalks.length} saved`;
  if (empty) return;
  if (mymapSegment === "mine" && !routes.length) mymapSegment = "saved";
  if (mymapSegment === "saved" && !savedWalks.length && routes.length) mymapSegment = "mine";
  $("segMine").textContent = `Mine ${routes.length}`;
  $("segSaved").textContent = `Saved ${savedWalks.length}`;
  $("segMine").setAttribute("aria-selected", String(mymapSegment === "mine"));
  $("segSaved").setAttribute("aria-selected", String(mymapSegment === "saved"));
  const list = segmentWalks();
  renderCards($("myCards"), list, mymapSegment);
  // The map: a light where each walk is, its route on top.
  const cells = new Map();
  for (const w of list) {
    const c = walkCentre(w);
    if (!c) continue;
    const cc = cellCentre(c.lat, c.lng);
    const k = cellKey(c.lat, c.lng);
    cells.set(k, { ...cc, walks: (cells.get(k)?.walks || 0) + 1 });
  }
  myMap.setCells([...cells.values()].map((c) => ({ ...c, walks: Math.max(2, c.walks * 2) })));
  myMap.setRoutes(list.map((w) => ({ id: w.id, nodes: w.fromCloud ? w.nodes : trimLatLng(w.nodes) })));
  myMap.setMe(W.hereLatLng() || cityMe);
  focusMyCard(0, false);
}
function trimLatLng(nodes) {
  // Walks recorded on this phone still have their first 30 m: leave it out here too.
  const pts = nodes.filter((n) => Number.isFinite(n.lat));
  let along = 0;
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    if (i) along += distM(pts[i - 1], pts[i]);
    if (along >= 30) out.push(pts[i]);
  }
  return out.length >= 2 ? out : pts.slice(-2);
}
function focusMyCard(i, animate = true) {
  const list = segmentWalks();
  const w = list[i];
  if (!w) return;
  myMap.setFocus({ ids: new Set(list.map((x) => x.id)), selected: w.id });
  const pts = w.nodes.filter((n) => Number.isFinite(n.lat));
  if (pts.length) myMap.fit(pts, { minAcrossM: 420, animate, pad: 1.6 });
}
onCarousel($("myCards"), (i) => focusMyCard(i));
$("segMine").addEventListener("click", () => {
  mymapSegment = "mine";
  renderMyMap();
});
$("segSaved").addEventListener("click", () => {
  mymapSegment = "saved";
  renderMyMap();
});
$("accountBtn").addEventListener("click", () => go("account"));
$("emptyRecord").addEventListener("click", () => {
  tab = "journey";
  stacks.journey = [{ id: rootOf("journey") }];
  startFlow();
});
$("emptyCity").addEventListener("click", () => switchTab("city"));

async function removeSavedCard(w, card) {
  card.classList.add("is-leaving");
  try {
    await unsave(w);
  } catch (e) {
    card.classList.remove("is-leaving");
    toast("Couldn’t remove it. Try again.");
    return;
  }
  toast("Removed from My map", {
    undo: async () => {
      try {
        await save(w);
        renderMyMapIfShown();
      } catch {
        toast("Couldn’t save. Try again.");
      }
    },
  });
}

// ─────────────────────────────────────────────
// Your account
// ─────────────────────────────────────────────

let accountMode = "link"; // "link" | "signin"
let accountEmail = "";
let resendTimer = null;
let resendAt = 0;

screen("account", {
  show() {
    renderAccount();
  },
  hide() {
    clearInterval(resendTimer);
  },
});

async function renderAccount(state = null) {
  let email = null;
  try {
    email = await (await sb()).linkedEmail();
  } catch {
    email = null;
  }
  const s = state || (email ? "linked" : "anon");
  $("accAnon").hidden = s !== "anon";
  $("accSent").hidden = s !== "sent";
  $("accLinked").hidden = s !== "linked";
  $("accRows").hidden = s !== "anon";
  $("accResend").hidden = s !== "sent";
  $("homeScreenRow").hidden = isStandalone();
  $("accWarn").hidden = !(s === "anon" && accountMode === "signin" && routes.length > 0);
  if (s === "linked") $("linkedTitle").textContent = `Linked to ${email}`;
  if (s === "anon") {
    const signin = accountMode === "signin";
    $("accAnonTitle").textContent = signin ? "Sign in on this phone" : "Anonymous on this phone";
    $("accAnonNote").textContent = signin
      ? "Use the email you linked on the phone that has your walks. We’ll send you a link."
      : "Safari can clear a website’s data after a week without a visit. Link an email to keep your walks and use them on another phone.";
    $("emailSubmit").textContent = signin ? "Send sign-in link" : "Link email";
    $("signInRowText").textContent = signin ? "Link this phone to an email instead" : "Sign in with an email you linked before";
    if (accountEmail) $("emailInput").value = accountEmail;
  }
  if (s === "sent") {
    $("sentNote").textContent = `We sent a link to ${accountEmail}. Open it on this phone, in Safari.`;
    $("otpInput").value = "";
    $("otpInput").classList.remove("is-wrong", "sr-shake");
    $("otpError").hidden = true;
    tickResend();
  }
}

$("signInRow").addEventListener("click", () => {
  accountMode = accountMode === "signin" ? "link" : "signin";
  $("emailError").hidden = true;
  $("emailInput").classList.remove("is-wrong");
  renderAccount("anon");
});
$("homeScreenRow").addEventListener("click", () => go("guide", { single: true }));
$("emailInput").addEventListener("input", () => {
  $("emailError").hidden = true;
  $("emailInput").classList.remove("is-wrong");
});
$("accAnon").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("emailInput").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $("emailInput").classList.add("is-wrong");
    $("emailError").hidden = false;
    return;
  }
  const btn = $("emailSubmit");
  btn.disabled = true;
  try {
    const s = await sb();
    if (accountMode === "signin") await s.sendSignIn(email);
    else await s.linkEmail(email);
    accountEmail = email;
    resendAt = Date.now() + 60000;
    renderAccount("sent");
  } catch (err) {
    log("[account] send failed", err?.message || err);
    toast(/no account/i.test(err?.message || "") ? "No account with that email." : "Couldn’t send the email. Try again.");
  } finally {
    btn.disabled = false;
  }
});

function tickResend() {
  clearInterval(resendTimer);
  const el = $("accResend");
  const draw = () => {
    const left = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    if (left > 0) {
      el.innerHTML = `You can resend in 0:${String(left).padStart(2, "0")}. <button type="button" data-acc="different">Use a different email</button>`;
    } else {
      clearInterval(resendTimer);
      el.innerHTML = `<button type="button" data-acc="resend">Resend email</button>. <button type="button" data-acc="different">Use a different email</button>`;
    }
  };
  draw();
  resendTimer = setInterval(draw, 1000);
}
$("accResend").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-acc]");
  if (!b) return;
  if (b.dataset.acc === "different") {
    clearInterval(resendTimer);
    renderAccount("anon");
    return;
  }
  try {
    const s = await sb();
    if (accountMode === "signin") await s.sendSignIn(accountEmail);
    else await s.linkEmail(accountEmail);
    resendAt = Date.now() + 60000;
    tickResend();
    toast("Email sent again");
  } catch {
    toast("Couldn’t send the email. Try again.");
  }
});
$("otpInput").addEventListener("input", () => {
  const input = $("otpInput");
  input.value = input.value.replace(/\D/g, "").slice(0, 6);
  input.classList.remove("is-wrong");
  $("otpError").hidden = true;
  if (input.value.length === 6) $("accSent").requestSubmit();
});
$("accSent").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("otpInput").value.trim();
  if (code.length !== 6) return;
  $("otpConfirm").disabled = true;
  try {
    const s = await sb();
    if (accountMode === "signin") await s.confirmSignInCode(accountEmail, code);
    else await s.confirmLinkCode(accountEmail, code);
    clearInterval(resendTimer);
    if (accountMode === "signin") {
      toast("Signed in");
      setTimeout(() => location.reload(), 700);
      return;
    }
    await renderAccount("linked");
    toast("Email linked", { delay: 300 });
  } catch (err) {
    log("[account] code failed", err?.message || err);
    const input = $("otpInput");
    input.classList.remove("sr-shake");
    void input.offsetWidth;
    input.classList.add("is-wrong", "sr-shake");
    $("otpError").hidden = false;
  } finally {
    $("otpConfirm").disabled = false;
  }
});
$("signOutBtn").addEventListener("click", async () => {
  const yes = await confirmDialog({
    title: "Sign out?",
    text: "Your walks stay with this email. Sign in again to hear them.",
    yes: "Sign out",
  });
  if (!yes) return;
  try {
    await (await sb()).signOut();
  } catch (e) {
    toast("Couldn’t sign out. Try again.");
    return;
  }
  location.reload();
});

// ─────────────────────────────────────────────
// Walks: keep on the phone, upload, load
// ─────────────────────────────────────────────

const hasLocatedNodes = (w) => w.nodes.some((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng));

async function keepAndUpload(walk) {
  if (!hasLocatedNodes(walk)) {
    walk.cloud = "device";
    refreshViews();
    return;
  }
  walk.cloud = "pending";
  try {
    await savePendingWalk(pendingRecord(walk));
  } catch (e) {
    log("[store] could not keep walk on device", e?.message || e);
  }
  await uploadWalkNow(walk);
}

async function uploadWalkNow(walk) {
  walk.cloud = "uploading";
  refreshViews();
  try {
    const c = await cloud();
    const result = await c.uploadWalk(walk);
    walk.audioPath = result.audioPath;
    walk.shareCode = result.shareCode;
    walk.isPublic = result.isPublic;
    walk.cloud = "saved";
    await deletePendingWalk(walk.id).catch(() => {});
    log("[cloud] walk uploaded", walk.name, result.shareCode);
  } catch (e) {
    walk.cloud = "failed";
    log("[cloud] upload failed", e?.message || e);
  }
  refreshViews();
}

let retrying = false;
async function retryUploads() {
  if (retrying) return;
  retrying = true;
  try {
    for (const r of routes.filter((x) => x.cloud === "pending" || x.cloud === "failed")) await uploadWalkNow(r);
  } finally {
    retrying = false;
  }
}

/** Re-render whatever is on screen after walks changed. */
function refreshViews() {
  W.walksChanged();
  if (!current) return;
  if (current.id === "home") renderHome();
  else if (current.id === "intro") screens.intro.show();
  else if (current.id === "mymap") renderMyMap();
  else if (current.id === "walk" && walkParams && !renaming) renderWalkScreen(walkParams, { keepEnding: true });
}

async function refreshSavedWalks() {
  const c = await cloud();
  const saved = await c.loadSavedWalks();
  const myIds = new Set(routes.map((r) => r.id));
  const keep = new Map(savedWalks.map((w) => [w.id, w]));
  savedWalks = saved
    .filter((w) => !myIds.has(w.id))
    .map((w) => {
      const old = keep.get(w.id);
      return old?.audioUrl ? { ...w, audioUrl: old.audioUrl, fromCloud: true } : { ...w, fromCloud: true };
    });
  await refreshAudioUrls(c);
  projectAll();
  W.walksChanged();
  renderMyMapIfShown();
}

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
    if (pending.length) log("[store] walks waiting to upload:", pending.length);
  } catch (e) {
    log("[store] could not read walks on this device", e?.message || e);
  }
}

async function refreshAudioUrls(c) {
  const list = routes.concat(savedWalks).filter((r) => (r.cloud === "saved" || !mine(r)) && r.audioPath);
  if (!list.length) return;
  const urls = await c.signAudioUrls(list.map((r) => r.audioPath));
  for (const r of list) {
    const url = urls.get(r.audioPath);
    if (url) r.audioUrl = url;
  }
}

async function loadMyWalks() {
  const c = await cloud();
  const mineList = await c.loadMyWalks();
  for (const w of mineList) {
    if (routes.some((r) => r.id === w.id)) continue;
    routes.push({ ...w, cloud: "saved", fromCloud: true });
  }
  try {
    const saved = await c.loadSavedWalks();
    const myIds = new Set(routes.map((r) => r.id));
    savedWalks = saved.filter((w) => !myIds.has(w.id)).map((w) => ({ ...w, fromCloud: true }));
  } catch (e) {
    log("[cloud] could not load saved walks", e?.message || e);
  }
  await refreshAudioUrls(c);
  routes.sort((a, b) => b.createdAt - a.createdAt);
  projectAll();
  log("[cloud] my walks loaded:", mineList.length, "saved:", savedWalks.length);
  refreshViews();
  setInterval(() => refreshAudioUrls(c).catch((e) => log("[cloud] could not renew audio links", e?.message || e)), 40 * 60 * 1000);
  await retryUploads();
}

async function connectCloud() {
  try {
    const { ensureVisitor, checkDatabase } = await sb();
    const visitor = await ensureVisitor();
    log("[cloud] signed in", visitor.id, visitor.is_anonymous ? "(anonymous)" : "");
    const visible = await checkDatabase();
    log("[cloud] database ok, visible walks:", visible);
    await loadMyWalks();
  } catch (err) {
    log("[cloud] error", err?.message || String(err));
  }
}

// ─────────────────────────────────────────────
// Engine hooks
// ─────────────────────────────────────────────

let changeQueued = false;
W.hooks.log = log;
W.hooks.listenSources = listenSources;
W.hooks.onChange = () => {
  if (changeQueued) return;
  changeQueued = true;
  requestAnimationFrame(() => {
    changeQueued = false;
    if (current?.id === "walking") updateWalking();
  });
};
W.hooks.onFix = (fix, firstAnchor) => {
  if (firstAnchor) projectAll();
  if (fix?.used && gpsWaiting && current?.id === "gps") gpsFound();
};
W.hooks.onLimit = () => finishWalk(true);
W.hooks.onHear = (h) => {
  if (current?.id === "listen" && listenMode === "live") showHearing(h?.walk || null);
};
const innerEnded = W.player.onEnded;
W.player.onEnded = (id) => {
  innerEnded?.(id);
  if (current?.id === "listen" && listenMode === "direct" && directWalk?.id === id) showHearing(directWalk, { ended: true });
};
// The orb follows how loud the walk is.
setInterval(() => {
  if (current?.id !== "listen") return;
  const orb = $("listenOrb");
  if (listenMode === "live" && W.state.hearingId) orb.style.transform = `scale(${(0.95 + 0.15 * (W.state.gain || 0)).toFixed(3)})`;
  else if (!orb.classList.contains("is-quiet")) orb.style.transform = "";
}, 300);

// Keep the screen on while walking or listening.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    // not allowed here
  }
}
setInterval(() => keepAwake(W.state.recording || W.state.listening || current?.id === "listen"), 2000);

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────

fillIcons();
document.querySelectorAll("[data-nav]").forEach((el) => {
  el.outerHTML = navHtml(el.dataset.nav);
});
fitStage();
updateOnline();
navigator.storage?.persist?.().catch(() => {});

const params = new URLSearchParams(location.search);
const sharedCode = params.get("code");
if (sharedCode) {
  writeFlag("soundroute-guide", "seen");
  stacks.journey = [{ id: "intro" }];
  resetTab("city", "city", { openCode: true, code: sharedCode.toLowerCase() }, "none");
} else if (readFlag("soundroute-guide") !== "seen") {
  stacks.journey = [{ id: "guide" }];
  display(stacks.journey[0], "none");
} else {
  resetTab("journey", "intro", {}, "none");
}

loadPendingWalks().then(() => {
  projectAll();
  refreshViews();
  connectCloud();
});
log("[init] SoundRoute Blue loaded");
