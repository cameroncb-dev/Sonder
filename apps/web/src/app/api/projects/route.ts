import { z } from "zod";

import { requireUser } from "@/server/auth";
import { handler, parseJson, unwrap } from "@/server/http";

export const GET = handler(async () => {
  const { supabase } = await requireUser();
  const projects = unwrap(
    await supabase.from("projects").select("id,name,created_at").order("created_at"),
  );
  return Response.json({ projects });
});

export const POST = handler(async (request: Request) => {
  const { supabase } = await requireUser();
  const { name } = await parseJson(request, z.object({ name: z.string().trim().min(1).max(200) }));
  const project = unwrap(await supabase.rpc("create_project", { p_name: name }));
  return Response.json({ project }, { status: 201 });
});
