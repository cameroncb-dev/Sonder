import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";
import { getInterpreter } from "@/server/llm";
import { type BoardItem, layoutBoard, OrganizeReply, shortIds } from "@/server/organize";

interface Row {
  id: string;
  item_type: string;
  ref_id: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  content: Record<string, unknown>;
}

/**
 * Asks the AI provider how to group the board and returns a laid-out plan. Nothing moves
 * until the user applies it; documents and their history are never involved.
 */
export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/canvas/organize">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const { hint } = await parseJson(request, z.object({ hint: z.string().max(500).optional() }));
    const interpreter = getInterpreter();
    if (!interpreter.enabled)
      throw new HttpError(
        503,
        "AI_DISABLED",
        "AI is off: set LLM_PROVIDER=gemini and GEMINI_API_KEY",
      );

    const [rows, assets, themes, directions] = await Promise.all([
      supabase
        .from("canvas_items")
        .select("id,item_type,ref_id,x,y,width,height,content")
        .eq("project_id", projectId),
      supabase.from("assets").select("id,name").eq("project_id", projectId),
      supabase.from("themes").select("id,name").eq("project_id", projectId),
      supabase.from("directions").select("id,name").eq("project_id", projectId),
    ]);
    const nameOf = (list: unknown, id: string | null) =>
      (unwrap({ data: list as Array<{ id: string; name: string }>, error: null }) ?? []).find(
        (x) => x.id === id,
      )?.name;
    const items: BoardItem[] = (unwrap(rows) as Row[]).map((r) => ({
      id: r.id,
      type: r.item_type,
      label:
        (r.item_type === "asset"
          ? nameOf(assets.data, r.ref_id)
          : r.item_type === "theme"
            ? nameOf(themes.data, r.ref_id)
            : r.item_type === "direction"
              ? nameOf(directions.data, r.ref_id)
              : String(r.content.text ?? r.content.title ?? r.content.name ?? "")
        )?.slice(0, 120) || r.item_type,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      ...(typeof r.content.shape === "string" ? { shape: r.content.shape } : {}),
    }));
    if (items.filter((i) => i.type !== "section").length < 2)
      throw new HttpError(422, "NOTHING_TO_ORGANIZE", "Add a few cards first");

    const listing = shortIds(items)
      .map(({ id, item }) => `${id}: ${item.type} "${item.label}"`)
      .join("\n");
    const result = await interpreter.interpret({
      text: hint?.trim()
        ? `Organize this board. The user adds: ${hint.trim()}`
        : "Organize this board into clear, useful groups.",
      context: [
        "You are organizing a creative team's canvas (like FigJam). Cards:",
        listing,
        "Group related cards into 2-6 titled sections (short titles, e.g. 'Poster explorations', " +
          "'References', 'Feedback'). Give each a color from: yellow, orange, pink, green, blue, " +
          "purple, grey. Put each card in at most one group; existing 'section' cards may be reused " +
          "for a group via reuseSection instead of being listed as cards.",
        "Optionally suggest up to 6 connections between clearly related cards (with a short why), " +
          "and a one-paragraph summary of the board.",
      ].join("\n\n"),
      schema: OrganizeReply,
    });
    if (!result.ok) throw new HttpError(502, "AI_FAILED", result.message);
    return Response.json({ plan: layoutBoard(items, result.value) });
  },
);
