import { action, app, constants, core } from "photoshop";

import { hexToRgbDescriptor } from "../core/colors";
import { asPsEntry, type FileEntry, type Folder } from "../ps/files";
import { installedFonts } from "../ps/fonts";

/** Common fonts, in preference order. The fixture uses the first two installed. */
const PREFERRED_FONTS = [
  "ArialMT",
  "Georgia",
  "TimesNewRomanPSMT",
  "Helvetica",
  "Verdana",
  "CourierNewPSMT",
  "MyriadPro-Regular",
];

export const FIXTURE = {
  width: 800,
  height: 600,
  /** 72 ppi keeps points and pixels equal, so sizes round-trip exactly. */
  resolution: 72,
  background: { layerName: "Background Color", color: "#1E3A5F" },
  headline: { layerName: "Headline", contents: "Sonder Poster", size: 64, color: "#FFFFFF" },
  body: { layerName: "Body", contents: "Feasibility test", size: 24, color: "#E0E0E0" },
};

export function pickFonts(): [string, string] {
  const installed = installedFonts();
  const available = PREFERRED_FONTS.filter((name) => installed.has(name));
  if (available.length < 2) {
    const any = [...installed.keys()].filter((name) => !available.includes(name));
    available.push(...any.slice(0, 2 - available.length));
  }
  if (available.length < 2) throw new Error("Fewer than two fonts are installed");
  return [available[0]!, available[1]!];
}

function solidColor(hex: string) {
  const color = new app.SolidColor();
  color.rgb.hexValue = hex.replace(/^#/, "");
  return color;
}

/**
 * Creates the test PSD: an RGB document with a solid-color fill layer and two
 * uniformly formatted text layers, saved to `folder/fixture.psd` and closed.
 */
export async function createFixture(folder: Folder, headlineFont: string): Promise<FileEntry> {
  const file = await folder.createFile("fixture.psd", { overwrite: true });
  await core.executeAsModal(
    async () => {
      const doc = await app.documents.add({
        name: "sonder-fixture",
        width: FIXTURE.width,
        height: FIXTURE.height,
        resolution: FIXTURE.resolution,
        mode: constants.NewDocumentMode.RGB,
        fill: constants.DocumentFill.WHITE,
      });
      if (!doc) throw new Error("Photoshop did not create the fixture document");
      await action.batchPlay(
        [
          {
            _obj: "make",
            _target: [{ _ref: "contentLayer" }],
            using: {
              _obj: "contentLayer",
              name: FIXTURE.background.layerName,
              type: {
                _obj: "solidColorLayer",
                color: hexToRgbDescriptor(FIXTURE.background.color),
              },
            },
          },
        ],
        {},
      );
      for (const [spec, y] of [
        [FIXTURE.headline, 220],
        [FIXTURE.body, 320],
      ] as const) {
        const layer = await doc.createTextLayer({
          contents: spec.contents,
          fontName: headlineFont,
          fontSize: spec.size,
          textColor: solidColor(spec.color),
          position: { x: 80, y },
        });
        if (!layer) throw new Error(`Photoshop did not create the ${spec.layerName} layer`);
        // Photoshop 27.8 ignores the `name` option and names text layers after their contents.
        layer.name = spec.layerName;
      }
      await doc.saveAs.psd(asPsEntry(file));
      await doc.close(constants.SaveOptions.DONOTSAVECHANGES);
    },
    { commandName: "Sonder: create test PSD" },
  );
  return file;
}
