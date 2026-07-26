import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DeclaredDecision } from "../kernel/resolves-declared-decision.js";
import type { NormalizationPolicy } from "../shared/response-normalizer-contract.js";

/**
 * ADAPTER — reads the language-neutral authority documents from disk.
 *
 * The JSON under authority/ is the source of truth. This adapter performs file
 * mechanics only: it locates and parses documents and decides nothing about
 * what they mean. Documents are cached because the authority is immutable for
 * the life of the process.
 */

const AUTHORITY_ROOT = new URL("../../authority/", import.meta.url);

const cache = new Map<string, unknown>();

function readsAuthorityDocument<T>(relativePath: string): T {
  const cached = cache.get(relativePath);

  return cached === undefined ? cachesDocument<T>(relativePath) : (cached as T);
}

function cachesDocument<T>(relativePath: string): T {
  const path = fileURLToPath(new URL(relativePath, AUTHORITY_ROOT));
  const parsed = JSON.parse(readFileSync(path, "utf8")) as T;

  cache.set(relativePath, parsed);

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

export function readsDecisionSchema(): JsonSchemaDocument {
  return readsAuthorityDocument<JsonSchemaDocument>("decision.schema.v1.json");
}

export function readsProviderDialectSchema(): JsonSchemaDocument {
  return readsAuthorityDocument<JsonSchemaDocument>(
    "provider-dialect.schema.v1.json"
  );
}

export function readsDefaultNormalizationPolicy(): NormalizationPolicy {
  return readsAuthorityDocument<NormalizationPolicy>(
    "default-normalization-policy.json"
  );
}

/** Loads one declared decision by its identifier. */
export function readsDeclaredDecision(decisionId: string): DeclaredDecision {
  return readsAuthorityDocument<DeclaredDecision>(
    `decisions/${decisionId}.decision.v1.json`
  );
}

const DECISION_ROOT = new URL("decisions/", AUTHORITY_ROOT);

/** Loads every declared decision, in stable filename order. */
export function readsAllDeclaredDecisions(): readonly DeclaredDecision[] {
  return Object.freeze(
    readdirSync(fileURLToPath(DECISION_ROOT))
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map((entry) =>
        readsAuthorityDocument<DeclaredDecision>(`decisions/${entry}`)
      )
  );
}

export function readsExecutionPlan(): Record<string, unknown> {
  return readsAuthorityDocument<Record<string, unknown>>(
    "execution-model/normalize-provider-response.plan.v1.json"
  );
}
