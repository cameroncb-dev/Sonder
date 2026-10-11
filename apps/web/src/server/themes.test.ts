import type { Element } from "@sonder/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));

const { planTheme } = await import("./themes");
type Heads = Parameters<typeof planTheme>[1];

const theme = {
  name: "Broadway",
  colors: { primary: "#112233", background: "#8B1E3F", text: "#FFFFFF", accent: "#FFD700" },
};
const native = (layerId: number) => ({ connector: "photoshop", data: { layerId } });
const elements: Element[] = [
  {
    native: native(1),
    kind: "solid_fill",
    name: "Background",
    properties: [{ type: "fill.color", value: "#1E3A5F" }],
    editable: true,
  },
  {
    native: native(2),
    kind: "text",
    name: "Headline",
    properties: [{ type: "text.color", value: "#FFFFFF" }],
    editable: true,
  },
];
const asset = (id: string, overrides: Partial<Heads[number]> = {}): Heads[number] => ({
  id,
  name: `${id}.psd`,
  application: "photoshop",
  branchId: "b",
  branchName: "main",
  checkpointId: `${id}-head`,
  manifest: { elements, document: { colorMode: "RGBColorMode" } },
  ...overrides,
});
const capabilities = new Map([
  [
    "photoshop",
    {
      application: "photoshop",
      operations: ["createCandidate"],
      elementKinds: [
        { kind: "text" as const, properties: ["text.color" as const] },
        { kind: "solid_fill" as const, properties: ["fill.color" as const] },
      ],
      identityFields: ["layerId"],
      colorModes: ["RGBColorMode"],
    },
  ],
]);
const roles = (assetId: string) => [
  { asset_id: assetId, role: "background", kind: "solid_fill", native_ref: native(1) },
  { asset_id: assetId, role: "headline", kind: "text", native_ref: native(2) },
];
const mappings = (assetId: string) => [
  {
    asset_id: assetId,
    color_role: "background" as const,
    element_role: "background",
    property: "fill.color" as const,
  },
  {
    asset_id: assetId,
    color_role: "text" as const,
    element_role: "headline",
    property: "text.color" as const,
  },
];

describe("planTheme", () => {
  it("builds a change set only for colors that differ", () => {
    const [plan] = planTheme(
      theme,
      [asset("poster")],
      roles("poster"),
      mappings("poster"),
      capabilities,
    );
    expect(plan!.status).toBe("ready");
    // The headline is already white, so only the background changes.
    expect(plan!.changes).toEqual([
      {
        element: "Background",
        role: "background",
        property: "fill.color",
        from: "#1E3A5F",
        to: "#8B1E3F",
      },
    ]);
    const job = plan!.jobParams as {
      changeSet: { changes: unknown[] };
      targetCheckpoint: { id: string };
    };
    expect(job.targetCheckpoint.id).toBe("poster-head");
    expect(job.changeSet.changes).toHaveLength(1);
  });

  it("checks each document independently", () => {
    const plans = planTheme(
      theme,
      [
        asset("poster"),
        asset("flyer", { manifest: { elements, document: { colorMode: "CMYKColorMode" } } }),
        asset("unmapped"),
        asset("uncaptured", { checkpointId: null, manifest: null }),
      ],
      [...roles("poster"), ...roles("flyer"), ...roles("uncaptured")],
      [...mappings("poster"), ...mappings("flyer"), ...mappings("uncaptured")],
      capabilities,
    );
    expect(plans.map((p) => p.status)).toEqual([
      "ready",
      "unsupported",
      "no_mappings",
      "unsupported",
    ]);
    expect(plans[1]!.reasons[0]).toContain("CMYKColorMode");
    expect(plans[3]!.reasons[0]).toContain("Capture");
  });

  it("refuses mappings to layers that are gone or the wrong kind", () => {
    const gone = planTheme(
      theme,
      [
        asset("poster", {
          manifest: { elements: [elements[1]!], document: { colorMode: "RGBColorMode" } },
        }),
      ],
      roles("poster"),
      mappings("poster"),
      capabilities,
    );
    expect(gone[0]!.status).toBe("unsupported");
    expect(gone[0]!.reasons[0]).toContain("no longer in the document");

    const wrongKind = planTheme(
      theme,
      [asset("poster")],
      roles("poster"),
      [
        {
          asset_id: "poster",
          color_role: "accent",
          element_role: "headline",
          property: "fill.color",
        },
      ],
      capabilities,
    );
    expect(wrongKind[0]!.status).toBe("unsupported");
  });

  it("reports documents that already match", () => {
    const matching = { ...theme, colors: { ...theme.colors, background: "#1E3A5F" } };
    expect(
      planTheme(matching, [asset("poster")], roles("poster"), mappings("poster"), capabilities)[0]!
        .status,
    ).toBe("no_changes");
  });

  it("needs a connector that can build candidates", () => {
    const [plan] = planTheme(
      theme,
      [asset("poster")],
      roles("poster"),
      mappings("poster"),
      new Map(),
    );
    expect(plan!.status).toBe("unsupported");
  });
});
