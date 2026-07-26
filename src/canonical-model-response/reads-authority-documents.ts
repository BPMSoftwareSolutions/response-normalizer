import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  DiagnosticSeverity,
  NormalizationPolicy,
  ResponseDisposition,
} from "../shared/response-normalizer-contract.js";

/**
 * Loads the language-neutral authority documents.
 *
 * The JSON under authority/ is the source of truth. These readers exist so the
 * running code is a projection of that truth rather than a second, drifting
 * copy of it. Documents are read once and cached: the authority is immutable
 * for the life of the process.
 */

const AUTHORITY_ROOT = new URL("../../authority/", import.meta.url);

const cache = new Map<string, unknown>();

function readsAuthorityDocument<T>(fileName: string): T {
  const cached = cache.get(fileName);

  if (cached !== undefined) {
    return cached as T;
  }

  const path = fileURLToPath(new URL(fileName, AUTHORITY_ROOT));
  const parsed = JSON.parse(readFileSync(path, "utf8")) as T;

  cache.set(fileName, parsed);

  return parsed;
}

export type JsonSchemaDocument = Record<string, unknown>;

export function readsCanonicalResponseSchema(): JsonSchemaDocument {
  return readsAuthorityDocument<JsonSchemaDocument>(
    "canonical-model-response.schema.json"
  );
}

export function readsNormalizationPolicySchema(): JsonSchemaDocument {
  return readsAuthorityDocument<JsonSchemaDocument>(
    "normalization-policy.schema.json"
  );
}

export function readsDefaultNormalizationPolicy(): NormalizationPolicy {
  return readsAuthorityDocument<NormalizationPolicy>(
    "default-normalization-policy.json"
  );
}

export type FinishDispositionDecision = Readonly<{
  decisionId: string;
  matching: Readonly<{
    providerFinishReason: "case-sensitive" | "case-insensitive";
    order: "first-matching-rule-wins";
  }>;
  rules: readonly Readonly<{
    ruleId: string;
    when: Readonly<{
      providerId?: string | null;
      providerFinishReason?: readonly string[] | null | "*";
      refusalPresent?: boolean;
      safetyBlocked?: boolean;
      toolCallsPresent?: boolean;
    }>;
    then: ResponseDisposition;
    diagnostic?: Readonly<{
      code: string;
      severity: DiagnosticSeverity;
      path: string;
      message: string;
    }>;
  }>[];
}>;

export function readsFinishDispositionDecision(): FinishDispositionDecision {
  return readsAuthorityDocument<FinishDispositionDecision>(
    "finish-disposition.decision.v1.json"
  );
}
