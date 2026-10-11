import {
  ChangeSet,
  type ConnectorManifest,
  type Issue,
  type ValidationResult,
} from "@sonder/contracts";

/**
 * Application-agnostic checks: schema, unique mappings, every change targets a
 * mapped element, and each property is supported for that element kind.
 * Connectors add native checks (object exists, font installed) on top.
 */
export function validateChangeSetShape(
  manifest: ConnectorManifest,
  input: unknown,
): { result: ValidationResult; changeSet?: ChangeSet } {
  const parsed = ChangeSet.safeParse(input);
  if (!parsed.success) {
    return {
      result: {
        ok: false,
        issues: parsed.error.issues.map((issue) => ({
          code: "INVALID_VALUE" as const,
          message: `${issue.path.join(".") || "changeSet"}: ${issue.message}`,
        })),
      },
    };
  }
  const changeSet = parsed.data;
  const issues: Issue[] = [];

  const seenRoles = new Set<string>();
  const seenElements = new Set<string>();
  for (const mapping of changeSet.mappings) {
    if (seenRoles.has(mapping.role)) {
      issues.push({
        code: "DUPLICATE_ROLE",
        message: `Role "${mapping.role}" is mapped more than once`,
        role: mapping.role,
      });
    }
    if (seenElements.has(mapping.elementId)) {
      issues.push({
        code: "DUPLICATE_ELEMENT",
        message: `Element ${mapping.elementId} is mapped more than once`,
        elementId: mapping.elementId,
      });
    }
    seenRoles.add(mapping.role);
    seenElements.add(mapping.elementId);
  }

  const kindProperties = new Map(
    manifest.elementKinds.map((k) => [k.kind, new Set<string>(k.properties)]),
  );
  const mappingById = new Map(changeSet.mappings.map((m) => [m.elementId, m]));
  for (const change of changeSet.changes) {
    const mapping = mappingById.get(change.elementId);
    if (!mapping) {
      issues.push({
        code: "ROLE_UNMAPPED",
        message: `Change targets unmapped element ${change.elementId}`,
        elementId: change.elementId,
      });
      continue;
    }
    const supported = kindProperties.get(mapping.kind);
    if (!supported?.has(change.property.type)) {
      issues.push({
        code: "UNSUPPORTED_PROPERTY",
        message: `${manifest.application} does not support ${change.property.type} on ${mapping.kind} elements`,
        elementId: change.elementId,
        role: mapping.role,
        property: change.property.type,
      });
    }
  }

  return issues.length ? { result: { ok: false, issues } } : { result: { ok: true }, changeSet };
}
