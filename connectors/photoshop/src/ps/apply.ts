import type { PropertyValue } from "@sonder/contracts";
import { action, app } from "photoshop";
import type { Document } from "photoshop/dom/Document";
import type { Layer } from "photoshop/dom/Layer";

import { hexToRgbDescriptor } from "../core/colors";

function solidColor(hex: string) {
  const color = new app.SolidColor();
  color.rgb.hexValue = hex.replace(/^#/, "");
  return color;
}

/**
 * Applies one validated property to one layer. Must run inside executeAsModal
 * with `doc` active. Callers validate first; this only maps values to APIs.
 */
export async function applyProperty(
  doc: Document,
  layer: Layer,
  property: PropertyValue,
): Promise<void> {
  switch (property.type) {
    case "text.content":
      layer.textItem.contents = property.value;
      return;
    case "text.font":
      layer.textItem.characterStyle.font = property.value.postScriptName;
      return;
    case "text.size":
      layer.textItem.characterStyle.size = property.value;
      return;
    case "text.color":
      layer.textItem.characterStyle.color = solidColor(property.value);
      return;
    case "fill.color":
      // Photoshop ignores `set` on a contentLayer addressed by id, so select the
      // layer and target it the way recorded actions do.
      await action.batchPlay(
        [
          { _obj: "select", _target: [{ _ref: "layer", _id: layer.id }], makeVisible: false },
          {
            _obj: "set",
            _target: [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }],
            to: { _obj: "solidColorLayer", color: hexToRgbDescriptor(property.value) },
          },
        ],
        {},
      );
      return;
  }
}
