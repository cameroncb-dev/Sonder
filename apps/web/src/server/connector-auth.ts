import "server-only";

import { createHash, randomBytes, randomInt } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/server";

import { HttpError } from "./http";

/** Connector tokens expire; the plugin must pair again afterwards. */
export const CONNECTOR_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const PAIRING_TTL_MS = 10 * 60 * 1000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const newSecret = () => randomBytes(32).toString("base64url");

export function newPairingCode(): string {
  const pick = () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

export interface ConnectorSession {
  id: string;
  userId: string;
  application: string;
  expiresAt: string;
}

/** Authenticates `Authorization: Bearer <connector token>`. Admin keys never reach the plugin. */
export async function requireConnectorSession(request: Request): Promise<ConnectorSession> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Missing connector token");

  const admin = createAdminClient();
  const { data } = await admin
    .from("connector_sessions")
    .select("id,user_id,application,status,expires_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  if (!data || data.status !== "active")
    throw new HttpError(401, "UNAUTHENTICATED", "Invalid connector token");
  if (!data.expires_at || new Date(data.expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, "TOKEN_EXPIRED", "Connector token expired; pair again");
  }
  return {
    id: data.id,
    userId: data.user_id,
    application: data.application,
    expiresAt: data.expires_at,
  };
}
