import { z } from "zod";

import { NoteContent, SECTION_SIZE, SectionContent, TextContent } from "@/lib/canvas-style";
import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";

const Position = { x: z.number(), y: z.number() };

const CreateItem = z.discriminatedUnion("itemType", [
  z.object({ itemType: z.literal("note"), ...Position, content: NoteContent }),
  z.object({ itemType: z.literal("text"), ...Position, content: TextContent }),
  z.object({
    itemType: z.literal("section"),
    ...Position,
    width: z.number().min(120).max(10000).default(SECTION_SIZE.width),
    height: z.number().min(80).max(10000).default(SECTION_SIZE.height),
    content: SectionContent,
  }),
  z.object({
    itemType: z.literal("reference"),
    ...Position,
    content: z.object({ path: z.string().min(1).max(500), name: z.string().max(300) }),
  }),
]);

export const POST = handler(
  async (request: Request, ctx: RouteContext<"/api/projects/[projectId]/canvas/items">) => {
    const { projectId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const body = await parseJson(request, CreateItem);
    if (body.itemType === "reference" && !body.content.path.startsWith(`${projectId}/`)) {
      throw new HttpError(400, "INVALID_REQUEST", "Reference must be stored in this project");
    }
    const item = unwrap(
      await supabase
        .from("canvas_items")
        .insert({
          project_id: projectId,
          item_type: body.itemType,
          x: body.x,
          y: body.y,
          ...(body.itemType === "section" ? { width: body.width, height: body.height } : {}),
          content: body.content,
          updated_by: user.id,
        })
        .select("*")
        .single(),
    );
    return Response.json({ item }, { status: 201 });
  },
);
