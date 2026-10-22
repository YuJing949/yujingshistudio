// Walks in the cloud (Supabase): upload, load, delete, audio links.
// Tables and access rules: supabase/soundroute.sql.

import { supabase, ensureVisitor } from "./supabase.js";

const AUDIO_BUCKET = "route-audio";
const SIGNED_URL_SECONDS = 60 * 60;

function audioExtension(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg")) return "mp3";
  if (m.includes("wav")) return "wav";
  return "m4a"; // Safari records AAC in an MP4 container
}

function baseMime(mime) {
  return (mime || "audio/mp4").split(";")[0].trim() || "audio/mp4";
}

/** Nodes with a real location (recorded after the first GPS fix). */
export function locatedNodes(walk) {
  return (walk.nodes || []).filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng));
}

const PRIVATE_START_M = 30;

function metresBetween(a, b) {
  const D = Math.PI / 180;
  const dLat = (b.lat - a.lat) * D;
  const dLng = (b.lng - a.lng) * D;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Leave out the first stretch of a walk (30 m, or a third of a short walk) so
 * where someone set off from — often home — is never stored or shared.
 */
export function withoutPrivateStart(points) {
  if (points.length < 3) return points;
  const along = [0];
  for (let i = 1; i < points.length; i += 1) along.push(along[i - 1] + metresBetween(points[i - 1], points[i]));
  const cut = Math.min(PRIVATE_START_M, along.at(-1) / 3);
  const kept = points.filter((_, i) => along[i] >= cut);
  return kept.length >= 2 ? kept : points.slice(-2);
}

/**
 * Uploads one walk: the route row, its audio file, then its track points.
 * Safe to retry: an already-created row or file is reused.
 * Returns { shareCode, audioPath }.
 */
export async function uploadWalk(walk) {
  const user = await ensureVisitor();
  const points = withoutPrivateStart(locatedNodes(walk));
  if (points.length === 0) throw new Error("This walk has no GPS positions, so it can't be placed on the map.");

  const centerLat = points.reduce((s, n) => s + n.lat, 0) / points.length;
  const centerLng = points.reduce((s, n) => s + n.lng, 0) / points.length;
  const audioPath = `${user.id}/${walk.id}.${audioExtension(walk.audioMime)}`;
  // Remembered before uploading, so a failed attempt can still be cleaned up.
  walk.audioPath = audioPath;

  // 1. Route row (without the audio path yet, so nobody can request a missing file).
  const { data: row, error: rowError } = await supabase
    .from("routes")
    .upsert(
      {
        id: walk.id,
        name: (walk.name || "Untitled walk").slice(0, 80),
        duration_s: Math.min(330, Math.round(walk.durationS * 10) / 10),
        audio_mime: baseMime(walk.audioMime),
        center_lat: centerLat,
        center_lng: centerLng,
      },
      { onConflict: "id" },
    )
    .select("share_code, is_public")
    .single();
  if (rowError) throw rowError;

  // 2. Audio file.
  // No upsert: overwriting needs extra storage permissions. If an interrupted
  // earlier attempt already stored the file, "already exists" is fine.
  const { error: uploadError } = await supabase.storage.from(AUDIO_BUCKET).upload(audioPath, walk.audioBlob, {
    contentType: baseMime(walk.audioMime),
    upsert: false,
  });
  if (uploadError && !/exists|duplicate/i.test(uploadError.message || "") && uploadError.statusCode !== "409") {
    throw uploadError;
  }

  const { error: pathError } = await supabase.from("routes").update({ audio_path: audioPath }).eq("id", walk.id);
  if (pathError) throw pathError;

  // 3. Track points (replace any from an earlier, interrupted attempt).
  const { error: clearError } = await supabase.from("points").delete().eq("route_id", walk.id);
  if (clearError) throw clearError;
  const { error: pointsError } = await supabase.from("points").insert(
    points.map((n) => ({
      route_id: walk.id,
      t: Math.max(0, Math.round(n.t * 10) / 10),
      lat: n.lat,
      lng: n.lng,
      heading: Number.isFinite(n.heading) ? Math.round(n.heading) : null,
      accuracy: Number.isFinite(n.uncertaintyM) ? Math.round(n.uncertaintyM * 10) / 10 : null,
    })),
  );
  if (pointsError) throw pointsError;

  return { shareCode: row.share_code, isPublic: row.is_public, audioPath };
}

const WALK_COLUMNS =
  "id, name, is_public, hidden, share_code, duration_s, audio_path, audio_mime, created_at, points(t, lat, lng, heading, accuracy)";

function toWalk(r) {
  return {
    id: r.id,
    name: r.name,
    createdAt: Date.parse(r.created_at),
    durationS: r.duration_s,
    audioMime: r.audio_mime,
    audioPath: r.audio_path,
    isPublic: r.is_public,
    hidden: Boolean(r.hidden),
    shareCode: r.share_code,
    nodes: (r.points || [])
      .slice()
      .sort((a, b) => a.t - b.t)
      .map((p, i) => ({ id: i + 1, t: p.t, lat: p.lat, lng: p.lng, heading: p.heading, uncertaintyM: p.accuracy })),
  };
}

/** Walks the visitor saved from other people, newest save first. */
export async function loadSavedWalks() {
  const user = await ensureVisitor();
  const { data, error } = await supabase
    .from("saves")
    .select(`created_at, routes(${WALK_COLUMNS})`)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data
    .filter((s) => s.routes && s.routes.audio_path)
    .map((s) => ({ ...toWalk(s.routes), savedAt: Date.parse(s.created_at) }));
}

/** Save a public walk (from the plaza). */
export async function saveWalk(routeId) {
  const user = await ensureVisitor();
  const { error } = await supabase.from("saves").insert({ user_id: user.id, route_id: routeId });
  if (error && error.code !== "23505") throw error; // 23505: already saved
}

/** Save any walk, public or private, by its share code. Returns the walk id. */
export async function saveByCode(code) {
  await ensureVisitor();
  const clean = String(code || "").trim().toLowerCase();
  if (!clean) throw new Error("Type a share code first.");
  const { data, error } = await supabase.rpc("save_by_code", { code: clean });
  if (error) {
    if (/no walk/i.test(error.message || "")) throw new Error(`No walk found for “${clean}”.`);
    throw error;
  }
  return data;
}

export async function unsaveWalk(routeId) {
  const user = await ensureVisitor();
  const { error } = await supabase.from("saves").delete().eq("user_id", user.id).eq("route_id", routeId);
  if (error) throw error;
}

/** Rename and/or make public/private one of your own walks. */
export async function updateWalk(routeId, changes) {
  const patch = {};
  if (typeof changes.name === "string") patch.name = changes.name.trim().slice(0, 80) || "Untitled walk";
  if (typeof changes.isPublic === "boolean") patch.is_public = changes.isPublic;
  const { error } = await supabase.from("routes").update(patch).eq("id", routeId);
  if (error) throw error;
}

/** Report a walk someone else made. Three reports hide it for review. */
export async function reportWalk(routeId, reason) {
  const user = await ensureVisitor();
  const { error } = await supabase
    .from("reports")
    .insert({ route_id: routeId, reporter: user.id, reason: reason ? String(reason).slice(0, 300) : null });
  if (error) {
    if (error.code === "23505") return "already";
    throw error;
  }
  return "reported";
}

// ─────────────────────────────────────────────
// City plaza
// ─────────────────────────────────────────────

/** Same ~200 m grid as get_plaza_cells() in supabase/soundroute.sql. */
export const PLAZA_CELL = { lat: 0.0018, lng: 0.0029 };

/** [{ lat, lng, walks }] — public walks counted per grid cell. */
export async function loadPlazaCells() {
  const { data, error } = await supabase.rpc("get_plaza_cells");
  if (error) throw error;
  return (data || []).map((c) => ({ lat: Number(c.lat), lng: Number(c.lng), walks: Number(c.walks) }));
}

/** Public walks inside one grid cell (newest first), without their points. */
export async function loadPlazaCellWalks(cell) {
  const lat0 = cell.lat - PLAZA_CELL.lat / 2;
  const lng0 = cell.lng - PLAZA_CELL.lng / 2;
  const { data, error } = await supabase
    .from("routes")
    .select("id, name, duration_s, audio_path, created_at")
    .eq("is_public", true)
    .not("audio_path", "is", null)
    .gte("center_lat", lat0)
    .lt("center_lat", lat0 + PLAZA_CELL.lat)
    .gte("center_lng", lng0)
    .lt("center_lng", lng0 + PLAZA_CELL.lng)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    durationS: r.duration_s,
    audioPath: r.audio_path,
    createdAt: Date.parse(r.created_at),
  }));
}

/** The visitor's own walks, newest first, with their points. */
export async function loadMyWalks() {
  const user = await ensureVisitor();
  const { data, error } = await supabase
    .from("routes")
    .select(WALK_COLUMNS)
    .eq("owner", user.id)
    .not("audio_path", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(toWalk);
}

/** Short-lived playable links for walks' audio files: Map(path → url). */
export async function signAudioUrls(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) throw error;
  return new Map(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

export const SIGNED_URL_LIFETIME_MS = SIGNED_URL_SECONDS * 1000;

/** Deletes a walk everywhere: its audio file, then its row (points and saves go with it). */
export async function deleteWalk(walk) {
  if (walk.audioPath) {
    const { error: fileError } = await supabase.storage.from(AUDIO_BUCKET).remove([walk.audioPath]);
    if (fileError) throw fileError;
  }
  const { error } = await supabase.from("routes").delete().eq("id", walk.id);
  if (error) throw error;
}
