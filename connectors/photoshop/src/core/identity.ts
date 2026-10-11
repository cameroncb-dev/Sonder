import type { Element, NativeRef } from "@sonder/contracts";

export interface PhotoshopNativeData {
  layerId: number;
  layerName: string;
}

export function layerRef(layerId: number, layerName: string): NativeRef {
  return { connector: "photoshop", data: { layerId, layerName } };
}

/** Reads a layer id from a native ref, rejecting refs from other connectors. */
export function layerIdOf(native: NativeRef): number | undefined {
  if (native.connector !== "photoshop") return undefined;
  const id = native.data.layerId;
  return typeof id === "number" && Number.isInteger(id) ? id : undefined;
}

export const elementKey = (element: Element) => String(layerIdOf(element.native));

/** RFC 4122 v4 id. Math.random is fine here: ids are identifiers, not secrets. */
export function randomUuid(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
