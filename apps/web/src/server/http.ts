import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import { connection } from "next/server";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function jsonError(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
  }
  console.error(error);
  return Response.json(
    { error: { code: "INTERNAL", message: "Internal server error" } },
    { status: 500 },
  );
}

/**
 * Wraps a route handler so thrown HttpErrors become JSON responses. API routes
 * are always dynamic; `connection()` runs outside the try block so Next's
 * prerender bailout is never swallowed.
 */
export function handler<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args) => {
    await connection();
    try {
      return await fn(...args);
    } catch (error) {
      return jsonError(error);
    }
  };
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, "INVALID_REQUEST", "Request body is invalid", parsed.error.issues);
  }
  return parsed.data;
}

const PG_STATUS: Record<string, [number, string]> = {
  "42501": [403, "FORBIDDEN"],
  P0002: [404, "NOT_FOUND"],
  "55P03": [409, "STALE_LEASE"],
  "23505": [409, "CONFLICT"],
  "23514": [422, "CONSTRAINT_VIOLATION"],
  "23503": [422, "INVALID_REFERENCE"],
  "22023": [400, "INVALID_PARAMETER"],
};

/** Maps database errors raised by RPCs and RLS to HTTP errors. */
export function fromPostgrest(error: PostgrestError): HttpError {
  const [status, code] = PG_STATUS[error.code] ?? [500, "DATABASE_ERROR"];
  return new HttpError(status, code, status === 500 ? "Database error" : error.message);
}

export function unwrap<T>({ data, error }: { data: T | null; error: PostgrestError | null }): T {
  if (error) throw fromPostgrest(error);
  return data as T;
}
