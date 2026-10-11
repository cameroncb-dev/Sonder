import { z } from "zod";

import { COLORS } from "@/lib/canvas-style";

/**
 * Board organizing: the AI only decides *grouping* (which cards belong together, section
 * titles and colors, related cards to connect). Positions are computed here, so the result
 * is always tidy and never overlaps, whatever the model replies.
 */

export interface BoardItem {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  /** Note shape, which sets its size. */
  shape?: string;
}

export const OrganizeReply = z.object({
  groups: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        color: z.enum(COLORS).default("grey"),
        /** Short ids of the cards in this group (C1, C2, …). */
        cards: z.array(z.string().max(10)).min(1).max(40),
        /** Short id of an existing section to reuse for this group, if any. */
        reuseSection: z.string().max(10).optional(),
      }),
    )
    .min(1)
    .max(8),
  connections: z
    .array(
      z.object({
        from: z.string().max(10),
        to: z.string().max(10),
        why: z.string().max(80).optional(),
      }),
    )
    .max(10)
    .default([]),
  summary: z.string().max(400).optional(),
});
export type OrganizeReply = z.infer<typeof OrganizeReply>;

export interface OrganizePlan {
  moves: Array<{
    itemId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    title?: string;
    color?: string;
  }>;
  newSections: Array<{
    title: string;
    color: string;
    x: number;
    y: number;
    width: number;
    height: number;
    cards: string[];
  }>;
  connections: Array<{ from: string; to: string; why?: string }>;
  summary?: { text: string; x: number; y: number };
  /** For the preview: each group's title and the labels of its cards. */
  groups: Array<{ title: string; color: string; cards: string[] }>;
}

const NOTE_SIZE: Record<string, [number, number]> = {
  square: [192, 192],
  rounded: [240, 144],
  circle: [208, 208],
  diamond: [240, 240],
};

/** Approximate rendered size of a card, enough to lay cards out without overlaps. */
export function cardSize(item: BoardItem): [number, number] {
  switch (item.type) {
    case "asset":
      return [256, 340];
    case "note":
      return NOTE_SIZE[item.shape ?? "square"] ?? [192, 192];
    case "text":
      return [Math.min(480, 40 + item.label.length * 12), 60];
    case "reference":
      return [224, 270];
    case "theme":
      return [224, 110];
    case "direction":
      return [256, 220];
    default:
      return [240, 160];
  }
}

const GAP = 40;
const PAD = { top: 64, side: 40, bottom: 40 };
const COLUMNS = 3;
const SECTIONS_PER_ROW = 3;
const SECTION_GAP = 120;

/** Short ids for the prompt: C1, C2, … in a stable order. */
export const shortIds = (items: BoardItem[]) => items.map((item, i) => ({ id: `C${i + 1}`, item }));

/**
 * Validates the reply against the board and lays it out: each group becomes a section (new,
 * or a reused existing one) with its cards in rows; sections flow left to right; cards in
 * no group are placed in a row underneath. Unknown or repeated ids are ignored.
 */
export function layoutBoard(items: BoardItem[], reply: OrganizeReply): OrganizePlan {
  const byShort = new Map(shortIds(items).map(({ id, item }) => [id, item]));
  const origin = {
    x: Math.min(...items.map((i) => i.x), 0),
    y: Math.min(...items.map((i) => i.y), 0),
  };
  const placed = new Set<string>();
  const usedSections = new Set<string>();
  const plan: OrganizePlan = { moves: [], newSections: [], connections: [], groups: [] };

  let cursorX = origin.x;
  let cursorY = origin.y;
  let rowHeight = 0;
  let inRow = 0;

  for (const group of reply.groups) {
    const cards: BoardItem[] = [];
    for (const id of group.cards) {
      const card = byShort.get(id);
      // Ignore unknown ids, sections listed as cards, and cards already placed (even in this group).
      if (!card || card.type === "section" || placed.has(card.id)) continue;
      placed.add(card.id);
      cards.push(card);
    }
    if (!cards.length) continue;

    // Lay the cards out in rows inside the section.
    const sizes = cards.map(cardSize);
    const colWidth = Math.max(...sizes.map(([w]) => w));
    const rows: number[][] = [];
    cards.forEach((_, i) => (rows[Math.floor(i / COLUMNS)] ??= []).push(i));
    const rowHeights = rows.map((r) => Math.max(...r.map((i) => sizes[i]![1])));
    const columns = Math.min(COLUMNS, cards.length);
    const width = PAD.side * 2 + columns * colWidth + (columns - 1) * GAP;
    const height =
      PAD.top + rowHeights.reduce((a, b) => a + b, 0) + (rows.length - 1) * GAP + PAD.bottom;

    if (inRow === SECTIONS_PER_ROW) {
      cursorX = origin.x;
      cursorY += rowHeight + SECTION_GAP;
      rowHeight = 0;
      inRow = 0;
    }
    const sx = cursorX;
    const sy = cursorY;
    let y = sy + PAD.top;
    rows.forEach((row, r) => {
      row.forEach((index, col) => {
        plan.moves.push({ itemId: cards[index]!.id, x: sx + PAD.side + col * (colWidth + GAP), y });
      });
      y += rowHeights[r]! + GAP;
    });

    const reuse = group.reuseSection ? byShort.get(group.reuseSection) : undefined;
    if (reuse && reuse.type === "section" && !usedSections.has(reuse.id)) {
      usedSections.add(reuse.id);
      plan.moves.push({
        itemId: reuse.id,
        x: sx,
        y: sy,
        width,
        height,
        title: group.title,
        color: group.color,
      });
    } else {
      plan.newSections.push({
        title: group.title,
        color: group.color,
        x: sx,
        y: sy,
        width,
        height,
        cards: cards.map((c) => c.id),
      });
    }
    plan.groups.push({ title: group.title, color: group.color, cards: cards.map((c) => c.label) });

    cursorX += width + SECTION_GAP;
    rowHeight = Math.max(rowHeight, height);
    inRow += 1;
  }

  // Everything not grouped (including unused sections) goes in a row underneath.
  let x = origin.x;
  const y = cursorY + rowHeight + SECTION_GAP;
  for (const item of items) {
    if (placed.has(item.id) || usedSections.has(item.id)) continue;
    plan.moves.push({ itemId: item.id, x, y });
    x += (item.type === "section" ? (item.width ?? 640) : cardSize(item)[0]) + GAP;
  }

  const seen = new Set<string>();
  for (const c of reply.connections) {
    const from = byShort.get(c.from);
    const to = byShort.get(c.to);
    const key = [from?.id, to?.id].sort().join();
    if (
      !from ||
      !to ||
      from.id === to.id ||
      seen.has(key) ||
      from.type === "section" ||
      to.type === "section"
    )
      continue;
    seen.add(key);
    plan.connections.push({ from: from.id, to: to.id, ...(c.why ? { why: c.why } : {}) });
  }
  if (reply.summary?.trim())
    plan.summary = { text: reply.summary.trim(), x: origin.x, y: origin.y - 260 };
  return plan;
}
