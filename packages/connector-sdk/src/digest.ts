/** FNV-1a 64-bit digest as 16 hex chars. Pure JS so it runs in UXP, Node and browsers. */
export function fnv1a64(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]!);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
