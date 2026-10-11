/** Photoshop action descriptors call the green channel `grain`. */
export interface RgbDescriptor {
  _obj?: string;
  red: number;
  grain?: number;
  green?: number;
  blue: number;
}

const channel = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();

export function rgbDescriptorToHex(color: RgbDescriptor): string {
  const green = color.grain ?? color.green;
  if (green === undefined) throw new Error("RGB descriptor has no green channel");
  return `#${channel(color.red)}${channel(green)}${channel(color.blue)}`;
}

export function hexToRgbDescriptor(
  hex: string,
): Required<Pick<RgbDescriptor, "_obj" | "red" | "grain" | "blue">> {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Invalid hex color: ${hex}`);
  return {
    _obj: "RGBColor",
    red: parseInt(match[1]!, 16),
    grain: parseInt(match[2]!, 16),
    blue: parseInt(match[3]!, 16),
  };
}

/** Normalises DOM hex values (`ff0000`, `#FF0000`) to `#FF0000`. */
export function normalizeHex(hex: string): string {
  return `#${hex.replace(/^#/, "").toUpperCase()}`;
}
