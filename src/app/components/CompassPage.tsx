import React from "react";

/**
 * Wraps the static compass game (public/compass/index.html) in a full-screen iframe.
 * Same pattern as find-me: the static HTML is served at /compass/index.html;
 * this route ensures /compass and /compass/ show it without relying on _redirects.
 */
export function CompassPage() {
  return (
    <iframe
      src="/compass/index.html"
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
