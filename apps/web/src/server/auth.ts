import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

import { HttpError } from "./http";

export type ProjectRole = "owner" | "editor" | "reviewer";

/** Signed-in user and a client that acts as them (RLS applies). */
export async function requireUser(): Promise<{ user: User; supabase: SupabaseClient }> {
  if (!isSupabaseConfigured())
    throw new HttpError(503, "NOT_CONFIGURED", "Supabase is not configured");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "UNAUTHENTICATED", "Sign in first");
  return { user: data.user, supabase };
}

/**
 * Backend authorization check, independent of RLS: the user must hold one of
 * `roles` in the project. RLS enforces the same rules again in the database.
 */
export async function requireProjectRole(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  roles: ProjectRole[],
): Promise<ProjectRole> {
  const { data } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "NOT_FOUND", "Project not found");
  if (!roles.includes(data.role as ProjectRole)) {
    throw new HttpError(403, "FORBIDDEN", `Requires one of: ${roles.join(", ")}`);
  }
  return data.role as ProjectRole;
}
