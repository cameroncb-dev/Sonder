import { type RgbDescriptor, rgbDescriptorToHex } from "./colors";

type UnitValue = number | { _unit?: string; _value: number };

/** Subset of a Photoshop `textKey.textStyleRange` entry. */
export interface TextStyleRange {
  from: number;
  to: number;
  textStyle?: {
    fontPostScriptName?: string;
    size?: UnitValue;
    impliedFontSize?: UnitValue;
    color?: RgbDescriptor;
  };
}

const unitValue = (value: UnitValue | undefined) =>
  typeof value === "number" ? value : value?._value;

function signature(range: TextStyleRange): string {
  const style = range.textStyle ?? {};
  const size = unitValue(style.impliedFontSize ?? style.size);
  const color = style.color ? rgbDescriptorToHex(style.color) : "";
  return `${style.fontPostScriptName ?? ""}|${size === undefined ? "" : size.toFixed(2)}|${color}`;
}

/**
 * A text layer is uniformly formatted when every non-empty style range has the
 * same font, size and color. Mixed formatting is out of scope for the demo.
 */
export function hasMixedFormatting(ranges: TextStyleRange[] | undefined): boolean {
  const signatures = new Set((ranges ?? []).filter((r) => r.to > r.from).map(signature));
  return signatures.size > 1;
}
