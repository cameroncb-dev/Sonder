import { z } from "zod";

/** `#RRGGBB`, normalised to upper case. */
export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB color")
  .transform((value) => value.toUpperCase());
export type HexColor = z.infer<typeof HexColor>;

/**
 * Property types are namespaced by what they describe, not by application.
 * A connector declares which element kinds expose which property types.
 */
export const PropertyType = z.enum([
  "text.content",
  "text.font",
  "text.size",
  "text.color",
  "fill.color",
]);
export type PropertyType = z.infer<typeof PropertyType>;

/** Fonts are identified by PostScript name, which is stable across applications. */
export const FontValue = z.object({
  postScriptName: z.string().min(1),
  family: z.string().optional(),
  style: z.string().optional(),
});
export type FontValue = z.infer<typeof FontValue>;

export const PropertyValue = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text.content"), value: z.string() }),
  z.object({ type: z.literal("text.font"), value: FontValue }),
  /** Points. */
  z.object({ type: z.literal("text.size"), value: z.number().positive().max(10_000) }),
  z.object({ type: z.literal("text.color"), value: HexColor }),
  z.object({ type: z.literal("fill.color"), value: HexColor }),
]);
export type PropertyValue = z.infer<typeof PropertyValue>;

/** Compares two property values of the same type. Font comparison uses the PostScript name only. */
export function propertyValuesEqual(a: PropertyValue, b: PropertyValue): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "text.font" && b.type === "text.font") {
    return a.value.postScriptName === b.value.postScriptName;
  }
  if (a.type === "text.size" && b.type === "text.size") {
    return Math.abs(a.value - b.value) < 0.01;
  }
  return a.value === b.value;
}
