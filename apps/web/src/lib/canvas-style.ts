import { z } from "zod";

/**
 * Styles for canvas-only cards (notes, text, sections). Shared by the API, which validates
 * saved content, and the canvas UI, which renders and edits it.
 */

export const NOTE_SHAPES = ["square", "rounded", "circle", "diamond"] as const;
export type NoteShape = (typeof NOTE_SHAPES)[number];
export const NOTE_SHAPE_LABELS: Record<NoteShape, string> = {
  square: "Sticky",
  rounded: "Rounded",
  circle: "Circle",
  diamond: "Diamond",
};

export const COLORS = ["yellow", "orange", "pink", "green", "blue", "purple", "grey"] as const;
export type CanvasColor = (typeof COLORS)[number];

/** Fill, border and text classes per color, readable in light and dark themes. */
export const COLOR_STYLES: Record<
  CanvasColor,
  { fill: string; border: string; swatch: string; tint: string }
> = {
  yellow: {
    fill: "bg-yellow-100 text-yellow-950 dark:bg-yellow-900/60 dark:text-yellow-50",
    border: "border-yellow-300 dark:border-yellow-700",
    swatch: "bg-yellow-300",
    tint: "bg-yellow-200/25 border-yellow-400/60",
  },
  orange: {
    fill: "bg-orange-100 text-orange-950 dark:bg-orange-900/60 dark:text-orange-50",
    border: "border-orange-300 dark:border-orange-700",
    swatch: "bg-orange-300",
    tint: "bg-orange-200/25 border-orange-400/60",
  },
  pink: {
    fill: "bg-pink-100 text-pink-950 dark:bg-pink-900/60 dark:text-pink-50",
    border: "border-pink-300 dark:border-pink-700",
    swatch: "bg-pink-300",
    tint: "bg-pink-200/25 border-pink-400/60",
  },
  green: {
    fill: "bg-green-100 text-green-950 dark:bg-green-900/60 dark:text-green-50",
    border: "border-green-300 dark:border-green-700",
    swatch: "bg-green-300",
    tint: "bg-green-200/25 border-green-400/60",
  },
  blue: {
    fill: "bg-sky-100 text-sky-950 dark:bg-sky-900/60 dark:text-sky-50",
    border: "border-sky-300 dark:border-sky-700",
    swatch: "bg-sky-300",
    tint: "bg-sky-200/25 border-sky-400/60",
  },
  purple: {
    fill: "bg-violet-100 text-violet-950 dark:bg-violet-900/60 dark:text-violet-50",
    border: "border-violet-300 dark:border-violet-700",
    swatch: "bg-violet-300",
    tint: "bg-violet-200/25 border-violet-400/60",
  },
  grey: {
    fill: "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
    border: "border-zinc-300 dark:border-zinc-600",
    swatch: "bg-zinc-300",
    tint: "bg-zinc-200/25 border-zinc-400/60",
  },
};

/** Text colors for free text; "default" follows the theme. */
export const TEXT_COLORS = ["default", "red", "orange", "green", "blue", "purple", "grey"] as const;
export type TextColor = (typeof TEXT_COLORS)[number];
export const TEXT_COLOR_STYLES: Record<TextColor, { text: string; swatch: string }> = {
  default: { text: "text-zinc-900 dark:text-zinc-100", swatch: "bg-zinc-900 dark:bg-zinc-100" },
  red: { text: "text-red-600 dark:text-red-400", swatch: "bg-red-500" },
  orange: { text: "text-orange-600 dark:text-orange-400", swatch: "bg-orange-500" },
  green: { text: "text-green-700 dark:text-green-400", swatch: "bg-green-600" },
  blue: { text: "text-sky-700 dark:text-sky-400", swatch: "bg-sky-600" },
  purple: { text: "text-violet-700 dark:text-violet-400", swatch: "bg-violet-600" },
  grey: { text: "text-zinc-500 dark:text-zinc-400", swatch: "bg-zinc-400" },
};

