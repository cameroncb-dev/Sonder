import { z } from "zod";

import { ElementId, Role } from "./elements";
import { PropertyType } from "./properties";

export const IssueCode = z.enum([
  "NO_DOCUMENT",
  "ELEMENT_NOT_FOUND",
  "ELEMENT_KIND_MISMATCH",
  "ELEMENT_NOT_EDITABLE",
  "ROLE_UNMAPPED",
  "DUPLICATE_ROLE",
  "DUPLICATE_ELEMENT",
  "UNSUPPORTED_OPERATION",
  "UNSUPPORTED_PROPERTY",
  "UNSUPPORTED_COLOR_MODE",
  "MISSING_FONT",
  "INVALID_VALUE",
  "CHECKPOINT_INCOMPLETE",
  "UNSAVED_CHANGES",
  "UNCAPTURED_CHANGES",
  "APPLICATION_ERROR",
]);
export type IssueCode = z.infer<typeof IssueCode>;

export const Issue = z.object({
  code: IssueCode,
  message: z.string(),
  elementId: ElementId.optional(),
  role: Role.optional(),
  property: PropertyType.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type Issue = z.infer<typeof Issue>;

export const ValidationResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), issues: z.array(Issue).min(1) }),
]);
export type ValidationResult = z.infer<typeof ValidationResult>;
