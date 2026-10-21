// Supabase connection for SoundRoute.
// The publishable key is meant to live in front-end code: what each visitor can
// read or change is enforced by the database rules in supabase/soundroute.sql.
// Never put a secret / service_role key in this file.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL = "https://saqgoppqmkaxteysteds.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_FGKjyJLHlS60YX5-WRCKBQ_7G887ARV";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "soundroute-auth",
  },
});

/**
 * Returns the current visitor, signing them in anonymously the first time.
 * The anonymous identity is kept in this browser; it can later be upgraded
 * to an email / Apple / Google account without losing walks.
 */
export async function ensureVisitor() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    if (/anonymous/i.test(error.message)) {
      throw new Error(
        "Anonymous sign-in is turned off. In Supabase: Authentication → Sign In / Providers → Allow anonymous sign-ins.",
      );
    }
    throw error;
  }
  return data.user;
}

/**
 * Checks that the database tables from supabase/soundroute.sql exist and are
 * reachable with this visitor's permissions. Returns the number of walks the
 * visitor can currently see (their own, public ones and saved ones).
 */
export async function checkDatabase() {
  const { count, error } = await supabase.from("routes").select("id", { count: "exact", head: true });
  if (error) {
    if (error.code === "42P01" || /does not exist|schema cache/i.test(error.message)) {
      throw new Error("Database tables are missing. Run supabase/soundroute.sql in the Supabase SQL Editor.");
    }
    throw error;
  }
  return count ?? 0;
}
