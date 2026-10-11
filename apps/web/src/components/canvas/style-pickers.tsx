"use client";

import { useEffect } from "react";

import {
  type CanvasColor,
  COLOR_STYLES,
  COLORS,
  fontFamily,
  FONTS,
  GOOGLE_FONTS,
  NOTE_SHAPE_LABELS,
  NOTE_SHAPES,
  type NoteShape,
  SYSTEM_FONTS,
  TEXT_COLOR_STYLES,
  TEXT_COLORS,
  TEXT_SIZES,
  type TextColor,
  type TextSize,
} from "@/lib/canvas-style";
import { loadFont, loadFontPreviews } from "@/lib/fonts";

const ring = (active: boolean) =>
  active ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-zinc-900" : "";

export function ShapePicker({
  value,
  onChange,
}: {
  value: NoteShape;
  onChange: (s: NoteShape) => void;
}) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Shape">
      {NOTE_SHAPES.map((shape) => (
        <button
          key={shape}
          type="button"
          role="radio"
          aria-checked={value === shape}
          title={NOTE_SHAPE_LABELS[shape]}
          onClick={() => onChange(shape)}
          className={`flex h-8 w-8 items-center justify-center rounded border border-zinc-300 dark:border-zinc-600 ${ring(value === shape)}`}
        >
          <ShapeIcon shape={shape} />
        </button>
      ))}
    </div>
  );
}

function ShapeIcon({ shape }: { shape: NoteShape }) {
  const base = "bg-zinc-400 dark:bg-zinc-500";
  if (shape === "circle") return <span className={`h-4 w-4 rounded-full ${base}`} />;
  if (shape === "rounded") return <span className={`h-3.5 w-5 rounded-md ${base}`} />;
  if (shape === "diamond") return <span className={`h-3.5 w-3.5 rotate-45 ${base}`} />;
  return <span className={`h-4 w-4 ${base}`} />;
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: CanvasColor;
  onChange: (c: CanvasColor) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          title={color}
          onClick={() => onChange(color)}
          className={`h-6 w-6 rounded-full border border-black/10 ${COLOR_STYLES[color].swatch} ${ring(value === color)}`}
        />
      ))}
    </div>
  );
}

export function TextColorPicker({
  value,
  onChange,
}: {
  value: TextColor;
  onChange: (c: TextColor) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Text color">
      {TEXT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          title={color}
          onClick={() => onChange(color)}
          className={`h-6 w-6 rounded-full border border-black/10 ${TEXT_COLOR_STYLES[color].swatch} ${ring(value === color)}`}
        />
      ))}
    </div>
  );
}

export function SizePicker({
  value,
  onChange,
}: {
  value: TextSize;
  onChange: (s: TextSize) => void;
}) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Size">
      {TEXT_SIZES.map((size) => (
        <button
          key={size}
          type="button"
          role="radio"
          aria-checked={value === size}
          onClick={() => onChange(size)}
          className={`rounded border px-2 py-0.5 text-xs capitalize ${
            value === size
              ? "border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
              : "border-zinc-300 dark:border-zinc-600"
          }`}
        >
          {size}
        </button>
      ))}
    </div>
  );
}

/** Every font, each name shown in its own typeface. */
export function FontPicker({ value, onChange }: { value: string; onChange: (f: string) => void }) {
  useEffect(() => {
    loadFontPreviews();
    loadFont(value);
  }, [value]);
  return (
    <select
      aria-label="Font"
      className="nodrag w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
      style={{ fontFamily: fontFamily(value) }}
      value={FONTS.includes(value) ? value : FONTS[0]}
      onChange={(e) => {
        loadFont(e.target.value);
        onChange(e.target.value);
      }}
    >
      <optgroup label="System">
        {Object.keys(SYSTEM_FONTS).map((f) => (
          <option key={f} value={f} style={{ fontFamily: fontFamily(f) }}>
            {f}
          </option>
        ))}
      </optgroup>
      <optgroup label="Google Fonts">
        {GOOGLE_FONTS.map((f) => (
          <option key={f} value={f} style={{ fontFamily: fontFamily(f) }}>
            {f}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
