import { readsDeclaredPath } from "./reads-declared-path.js";

/**
 * KERNEL — generic projection engine.
 *
 * Builds a target object from a declared field map. Each target key is a dotted
 * path, and each value declares where the material comes from:
 *
 *   "$.some.path"              read that path from the source
 *   { "value": x }             a declared constant
 *   { "path": p, "default": d} read p, falling back to a declared default
 *   { "paths": [a, b] }        the first path that yields a value
 *
 * This engine performs no domain mapping of its own. It does not know that
 * prompt_tokens becomes inputTokens; a projection document says so.
 */

export type FieldSource =
  | string
  | Readonly<{ value: unknown }>
  | Readonly<{ path: string; default?: unknown }>
  | Readonly<{ paths: readonly string[]; default?: unknown }>;

export type DeclaredProjection = Readonly<{
  projectionId: string;
  from?: string;
  to?: string;
  fields: Readonly<Record<string, FieldSource>>;
}>;

/** Projects one source value into the declared target shape. */
export function executesDeclaredProjection(
  projection: DeclaredProjection,
  source: unknown,
  root: unknown = source
): Record<string, unknown> {
  return Object.entries(projection.fields).reduce<Record<string, unknown>>(
    (target, [targetPath, fieldSource]) =>
      assignsDeclaredPath(target, targetPath, readsFieldSource(fieldSource, source, root)),
    {}
  );
}

/** Resolves one declared field source to its value. */
export function readsFieldSource(
  fieldSource: FieldSource,
  source: unknown,
  root: unknown
): unknown {
  const literal = typeof fieldSource === "string" ? fieldSource : null;

  const fromLiteralPath =
    literal !== null ? readsDeclaredPath(stripsPrefix(literal), source, root) : undefined;

  const declared = literal === null ? (fieldSource as Record<string, unknown>) : {};

  const fromConstant = Object.hasOwn(declared, "value")
    ? declared.value
    : undefined;

  const fromSinglePath =
    typeof declared.path === "string"
      ? readsDeclaredPath(stripsPrefix(declared.path), source, root)
      : undefined;

  const fromFirstPresentPath = Array.isArray(declared.paths)
    ? (declared.paths as readonly string[])
        .map((path) => readsDeclaredPath(stripsPrefix(path), source, root))
        .find((value) => value !== undefined && value !== null)
    : undefined;

  const observed =
    literal !== null
      ? fromLiteralPath
      : Object.hasOwn(declared, "value")
        ? fromConstant
        : (fromSinglePath ?? fromFirstPresentPath);

  const declaredDefault = Object.hasOwn(declared, "default")
    ? declared.default
    : null;

  return observed === undefined ? declaredDefault : observed;
}

/** Projection documents address the source root as "$."; paths do not. */
function stripsPrefix(path: string): string {
  return path.startsWith("$.") ? path.slice(2) : path;
}

/** Writes a value at a dotted target path, creating intermediate objects. */
export function assignsDeclaredPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const segments = path.split(".");
  const leaf = segments[segments.length - 1] as string;

  const container = segments
    .slice(0, -1)
    .reduce<Record<string, unknown>>((current, segment) => {
      const existing = current[segment];

      const next =
        typeof existing === "object" && existing !== null && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};

      current[segment] = next;

      return next;
    }, target);

  container[leaf] = value;

  return target;
}
