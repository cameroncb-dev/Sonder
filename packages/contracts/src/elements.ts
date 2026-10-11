import { z } from "zod";

import { PropertyType, PropertyValue } from "./properties";

/** Stable Sonder identifier for an editable element inside an asset. */
export const ElementId = z.uuid();
export type ElementId = z.infer<typeof ElementId>;

/** User-assigned semantic role, e.g. `headline`, `body_text`, `background`. */
export const Role = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "Roles are lower_snake_case");
export type Role = z.infer<typeof Role>;

/**
 * Element kinds are generic. Photoshop maps `text` to text layers and `solid_fill`
 * to solid-color fill layers; a vector or video connector would map its own objects.
 */
export const ElementKind = z.enum(["text", "solid_fill"]);
export type ElementKind = z.infer<typeof ElementKind>;

/** Connector-specific pointer to a native object (e.g. a Photoshop layer id and name). */
export const NativeRef = z.object({
  connector: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});
export type NativeRef = z.infer<typeof NativeRef>;

/** An element as read from a document. */
export const Element = z.object({
  native: NativeRef,
  kind: ElementKind,
  name: z.string(),
  properties: z.array(PropertyValue),
  /** False when the element exists but cannot be edited safely (e.g. mixed formatting). */
  editable: z.boolean(),
  notEditableReason: z.string().optional(),
});
export type Element = z.infer<typeof Element>;

/** A validated link between a Sonder element, its role and a native object. */
export const ElementMapping = z.object({
  elementId: ElementId,
  role: Role,
  kind: ElementKind,
  native: NativeRef,
});
export type ElementMapping = z.infer<typeof ElementMapping>;

export const ElementKindCapability = z.object({
  kind: ElementKind,
  properties: z.array(PropertyType).min(1),
});
export type ElementKindCapability = z.infer<typeof ElementKindCapability>;
