import { describe, expect, it } from "vitest";

import { type BoardItem, cardSize, layoutBoard, OrganizeReply } from "./organize";

const item = (
  id: string,
  type: string,
  label: string,
  extra: Partial<BoardItem> = {},
): BoardItem => ({
  id,
  type,
  label,
  x: 500,
  y: 300,
  width: null,
  height: null,
  ...extra,
});
const items = [
  item("a1", "asset", "Poster.psd"),
  item("a2", "asset", "Flyer.psd"),
  item("n1", "note", "Client wants warmer colors", { shape: "circle" }),
  item("r1", "reference", "sketch.jpg"),
  item("s1", "section", "Old section", { width: 640, height: 420 }),
  item("t1", "text", "Launch ideas"),
];
const reply = (r: unknown) => OrganizeReply.parse(r);

/** Every placed card's box, using the plan's positions. */
function boxes(plan: ReturnType<typeof layoutBoard>) {
  return plan.moves
    .filter((m) => m.width === undefined)
    .map((m) => {
      const [w, h] = cardSize(items.find((i) => i.id === m.itemId)!);
      return { id: m.itemId, x1: m.x, y1: m.y, x2: m.x + w, y2: m.y + h };
    });
}

describe("layoutBoard", () => {
  const plan = layoutBoard(
    items,
    reply({
      groups: [
        { title: "Posters", color: "blue", cards: ["C1", "C2", "C1", "C99"] },
        { title: "Inspiration", color: "yellow", cards: ["C3", "C4", "C5"], reuseSection: "C5" },
      ],
      connections: [
        { from: "C3", to: "C1", why: "feedback" },
        { from: "C1", to: "C3" },
        { from: "C1", to: "C1" },
        { from: "C5", to: "C2" },
        { from: "C1", to: "C42" },
      ],
      summary: "Two posters and the notes that shaped them.",
    }),
  );

  it("never overlaps cards", () => {
    const b = boxes(plan);
    for (const p of b)
      for (const q of b)
        if (p !== q)
          expect(p.x2 <= q.x1 || q.x2 <= p.x1 || p.y2 <= q.y1 || q.y2 <= p.y1).toBe(true);
  });

  it("places each known card once, ignoring unknown and repeated ids", () => {
    const ids = plan.moves.map((m) => m.itemId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["a1", "a2", "n1", "r1", "s1", "t1"]);
    expect(plan.groups.map((g) => g.cards)).toEqual([
      ["Poster.psd", "Flyer.psd"],
      ["Client wants warmer colors", "sketch.jpg"],
    ]);
  });

  it("reuses an existing section and creates sections for the other groups", () => {
    expect(plan.newSections.map((s) => s.title)).toEqual(["Posters"]);
    const reused = plan.moves.find((m) => m.itemId === "s1")!;
    expect(reused).toMatchObject({ title: "Inspiration", color: "yellow" });
    // Its cards sit inside it.
    for (const id of ["n1", "r1"]) {
      const m = plan.moves.find((x) => x.itemId === id)!;
      expect(m.x).toBeGreaterThanOrEqual(reused.x);
      expect(m.y).toBeGreaterThanOrEqual(reused.y);
      expect(m.x + cardSize(items.find((i) => i.id === id)!)[0]).toBeLessThanOrEqual(
        reused.x + reused.width!,
      );
    }
  });

  it("keeps ungrouped cards and only valid, distinct connections", () => {
    const text = plan.moves.find((m) => m.itemId === "t1")!;
    expect(text.y).toBeGreaterThan(Math.max(...plan.newSections.map((s) => s.y + s.height)));
    expect(plan.connections).toEqual([{ from: "n1", to: "a1", why: "feedback" }]);
    expect(plan.summary?.text).toContain("Two posters");
  });
});
