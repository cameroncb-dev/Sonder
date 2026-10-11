import { randomUUID } from "node:crypto";

import { nativeIdentity } from "@sonder/connector-sdk";
import {
  type ChangeSet,
  type Element,
  type ElementKindCapability,
  propertyValuesEqual,
  type PropertyValue,
} from "@sonder/contracts";
import { z } from "zod";

/**
 * Fonts suggestions may use: common PostScript names on macOS and Windows plus any font the
 * project's documents already use. The plugin still checks installation before applying.
 */
export const SUGGESTION_FONTS = [
  "ArialMT",
  "Arial-BoldMT",
  "Helvetica",
  "Helvetica-Bold",
  "Georgia",
  "Georgia-Bold",
  "TimesNewRomanPSMT",
  "TimesNewRomanPS-BoldMT",
  "Verdana",
  "Verdana-Bold",
  "TrebuchetMS",
  "CourierNewPSMT",
  "Impact",
  "Futura-Medium",
  "Futura-Bold",
  "AvenirNext-Regular",
  "AvenirNext-Bold",
  "GillSans",
  "Baskerville",
  "Didot",
  "Optima-Regular",
  "Palatino-Roman",
];

/** What Gemini must return. Layers are referred to by the short ids in the prompt. */
export const SuggestionReply = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        rationale: z.string().min(1).max(300),
        changes: z
          .array(
            z.object({
              layer: z.string().min(1).max(10),
              property: z.enum([
                "text.content",
                "text.font",
                "text.size",
                "text.color",
                "fill.color",
              ]),
              value: z.union([z.string().max(500), z.number()]),
            }),
          )
          .min(1)
          .max(8),
      }),
    )
    .min(1)
    .max(3),
});
export type SuggestionReply = z.infer<typeof SuggestionReply>;

/** A validated change, keyed by element identity so it can be re-checked when tried. */
export interface SuggestedChange {
  elementKey: string;
  element: string;
  property: PropertyValue["type"];
  from?: unknown;
  to: PropertyValue["value"];
}

export interface Suggestion {
  title: string;
  rationale: string;
  changes: SuggestedChange[];
  /** Changes Sonder dropped because they weren't applicable, with reasons. */
  skipped: string[];
}

interface Context {
  elements: Element[];
  elementKinds: ElementKindCapability[];
  identityFields?: string[];
  fonts: string[];
}

/** Short ids ("L1", "L2", …) for the layers Gemini may change. */
export function layerIds(elements: Element[]) {
  return elements.map((element, i) => ({ id: `L${i + 1}`, element }));
}

/** Turns a model value into a typed property value, or explains why it can't be used. */
function toProperty(
  property: PropertyValue["type"],
  value: string | number,
  fonts: string[],
): PropertyValue | string {
  switch (property) {
    case "text.color":
    case "fill.color":
      return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
        ? { type: property, value: value.toUpperCase() }
        : `${property} must be a #RRGGBB color`;
    case "text.size": {
      const size = typeof value === "number" ? value : Number(value);
      return Number.isFinite(size) && size >= 4 && size <= 500
        ? { type: property, value: Math.round(size * 100) / 100 }
        : "text.size must be between 4 and 500";
    }
    case "text.content":
      return typeof value === "string" && value.trim()
        ? { type: property, value }
        : "text.content must be non-empty text";
    case "text.font":
      return typeof value === "string" && fonts.includes(value)
        ? { type: property, value: { postScriptName: value } }
        : `font ${String(value)} isn't in the allowed list`;
  }
}

/**
 * Keeps only the suggested changes that apply to real, editable layers with properties the
 * connector supports and well-formed values. Suggestions left with nothing to change are
 * dropped. Model output is never applied as-is.
 */
export function validateSuggestions(reply: SuggestionReply, context: Context): Suggestion[] {
  const ids = new Map(layerIds(context.elements).map(({ id, element }) => [id, element]));
  const editable = new Map(context.elementKinds.map((k) => [k.kind, new Set(k.properties)]));
  return reply.suggestions.flatMap((suggestion) => {
    const changes: SuggestedChange[] = [];
    const skipped: string[] = [];
    const seen = new Set<string>();
    for (const change of suggestion.changes) {
      const element = ids.get(change.layer);
      if (!element) {
        skipped.push(`unknown layer ${change.layer}`);
        continue;
      }
      if (!element.editable || !editable.get(element.kind)?.has(change.property)) {
        skipped.push(`"${element.name}" can't take ${change.property}`);
        continue;
      }
      const next = toProperty(change.property, change.value, context.fonts);
      if (typeof next === "string") {
        skipped.push(`"${element.name}": ${next}`);
        continue;
      }
      const elementKey = nativeIdentity(element.native, context.identityFields);
      const current = element.properties.find((p) => p.type === change.property);
      if ((current && propertyValuesEqual(current, next)) || seen.has(`${elementKey}|${next.type}`))
        continue;
      seen.add(`${elementKey}|${next.type}`);
      changes.push({
        elementKey,
        element: element.name,
        property: next.type,
        ...(current ? { from: current.value } : {}),
        to: next.value,
      });
    }
    return changes.length
      ? [{ title: suggestion.title, rationale: suggestion.rationale, changes, skipped }]
      : [];
  });
}

/** Re-checks chosen changes against the document's current version and builds a change set. */
export function suggestionChangeSet(
  changes: Array<{ elementKey: string; property: PropertyValue["type"]; to: unknown }>,
  context: Context,
): ChangeSet {
  const reply: SuggestionReply = {
    suggestions: [
      {
        title: "t",
        rationale: "r",
        changes: changes.map((c) => {
          const index = context.elements.findIndex(
            (e) => nativeIdentity(e.native, context.identityFields) === c.elementKey,
          );
          const value =
            c.property === "text.font"
              ? (c.to as { postScriptName?: string })?.postScriptName
              : c.to;
          return {
            layer: index >= 0 ? `L${index + 1}` : "missing",
            property: c.property,
            value: value as string | number,
          };
        }),
      },
    ],
  };
  const [checked] = validateSuggestions(reply, context);
  if (!checked || checked.changes.length !== changes.length)
    throw new Error("The document changed since this suggestion; ask for new suggestions");
  const changeSet: ChangeSet = { mappings: [], changes: [] };
  const ids = new Map<string, string>();
  for (const change of checked.changes) {
    let elementId = ids.get(change.elementKey);
    if (!elementId) {
      elementId = randomUUID();
      ids.set(change.elementKey, elementId);
      const element = context.elements.find(
        (e) => nativeIdentity(e.native, context.identityFields) === change.elementKey,
      )!;
      changeSet.mappings.push({
        elementId,
        role: `element_${changeSet.mappings.length + 1}`,
        kind: element.kind,
        native: element.native,
      });
    }
    changeSet.changes.push({
      elementId,
      property: { type: change.property, value: change.to } as PropertyValue,
    });
  }
  return changeSet;
}

/** Plain-language description of the document's editable layers for the prompt. */
export function describeLayers(elements: Element[]): string {
  return layerIds(elements)
    .map(({ id, element }) => {
      const props = element.properties
        .map((p) => {
          const v =
            p.type === "text.font"
              ? (p.value as { postScriptName: string }).postScriptName
              : String(p.value);
          return `${p.type}=${JSON.stringify(v)}`;
        })
        .join(", ");
      return `${id}: ${element.kind} layer "${element.name}"${element.editable ? "" : " (not editable)"}: ${props}`;
    })
    .join("\n");
}
