import { requireUser } from "@/server/auth";
import { handler } from "@/server/http";
import { llmStatus } from "@/server/llm";

/** Whether AI features are available (never exposes keys). */
export const GET = handler(async () => {
  await requireUser();
  return Response.json(llmStatus());
});
