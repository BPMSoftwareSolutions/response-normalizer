/**
 * ADAPTER — mechanical JSON parsing.
 *
 * Calls JSON.parse and reports the observed outcome. It does not decide
 * whether parsing was authorized, whether a failure is repairable, or what a
 * failure means for the response. That meaning lives in the decisions under
 * authority/decisions/.
 */

export type ObservedParse =
  | Readonly<{ parsed: true; value: unknown }>
  | Readonly<{ parsed: false; value: null }>;

export function parsesJsonText(text: string): ObservedParse {
  try {
    return Object.freeze({ parsed: true as const, value: JSON.parse(text) });
  } catch {
    return Object.freeze({ parsed: false as const, value: null });
  }
}

/** Serializes a value the provider already supplied in structured form. */
export function serializesJsonValue(value: unknown): string {
  return JSON.stringify(value);
}
