import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  CanonicalModelResponseProjection,
  NormalizeProviderResponseContext,
  ProviderResponseAdapter,
  ProviderResponseRecognition,
} from "../shared/response-normalizer-contract.js";
import { projectsDeclaredDialect } from "./projects-declared-dialect.js";
import type { ProviderDialect } from "./provider-dialect.type.js";
import { satisfiesDeclaredPredicate } from "./reads-declared-path.js";

/**
 * Turns a declared dialect document into a provider response adapter.
 *
 * Adding a provider is an authoring act, not a coding act: drop a dialect
 * document into authority/dialects/ and it becomes an available adapter.
 */
export function createsDeclaredAdapter(
  dialect: ProviderDialect
): ProviderResponseAdapter {
  return Object.freeze({
    providerId: dialect.providerId,
    adapterId: dialect.adapterId,
    adapterVersion: dialect.adapterVersion,

    recognizes(response: unknown): ProviderResponseRecognition {
      return recognizesDeclaredDialect(dialect, response);
    },

    projectsCanonicalResponse(
      context: NormalizeProviderResponseContext
    ): CanonicalModelResponseProjection {
      return projectsDeclaredDialect(dialect, context);
    },
  });
}

/** Evaluates the dialect's declared recognition predicates. */
export function recognizesDeclaredDialect(
  dialect: ProviderDialect,
  response: unknown
): ProviderResponseRecognition {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    return { recognized: false, detail: "The response is not a JSON object." };
  }

  const { requires, anyOf, detail } = dialect.recognition;

  const requiredHold = (requires ?? []).every((predicate) =>
    satisfiesDeclaredPredicate(predicate, response, response)
  );

  if (!requiredHold) {
    return { recognized: false, detail };
  }

  if (anyOf !== undefined && anyOf.length > 0) {
    const anyHold = anyOf.some((predicate) =>
      satisfiesDeclaredPredicate(predicate, response, response)
    );

    if (!anyHold) {
      return { recognized: false, detail };
    }
  }

  if ((requires ?? []).length === 0 && anyOf === undefined) {
    return { recognized: false, detail };
  }

  return { recognized: true, confidence: "exact" };
}

const DIALECT_ROOT = new URL("../../authority/dialects/", import.meta.url);

let declaredDialects: readonly ProviderDialect[] | null = null;

/** Loads every declared dialect document, in stable filename order. */
export function readsDeclaredDialects(): readonly ProviderDialect[] {
  if (declaredDialects !== null) {
    return declaredDialects;
  }

  const directory = fileURLToPath(DIALECT_ROOT);

  const dialects = readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map(
      (entry) =>
        JSON.parse(
          readFileSync(fileURLToPath(new URL(entry, DIALECT_ROOT)), "utf8")
        ) as ProviderDialect
    );

  declaredDialects = Object.freeze(dialects);

  return declaredDialects;
}

/** The adapter set every declared dialect provides. */
export function readsDeclaredAdapters(): readonly ProviderResponseAdapter[] {
  return Object.freeze(readsDeclaredDialects().map(createsDeclaredAdapter));
}
