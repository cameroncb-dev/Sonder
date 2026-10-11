"use client";

import { useEffect, useState } from "react";

import {
  type CanvasColor,
  DEFAULT_FONT,
  type NoteContent,
  type TextContent,
} from "@/lib/canvas-style";

import { ColorPicker, FontPicker, ShapePicker, SizePicker, TextColorPicker } from "./style-pickers";

/** What the next click on the canvas places, with the style chosen beforehand. */
export type PlacingTool =
  | { kind: "note"; content: NoteContent }
  | { kind: "text"; content: TextContent }
  | { kind: "section"; color: CanvasColor }
  | {
      kind: "theme";
      name: string;
      colors: Record<"primary" | "background" | "text" | "accent", string>;
    }
  | {
      kind: "direction";
      name: string;
      description: string;
      entries: Array<{ assetId: string; checkpointId: string }>;
    };

type Panel = "notes" | "text" | "sections" | "themes" | "directions" | "references";

const THEME_DEFAULT = {
  primary: "#1E3A5F",
  background: "#F5F1E8",
  text: "#1A1A1A",
  accent: "#E4572E",
};
const THEME_ROLES = ["primary", "background", "text", "accent"] as const;

const STORAGE_KEY = "sonder.toolbox";

interface Saved {
  open: Panel[];
  note: Omit<NoteContent, "text">;
  text: Omit<TextContent, "text">;
  section: CanvasColor;
  theme: { name: string; colors: typeof THEME_DEFAULT };
}

const DEFAULTS: Saved = {
  open: ["notes"],
  note: { shape: "square", color: "yellow", font: DEFAULT_FONT },
  text: { font: DEFAULT_FONT, size: "medium", color: "default" },
  section: "grey",
  theme: { name: "", colors: THEME_DEFAULT },
};

function loadSaved(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Saved>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** The 3×3 "waffle" button that shows and hides the toolbox. */
export function WaffleButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? "Hide tools" : "Show tools"}
      aria-pressed={open}
      title={open ? "Hide tools" : "Show tools"}
      className={`grid h-8 w-8 grid-cols-3 place-items-center gap-0.5 rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        open ? "bg-zinc-100 dark:bg-zinc-800" : ""
      }`}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="h-1 w-1 rounded-full bg-zinc-600 dark:bg-zinc-300" />
      ))}
    </button>
  );
}

