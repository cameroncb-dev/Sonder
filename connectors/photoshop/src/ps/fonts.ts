import { app } from "photoshop";

export interface InstalledFont {
  postScriptName: string;
  family: string;
  style: string;
}

let cache: Map<string, InstalledFont> | undefined;

/** Installed fonts keyed by PostScript name. Cached for the panel session. */
export function installedFonts(refresh = false): Map<string, InstalledFont> {
  if (cache && !refresh) return cache;
  const fonts = new Map<string, InstalledFont>();
  const collection = app.fonts;
  for (let i = 0; i < collection.length; i++) {
    const font = collection[i];
    if (!font) continue;
    fonts.set(font.postScriptName, {
      postScriptName: font.postScriptName,
      family: font.family,
      style: font.style,
    });
  }
  cache = fonts;
  return fonts;
}
