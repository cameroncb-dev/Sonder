import {
  type Element,
  type ElementKindCapability,
  type NativeRef,
  type PropertyType,
  type PropertyValue,
  propertyValuesEqual,
} from "@sonder/contracts";

/**
 * Three-way combination of two versions of the same asset, property by property,
 * against their shared ancestor (the base):
 *
 * - neither changed      → keep the target's value
 * - only source changed  → candidate change, taken unless excluded
 * - only target changed  → already in the target, kept
 * - both changed equally → compatible, already in the target
 * - both changed apart   → conflict, must be resolved explicitly
 *
 * The engine knows nothing about any application: elements are matched by
 * connector-declared identity fields and compared with the shared property rules.
 */

export type MergeStatus = "unchanged" | "target" | "source" | "both_same" | "conflict";
export type Side = "target" | "source";

export interface MergeRow {
  /** Stable element identity within the asset. */
  key: string;
  kind: Element["kind"];
  name: string;
  property: PropertyType;
  base?: PropertyValue["value"];
  target?: PropertyValue["value"];
  source?: PropertyValue["value"];
  status: MergeStatus;
  /** False when the connector can't edit this property on this element in the target. */
  supported: boolean;
  /** Why an unsupported row can't be combined. */
  reason?: string;
}

export interface StructuralChange {
  key: string;
  name: string;
  change:
    | "added_in_source"
    | "removed_in_source"
    | "added_in_target"
    | "removed_in_target"
    | "added_in_both";
}

export interface MergeResult {
  rows: MergeRow[];
  /** Element additions and removals are reported but never combined. */
  structural: StructuralChange[];
}

/** Resolutions keyed by `rowId(row)`. Missing keys take the default for the row's status. */
export type Resolutions = Record<string, Side>;

export const rowId = (row: Pick<MergeRow, "key" | "property">) => `${row.key}|${row.property}`;

