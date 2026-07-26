/**
 * Defensive readers for untrusted provider testimony.
 *
 * Every value arriving from a provider is `unknown`. These helpers narrow a
 * value only when it genuinely has the expected shape, and return null
 * otherwise. Nothing here coerces: a number-shaped string stays unread, because
 * silently converting it would be repairing testimony rather than reading it.
 */

export function readsObject(
  value: unknown
): Readonly<Record<string, unknown>> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }

  return null;
}

export function readsString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function readsNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readsArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
