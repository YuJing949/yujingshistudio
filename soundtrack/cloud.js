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

/**
 * Uploads one walk: the route row, its audio file, then its track points.
 * Safe to retry: an already-created row or file is reused.
 * Returns { shareCode, audioPath }.
 */
export async function uploadWalk(walk) {
  const user = await ensureVisitor();
  const points = locatedNodes(walk);
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

/** The visitor's own walks, newest first, with their points. */
export async function loadMyWalks() {
  const user = await ensureVisitor();
  const { data, error } = await supabase
    .from("routes")
    .select("id, name, is_public, share_code, duration_s, audio_path, audio_mime, created_at, points(t, lat, lng, heading, accuracy)")
    .eq("owner", user.id)
    .not("audio_path", "is", null)
    .order("created_at", { ascending: false })
    .order("t", { referencedTable: "points", ascending: true });
  if (error) throw error;
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: Date.parse(r.created_at),
    durationS: r.duration_s,
    audioMime: r.audio_mime,
    audioPath: r.audio_path,
    isPublic: r.is_public,
    shareCode: r.share_code,
    nodes: r.points.map((p, i) => ({
      id: i + 1,
      t: p.t,
      lat: p.lat,
      lng: p.lng,
      heading: p.heading,
      uncertaintyM: p.accuracy,
    })),
  }));
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
