import { z } from "zod";

import { requireProjectRole, requireUser } from "@/server/auth";
import { handler, HttpError, parseJson, unwrap } from "@/server/http";
import { getInterpreter } from "@/server/llm";
import { requireAsset } from "@/server/projects";
import { previewBytes, suggestionContext } from "@/server/suggestion-context";
import { describeLayers, SuggestionReply, validateSuggestions } from "@/server/suggestions";

/**
 * Asks the AI provider for alternative directions for this document. Replies are validated
 * against the real layers and connector capabilities; nothing is applied here.
 */
export const POST = handler(
  async (
    request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/suggestions">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor"]);
    const asset = await requireAsset(supabase, projectId, assetId);
    const { hint } = await parseJson(request, z.object({ hint: z.string().max(500).optional() }));
    const interpreter = getInterpreter();
    if (!interpreter.enabled)
      throw new HttpError(
        503,
        "AI_DISABLED",
        "AI suggestions are off: set LLM_PROVIDER=gemini and GEMINI_API_KEY",
      );

    const c = await suggestionContext(supabase, asset);
    if (!c.elements.some((e) => e.editable))
      throw new HttpError(
        409,
        "NOTHING_EDITABLE",
        "This document has no text or fill layers Sonder can change",
      );
    const notes = (
      unwrap(
        await supabase
          .from("canvas_items")
          .select("item_type,content")
          .eq("project_id", projectId)
          .in("item_type", ["note", "text", "reference"])
          .limit(20),
      ) as Array<{ item_type: string; content: { text?: string; name?: string } }>
    )
      .map((i) =>
        i.item_type === "reference" ? `Reference image: ${i.content.name}` : i.content.text,
      )
      .filter((t): t is string => !!t?.trim())
      .map((t) => `- ${t.slice(0, 200)}`);
    const image = await previewBytes(c.head.preview_path);

    const result = await interpreter.interpret({
      text: hint?.trim()
        ? `Suggest up to 3 distinct design directions. The designer adds: ${hint.trim()}`
        : "Suggest up to 3 distinct, tasteful design directions worth exploring.",
      context: [
        `You are a design assistant for "${asset.name}" (${asset.application}).`,
        image ? "The attached image is its current look." : "",
        "You can only change these layers and properties (anything else is rejected):",
        describeLayers(c.elements),
        "Allowed properties: text layers → text.content, text.font, text.size, text.color; " +
          "solid_fill layers → fill.color. Colors are #RRGGBB. text.font must be one of: " +
          c.fonts.join(", "),
        "Each suggestion: a short title, a one-sentence rationale, and 1-8 concrete changes " +
          "referring to layers by their id (L1, L2, …). Keep text.content changes short and on-topic.",
        notes.length ? `Project notes and references:\n${notes.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      schema: SuggestionReply,
      ...(image ? { images: [{ mimeType: "image/png", data: image }] } : {}),
    });
    if (!result.ok) throw new HttpError(502, "AI_FAILED", result.message);
    const suggestions = validateSuggestions(result.value, c);
    if (!suggestions.length)
      throw new HttpError(
        422,
        "NO_USABLE_SUGGESTIONS",
        "None of the AI's ideas fit this document; try again",
      );
    return Response.json({ suggestions, basedOn: c.head.id });
  },
);

interface Row {
  id: string;
  status: string;
  request: { title?: string; rationale?: string; changes?: unknown[] };
  created_at: string;
  proposal_items: Array<{
    id: string;
    status: string;
    candidate_checkpoint_id: string | null;
    source_checkpoint_ids: string[];
    outcome: Record<string, unknown> | null;
  }>;
}

/** Suggestions this document's team chose to try, newest first, with previews. */
export const GET = handler(
  async (
    _request: Request,
    ctx: RouteContext<"/api/projects/[projectId]/assets/[assetId]/suggestions">,
  ) => {
    const { projectId, assetId } = await ctx.params;
    const { user, supabase } = await requireUser();
    await requireProjectRole(supabase, user.id, projectId, ["owner", "editor", "reviewer"]);
    const rows = unwrap(
      await supabase
        .from("proposals")
        .select(
          "id,status,request,created_at,proposal_items!inner(id,status,candidate_checkpoint_id,source_checkpoint_ids,outcome)",
        )
        .eq("project_id", projectId)
        .eq("kind", "suggested_branch")
        .eq("proposal_items.asset_id", assetId)
        .order("created_at", { ascending: false })
        .limit(6),
    ) as unknown as Row[];
    const ids = rows
      .flatMap((r) => [
        r.proposal_items[0]?.candidate_checkpoint_id,
        r.proposal_items[0]?.source_checkpoint_ids[0],
      ])
      .filter((id): id is string => !!id);
    const cps = ids.length
      ? (unwrap(
          await supabase.from("checkpoints").select("id,preview_path").in("id", ids),
        ) as Array<{
          id: string;
          preview_path: string;
        }>)
      : [];
    const { data: signed } = cps.length
      ? await supabase.storage.from("previews").createSignedUrls(
          cps.map((c) => c.preview_path),
          600,
        )
      : { data: [] };
    const urls = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    const url = (id?: string | null) => {
      const c = cps.find((x) => x.id === id);
      return c ? (urls.get(c.preview_path) ?? null) : null;
    };
    return Response.json({
      suggestions: rows.map((r) => {
        const item = r.proposal_items[0]!;
        return {
          id: r.id,
          status: r.status,
          title: r.request.title ?? "Suggestion",
          rationale: r.request.rationale ?? "",
          changes: r.request.changes ?? [],
          createdAt: r.created_at,
          candidateCheckpointId: item.candidate_checkpoint_id,
          candidatePreviewUrl: url(item.candidate_checkpoint_id),
          beforePreviewUrl: url(item.source_checkpoint_ids[0]),
          error: (item.outcome?.error as { message?: string } | undefined)?.message ?? null,
        };
      }),
    });
  },
);
