"use client";

import { GOOGLE_FONTS } from "./canvas-style";

const GOOGLE = new Set<string>(GOOGLE_FONTS);
const loaded = new Set<string>();

function addStylesheet(href: string) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/** Loads a Google Font the first time it is shown. System fonts need nothing. */
export function loadFont(name: string | undefined) {
  if (!name || !GOOGLE.has(name) || loaded.has(name) || typeof document === "undefined") return;
  loaded.add(name);
  addStylesheet(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}&display=swap`,
  );
}

let previews = false;

/**
 * Loads just the letters of each font's own name, so a picker can show every font in its
 * typeface for a few kilobytes instead of downloading every font in full.
 */
export function loadFontPreviews() {
  if (previews || typeof document === "undefined") return;
  previews = true;
  const families = GOOGLE_FONTS.map((f) => `family=${f.replace(/ /g, "+")}`).join("&");
  const letters = [...new Set(GOOGLE_FONTS.join(""))].join("");
  addStylesheet(
    `https://fonts.googleapis.com/css2?${families}&text=${encodeURIComponent(letters)}&display=swap`,
  );
}