export const TEXT_SIZES = ["small", "medium", "heading"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const TEXT_SIZE_PX: Record<TextSize, number> = { small: 16, medium: 24, heading: 40 };

/** Fonts that need no download. CSS stacks fall back sensibly on every platform. */
export const SYSTEM_FONTS: Record<string, string> = {
  "System UI": "system-ui, -apple-system, 'Segoe UI', sans-serif",
  Arial: "Arial, Helvetica, sans-serif",
  Helvetica: "Helvetica, Arial, sans-serif",
  Verdana: "Verdana, Geneva, sans-serif",
  Tahoma: "Tahoma, Verdana, sans-serif",
  "Trebuchet MS": "'Trebuchet MS', sans-serif",
  Georgia: "Georgia, serif",
  "Times New Roman": "'Times New Roman', Times, serif",
  Palatino: "Palatino, 'Palatino Linotype', serif",
  "Courier New": "'Courier New', Courier, monospace",
  Impact: "Impact, 'Arial Black', sans-serif",
  "Comic Sans MS": "'Comic Sans MS', 'Comic Sans', cursive",
};

/** Google Fonts loaded on first use (one stylesheet request per font). */
export const GOOGLE_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Raleway",
  "Nunito",
  "Work Sans",
  "DM Sans",
  "Manrope",
  "Rubik",
  "Karla",
  "Mulish",
  "Outfit",
  "Space Grotesk",
  "Sora",
  "Figtree",
  "Oswald",
  "Bebas Neue",
  "Anton",
  "Archivo Black",
  "Barlow Condensed",
  "Playfair Display",
  "Merriweather",
  "Lora",
  "Libre Baskerville",
  "Cormorant Garamond",
  "EB Garamond",
  "Crimson Text",
  "DM Serif Display",
  "Abril Fatface",
  "Bodoni Moda",
  "Roboto Slab",
  "Zilla Slab",
  "Arvo",
  "Source Code Pro",
  "JetBrains Mono",
  "Space Mono",
  "IBM Plex Mono",
  "Fira Code",
  "Pacifico",
  "Lobster",
  "Dancing Script",
  "Caveat",
  "Shadows Into Light",
  "Permanent Marker",
  "Indie Flower",
  "Amatic SC",
  "Satisfy",
  "Great Vibes",
  "Righteous",
  "Fredoka",
  "Bangers",
  "Press Start 2P",
] as const;

export const FONTS = [...Object.keys(SYSTEM_FONTS), ...GOOGLE_FONTS];
export const DEFAULT_FONT = "System UI";

/** CSS font-family for a font name; unknown names fall back to the system font. */
export function fontFamily(name: string | undefined): string {
  if (!name) return SYSTEM_FONTS[DEFAULT_FONT]!;
  if (name in SYSTEM_FONTS) return SYSTEM_FONTS[name]!;
  return `'${name}', ${SYSTEM_FONTS[DEFAULT_FONT]}`;
}

// --- Saved content ------------------------------------------------------------------------

const Font = z.string().refine((f) => FONTS.includes(f), "Unknown font");

export const NoteContent = z.object({
  text: z.string().max(5000),
  shape: z.enum(NOTE_SHAPES).default("square"),
  color: z.enum(COLORS).default("yellow"),
  font: Font.default(DEFAULT_FONT),
});
export type NoteContent = z.infer<typeof NoteContent>;

export const TextContent = z.object({
  text: z.string().max(5000),
  font: Font.default(DEFAULT_FONT),
  size: z.enum(TEXT_SIZES).default("medium"),
  color: z.enum(TEXT_COLORS).default("default"),
});
export type TextContent = z.infer<typeof TextContent>;

export const SectionContent = z.object({
  title: z.string().max(200),
  color: z.enum(COLORS).default("grey"),
});
export type SectionContent = z.infer<typeof SectionContent>;

/** Default size of a new section. */
export const SECTION_SIZE = { width: 640, height: 420 };
