import { readsObject } from "../kernel/reads-provider-values.js";

/**
 * Resolves a declared dialect path against provider testimony.
 *
 * Paths are dotted. A numeric segment indexes an array. Two roots exist:
 *
 *   "field.sub"        relative to the supplied local value
 *   "$root.field.sub"  relative to the whole provider response
 *   "$self"            the local value itself
 *
 * Nothing here interprets meaning; it only locates a value the authority
 * document named.
 */
export function readsDeclaredPath(
  path: string,
  local: unknown,
  root: unknown
): unknown {
  if (path === "$self") {
    return local;
  }

  const fromRoot = path.startsWith("$root.");
  const segments = (fromRoot ? path.slice("$root.".length) : path).split(".");

  let current: unknown = fromRoot ? root : local;

  for (const segment of segments) {
    if (current === undefined || current === null) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);

      if (Number.isNaN(index)) {
        return undefined;
      }

      current = current[index];
      continue;
    }

    const container = readsObject(current);

    if (!container) {
      return undefined;
    }

    current = container[segment];
  }

  return current;
}

export type DeclaredPredicate = Readonly<{
  path: string;
  test:
    | "is-array"
    | "is-object"
    | "is-string"
    | "is-present"
    | "is-true"
    | "equals";
  value?: unknown;
}>;

/** Evaluates one declared recognition or segment predicate. */
export function satisfiesDeclaredPredicate(
  predicate: DeclaredPredicate,
  local: unknown,
  root: unknown
): boolean {
  const observed = readsDeclaredPath(predicate.path, local, root);

  switch (predicate.test) {
    case "is-array":
      return Array.isArray(observed);
    case "is-object":
      return readsObject(observed) !== null;
    case "is-string":
      return typeof observed === "string";
    case "is-present":
      return observed !== undefined && observed !== null;
    case "is-true":
      return observed === true;
    case "equals":
      return observed === predicate.value;
    default:
      return false;
  }
}
