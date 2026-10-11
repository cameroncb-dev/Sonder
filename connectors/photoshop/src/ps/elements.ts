import type { DocumentInfo, Element, PropertyValue } from "@sonder/contracts";
import { action, app, constants } from "photoshop";
import type { Document } from "photoshop/dom/Document";
import type { Layer } from "photoshop/dom/Layer";

import { normalizeHex, type RgbDescriptor, rgbDescriptorToHex } from "../core/colors";
import { layerRef } from "../core/identity";
import { hasMixedFormatting, type TextStyleRange } from "../core/textStyles";
import { installedFonts } from "./fonts";

export function documentInfo(doc: Document): DocumentInfo {
  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    resolution: doc.resolution,
    colorMode: String(doc.mode),
  };
}

export function findDocument(id: number): Document | undefined {
  for (let i = 0; i < app.documents.length; i++) {
    const doc = app.documents[i];
    if (doc?.id === id) return doc;
  }
  return undefined;
}

/** All layers, depth-first, including those inside groups. */
export function allLayers(doc: Document): Layer[] {
  const result: Layer[] = [];
  const visit = (layers: ArrayLike<Layer> | null) => {
    if (!layers) return;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!;
      result.push(layer);
      if (layer.kind === constants.LayerKind.GROUP) visit(layer.layers);
    }
  };
  visit(doc.layers);
  return result;
}

export function findLayer(doc: Document, layerId: number): Layer | undefined {
  return allLayers(doc).find((layer) => layer.id === layerId);
}

async function getLayerProperty<T>(
  doc: Document,
  layer: Layer,
  property: string,
): Promise<T | undefined> {
  const [result] = await action.batchPlay(
    [
      {
        _obj: "get",
        _target: [
          { _property: property },
          { _ref: "layer", _id: layer.id },
          { _ref: "document", _id: doc.id },
        ],
      },
    ],
    {},
  );
  return (result as Record<string, unknown> | undefined)?.[property] as T | undefined;
}

export async function readFillColor(doc: Document, layer: Layer): Promise<string> {
  const adjustment = await getLayerProperty<Array<{ _obj?: string; color?: RgbDescriptor }>>(
    doc,
    layer,
    "adjustment",
  );
  const fill = adjustment?.find((entry) => entry.color);
  if (!fill?.color) throw new Error(`Layer "${layer.name}" has no solid fill color`);
  return rgbDescriptorToHex(fill.color);
}

async function readTextElement(doc: Document, layer: Layer): Promise<Element> {
  const textKey = await getLayerProperty<{ textStyleRange?: TextStyleRange[] }>(
    doc,
    layer,
    "textKey",
  );
  const mixed = hasMixedFormatting(textKey?.textStyleRange);
  const style = layer.textItem.characterStyle;
  const font = installedFonts().get(style.font);
  const properties: PropertyValue[] = [
    { type: "text.content", value: layer.textItem.contents },
    {
      type: "text.font",
      value: {
        postScriptName: style.font,
        ...(font ? { family: font.family, style: font.style } : {}),
      },
    },
    { type: "text.size", value: Math.round(style.size * 100) / 100 },
    { type: "text.color", value: normalizeHex(style.color.rgb.hexValue) },
  ];
  return {
    native: layerRef(layer.id, layer.name),
    kind: "text",
    name: layer.name,
    properties,
    editable: !mixed,
    ...(mixed ? { notEditableReason: "Layer uses more than one font, size or color" } : {}),
  };
}

/** Reads every supported element. Unsupported layer kinds are skipped. */
export async function readElements(doc: Document): Promise<Element[]> {
  const elements: Element[] = [];
  for (const layer of allLayers(doc)) {
    if (layer.kind === constants.LayerKind.TEXT) {
      elements.push(await readTextElement(doc, layer));
    } else if (layer.kind === constants.LayerKind.SOLIDFILL) {
      elements.push({
        native: layerRef(layer.id, layer.name),
        kind: "solid_fill",
        name: layer.name,
        properties: [{ type: "fill.color", value: await readFillColor(doc, layer) }],
        editable: true,
      });
    }
  }
  return elements;
}
