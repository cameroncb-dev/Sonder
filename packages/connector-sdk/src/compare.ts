import { type Element, propertyValuesEqual } from "@sonder/contracts";

export interface ElementDifference {
  element: string;
  property?: string;
  expected?: unknown;
  actual?: unknown;
  reason: "missing" | "unexpected" | "changed";
}

/**
 * Compares element lists by a connector-supplied identity key. Used to check
 * that reopened snapshots and candidates preserve expected content.
 */
export function diffElements(
  expected: Element[],
  actual: Element[],
  key: (element: Element) => string,
): ElementDifference[] {
  const differences: ElementDifference[] = [];
  const actualByKey = new Map(actual.map((element) => [key(element), element]));
  for (const want of expected) {
    const id = key(want);
    const got = actualByKey.get(id);
    actualByKey.delete(id);
    if (!got) {
      differences.push({ element: id, reason: "missing" });
      continue;
    }
    for (const property of want.properties) {
      const other = got.properties.find((p) => p.type === property.type);
      if (!other || !propertyValuesEqual(property, other)) {
        differences.push({
          element: id,
          property: property.type,
          expected: property.value,
          actual: other?.value,
          reason: "changed",
        });
      }
    }
  }
  for (const id of actualByKey.keys()) differences.push({ element: id, reason: "unexpected" });
  return differences;
}
