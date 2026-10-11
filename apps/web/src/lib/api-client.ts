"use client";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** JSON fetch for the app's own API. Signed-out users are sent to the login page. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => ({}))) as {
    error?: { code: string; message: string; details?: unknown };
  };
  if (response.status === 401 && typeof window !== "undefined") {
    window.location.assign(
      new URL(`/login?next=${encodeURIComponent(window.location.pathname)}`, window.location.origin)
        .href,
    );
  }
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      json.error?.code ?? "HTTP_ERROR",
      json.error?.message ?? `HTTP ${response.status}`,
      json.error?.details,
    );
  }
  return json as T;
}