function Section({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: Panel;
  title: string;
  open: boolean;
  onToggle: (id: Panel) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        {title}
        <span className={`text-xs text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && <div className="flex flex-col gap-3 px-3 pb-3">{children}</div>}
    </section>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{children}</span>
);

const placeButton =
  "rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200";

/**
 * Left-hand tools: choose a card's style first, then click the canvas to place it.
 * Choices and open sections are remembered in this browser.
 */
export function Toolbox({
  placing,
  onPlace,
  onCancel,
  onAddReference,
  onChooseDirection,
}: {
  placing: PlacingTool | null;
  onPlace: (tool: PlacingTool) => void;
  onCancel: () => void;
  onAddReference: () => void;
  /** Opens the version picker for a new direction; placing follows once versions are chosen. */
  onChooseDirection: (direction: { name: string; description: string }) => void;
}) {
  const [direction, setDirection] = useState({ name: "", description: "" });
  const [saved, setSaved] = useState<Saved>(DEFAULTS);
  // Browser storage is read after mount so server and client render the same markup.
  useEffect(() => {
    const restored = loadSaved();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from storage
    setSaved(restored);
  }, []);
  const update = (patch: Partial<Saved>) =>
    setSaved((s) => {
      const next = { ...s, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage may be unavailable (private mode); choices then last for this visit.
      }
      return next;
    });
  const toggle = (id: Panel) =>
    update({
      open: saved.open.includes(id) ? saved.open.filter((p) => p !== id) : [...saved.open, id],
    });
  const isOpen = (id: Panel) => saved.open.includes(id);

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {placing && (
        <div className="flex items-center justify-between gap-2 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:bg-blue-950 dark:text-blue-100">
          <span>Click the canvas to place · Esc to cancel</span>
          <button type="button" className="underline" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}

      <Section id="notes" title="Notes" open={isOpen("notes")} onToggle={toggle}>
        <Label>Shape</Label>
        <ShapePicker
          value={saved.note.shape}
          onChange={(shape) => update({ note: { ...saved.note, shape } })}
        />
        <Label>Color</Label>
        <ColorPicker
          value={saved.note.color}
          onChange={(color) => update({ note: { ...saved.note, color } })}
        />
        <Label>Font</Label>
        <FontPicker
          value={saved.note.font}
          onChange={(font) => update({ note: { ...saved.note, font } })}
        />
        <button
          type="button"
          className={placeButton}
          onClick={() => onPlace({ kind: "note", content: { ...saved.note, text: "" } })}
        >
          Place note
        </button>
      </Section>

      <Section id="text" title="Text" open={isOpen("text")} onToggle={toggle}>
        <Label>Size</Label>
        <SizePicker
          value={saved.text.size}
          onChange={(size) => update({ text: { ...saved.text, size } })}
        />
        <Label>Color</Label>
        <TextColorPicker
          value={saved.text.color}
          onChange={(color) => update({ text: { ...saved.text, color } })}
        />
        <Label>Font</Label>
        <FontPicker
          value={saved.text.font}
          onChange={(font) => update({ text: { ...saved.text, font } })}
        />
        <button
          type="button"
          className={placeButton}
          onClick={() => onPlace({ kind: "text", content: { ...saved.text, text: "" } })}
        >
          Place text
        </button>
      </Section>

      <Section id="sections" title="Sections" open={isOpen("sections")} onToggle={toggle}>
        <p className="text-xs text-zinc-500">
          A labelled area for grouping cards. Cards inside move with it; drag its corners to resize.
        </p>
        <Label>Color</Label>
        <ColorPicker value={saved.section} onChange={(section) => update({ section })} />
        <button
          type="button"
          className={placeButton}
          onClick={() => onPlace({ kind: "section", color: saved.section })}
        >
          Place section
        </button>
      </Section>

      <Section id="themes" title="Themes" open={isOpen("themes")} onToggle={toggle}>
        <p className="text-xs text-zinc-500">
          Four named colors you can apply to several documents at once. Place the theme, then click
          it to map layers and apply.
        </p>
        <Label>Name</Label>
        <input
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          placeholder="e.g. Broadway"
          value={saved.theme.name}
          onChange={(e) => update({ theme: { ...saved.theme, name: e.target.value } })}
        />
        <Label>Colors</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {THEME_ROLES.map((role) => (
            <label
              key={role}
              className="flex flex-col items-center gap-0.5 text-[10px] capitalize text-zinc-500"
            >
              <input
                type="color"
                className="h-8 w-full cursor-pointer rounded border border-zinc-300 bg-transparent dark:border-zinc-600"
                value={saved.theme.colors[role]}
                onChange={(e) =>
                  update({
                    theme: {
                      ...saved.theme,
                      colors: { ...saved.theme.colors, [role]: e.target.value.toUpperCase() },
                    },
                  })
                }
              />
              {role}
            </label>
          ))}
        </div>
        <button
          type="button"
          className={placeButton}
          disabled={!saved.theme.name.trim()}
          onClick={() =>
            onPlace({ kind: "theme", name: saved.theme.name.trim(), colors: saved.theme.colors })
          }
        >
          Place theme
        </button>
      </Section>

      <Section id="directions" title="Directions" open={isOpen("directions")} onToggle={toggle}>
        <p className="text-xs text-zinc-500">
          Save a named look: the exact version of each document, kept as it is even as you keep
          working. Reopen it later from its card.
        </p>
        <Label>Name</Label>
        <input
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          placeholder="e.g. Bold launch"
          value={direction.name}
          onChange={(e) => setDirection((d) => ({ ...d, name: e.target.value }))}
        />
        <Label>Description (optional)</Label>
        <textarea
          className="h-16 resize-none rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
          value={direction.description}
          onChange={(e) => setDirection((d) => ({ ...d, description: e.target.value }))}
        />
        <button
          type="button"
          className={placeButton}
          disabled={!direction.name.trim()}
          onClick={() => {
            onChooseDirection({
              name: direction.name.trim(),
              description: direction.description.trim(),
            });
            setDirection({ name: "", description: "" });
          }}
        >
          Choose versions…
        </button>
      </Section>

      <Section id="references" title="References" open={isOpen("references")} onToggle={toggle}>
        <p className="text-xs text-zinc-500">
          Upload an inspiration image (PNG, JPEG or WebP). It lands in the middle of your view.
        </p>
        <button type="button" className={placeButton} onClick={onAddReference}>
          Add reference
        </button>
      </Section>
    </aside>
  );
}
