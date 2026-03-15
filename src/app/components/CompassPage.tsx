import React from "react";

/**
 * Wraps the static compass game in a full-screen iframe.
 * Uses /compass.html (root-level static file) so Cloudflare serves it without SPA fallback.
 */
export function CompassPage() {
  return (
    <iframe
      src="/compass.html"
      title="Compass — Find the direction"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
      }}
    />
  );
}
