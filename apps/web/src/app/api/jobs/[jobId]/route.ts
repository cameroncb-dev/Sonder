import { requireUser } from "@/server/auth";
import { handler, HttpError, unwrap } from "@/server/http";

/** Job status with its transition history. RLS limits this to project members. */
export const GET = handler(async (_request: Request, ctx: RouteContext<"/api/jobs/[jobId]">) => {
  const { jobId } = await ctx.params;
  const { supabase } = await requireUser();
  const job = unwrap(await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle());
  if (!job) throw new HttpError(404, "NOT_FOUND", "Job not found");
  const events = unwrap(
    await supabase
      .from("job_events")
      .select("from_status,to_status,attempt,detail,at")
      .eq("job_id", jobId)
      .order("id"),
  );
  return Response.json({ job, events });
});