/** Identity of an element across versions: the declared fields of its native ref, or all of it. */
export function nativeIdentity(native: NativeRef, identityFields?: string[]): string {
  const data = identityFields
    ? Object.fromEntries(identityFields.map((field) => [field, native.data[field]]))
    : native.data;
  return `${native.connector}:${stableJson(data)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const equal = (a: PropertyValue | undefined, b: PropertyValue | undefined) =>
  a === undefined || b === undefined ? a === b : propertyValuesEqual(a, b);

export function mergeElements(
  base: Element[],
  target: Element[],
  source: Element[],
  options: { identityFields?: string[]; elementKinds: ElementKindCapability[] },
): MergeResult {
  const keyOf = (e: Element) => nativeIdentity(e.native, options.identityFields);
  const index = (list: Element[]) => new Map(list.map((e) => [keyOf(e), e]));
  const [b, t, s] = [index(base), index(target), index(source)];
  const editable = new Map(options.elementKinds.map((k) => [k.kind, new Set(k.properties)]));

  const rows: MergeRow[] = [];
  const structural: StructuralChange[] = [];
  const keys = [...new Set([...b.keys(), ...t.keys(), ...s.keys()])];

  for (const key of keys) {
    const [eb, et, es] = [b.get(key), t.get(key), s.get(key)];
    const name = (et ?? es ?? eb)!.name;
    if (eb && !es && et) structural.push({ key, name, change: "removed_in_source" });
    if (eb && !et && es) structural.push({ key, name, change: "removed_in_target" });
    if (!eb && es && !et) structural.push({ key, name, change: "added_in_source" });
    if (!eb && et && !es) structural.push({ key, name, change: "added_in_target" });
    // Elements added on both sides are independent additions, even when the application
    // reuses the same native id for them (Photoshop numbers new layers per document).
    if (!eb && et && es) structural.push({ key, name, change: "added_in_both" });
    // Combination edits elements that exist in the target and the source; it never adds or
    // removes them, so everything else stays exactly as the target snapshot has it.
    if (!eb || !et || !es) continue;

    const kind = et.kind;
    const types = new Set(
      [...(eb?.properties ?? []), ...et.properties, ...es.properties].map((p) => p.type),
    );
    for (const property of types) {
      const pb = eb?.properties.find((p) => p.type === property);
      const pt = et.properties.find((p) => p.type === property);
      const ps = es.properties.find((p) => p.type === property);
      const targetChanged = !equal(pb, pt);
      const sourceChanged = !equal(pb, ps);
      const status: MergeStatus =
        !targetChanged && !sourceChanged
          ? "unchanged"
          : targetChanged && sourceChanged
            ? equal(pt, ps)
              ? "both_same"
              : "conflict"
            : sourceChanged
              ? "source"
              : "target";

      const reason = !editable.get(kind)?.has(property)
        ? "The connector cannot edit this property"
        : !et.editable
          ? (et.notEditableReason ?? "This element cannot be edited safely")
          : !ps
            ? "The source has no value for this property"
            : undefined;
      rows.push({
        key,
        kind,
        name: et.name,
        property,
        ...(pb ? { base: pb.value } : {}),
        ...(pt ? { target: pt.value } : {}),
        ...(ps ? { source: ps.value } : {}),
        status,
        supported: !reason,
        ...(reason ? { reason } : {}),
      });
    }
  }
  return { rows, structural };
}

/** Which side a row takes without an explicit choice; conflicts have no default. */
export function defaultSide(row: MergeRow): Side | undefined {
  if (row.status === "conflict") return undefined;
  return row.status === "source" && row.supported ? "source" : "target";
}

export interface CombineIssue {
  code: "CONFLICT_UNRESOLVED" | "UNSUPPORTED_PROPERTY" | "UNKNOWN_ROW";
  rowId: string;
  message: string;
}

export interface CombinePlan {
  /** Properties whose combined value differs from the target, keyed by element identity. */
  changes: Array<{ key: string; property: PropertyValue }>;
  /** Final choice per row, including defaults, for the proposal record. */
  choices: Record<string, Side>;
  issues: CombineIssue[];
}

/**
 * Applies explicit selections and exclusions to a merge. Unresolved conflicts, choices for
 * rows that don't exist, and taking the source for unsupported properties are issues.
 */
export function planCombination(merge: MergeResult, resolutions: Resolutions): CombinePlan {
  const byId = new Map(merge.rows.map((row) => [rowId(row), row]));
  const issues: CombineIssue[] = [];
  for (const id of Object.keys(resolutions)) {
    if (!byId.has(id))
      issues.push({ code: "UNKNOWN_ROW", rowId: id, message: `No combinable property ${id}` });
  }

  const changes: CombinePlan["changes"] = [];
  const choices: Record<string, Side> = {};
  for (const row of merge.rows) {
    const id = rowId(row);
    const side = resolutions[id] ?? defaultSide(row);
    if (!side) {
      issues.push({
        code: "CONFLICT_UNRESOLVED",
        rowId: id,
        message: `${row.name}: ${row.property} changed differently on both branches; choose one`,
      });
      continue;
    }
    choices[id] = side;
    if (side === "target") continue;
    if (!row.supported) {
      issues.push({
        code: "UNSUPPORTED_PROPERTY",
        rowId: id,
        message: `${row.name}: ${row.property} cannot be combined (${row.reason})`,
      });
      continue;
    }
    const value = { type: row.property, value: row.source } as PropertyValue;
    const current =
      row.target === undefined
        ? undefined
        : ({ type: row.property, value: row.target } as PropertyValue);
    if (!equal(current, value)) changes.push({ key: row.key, property: value });
  }
  return { changes, choices, issues };
}

function ancestors(parents: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(parents.get(id) ?? []));
  }
  return seen;
}

/**
 * Lowest common ancestors of two checkpoints (each counts as its own ancestor). A merge base
 * is unambiguous only when there is exactly one; otherwise the caller must choose a baseline.
 */
export function mergeBases(parents: Map<string, string[]>, a: string, b: string): string[] {
  const fromA = ancestors(parents, a);
  const common = [...ancestors(parents, b)].filter((id) => fromA.has(id));
  // Keep only common ancestors that are not an ancestor of another common ancestor.
  return common.filter(
    (id) => !common.some((other) => other !== id && ancestors(parents, other).has(id)),
  );
}
