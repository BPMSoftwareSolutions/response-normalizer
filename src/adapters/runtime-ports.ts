import { createHash } from "node:crypto";
import type { Clock, HashPort, IdentityPort } from "../shared/response-normalizer-contract.js";

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order so
 * that the same semantic value always produces the same bytes, and therefore
 * the same hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortsKeysDeeply(value));
}

function sortsKeysDeeply(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortsKeysDeeply);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;

  return Object.keys(source)
    .sort()
    .reduce<Record<string, unknown>>((accumulated, key) => {
      accumulated[key] = sortsKeysDeeply(source[key]);
      return accumulated;
    }, {});
}

export const sha256Hashes: HashPort = Object.freeze({
  hashes(value: unknown): string {
    return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
  },
});

export const systemClock: Clock = Object.freeze({
  now(): Date {
    return new Date();
  },
});

export const randomIdentity: IdentityPort = Object.freeze({
  newResponseId(): string {
    return `response-${crypto.randomUUID()}`;
  },
});

/**
 * A clock frozen at one instant. Byte-stability claims are proven with this
 * rather than by weakening the claim itself.
 */
export function createsFixedClock(instant: string): Clock {
  return Object.freeze({
    now: (): Date => new Date(instant),
  });
}

/** An identity source that counts, so repeated runs produce equal identifiers. */
export function createsSequentialIdentity(prefix = "response"): IdentityPort {
  let issued = 0;

  return Object.freeze({
    newResponseId: (): string => {
      issued += 1;
      return `${prefix}-${String(issued).padStart(4, "0")}`;
    },
  });
}
