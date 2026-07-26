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
import { satisfiesDeclaredPredicate } from "../kernel/reads-declared-path.js";

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

/**
 * Evaluates the dialect's declared recognition predicates.
 *
 * A dialect is recognized when every "requires" predicate holds, at least one
 * "anyOf" predicate holds when any are declared, and the dialect declared at
 * least one predicate to begin with.
 */
export function recognizesDeclaredDialect(
  dialect: ProviderDialect,
  response: unknown
): ProviderResponseRecognition {
  const { requires, anyOf, detail } = dialect.recognition;

  const isJsonObject =
    typeof response === "object" && response !== null && !Array.isArray(response);

  const requiredHold = (requires ?? []).every((predicate) =>
    satisfiesDeclaredPredicate(predicate, response, response)
  );

  const alternativesHold =
    anyOf === undefined ||
    anyOf.length === 0 ||
    anyOf.some((predicate) =>
      satisfiesDeclaredPredicate(predicate, response, response)
    );

  const declaresPredicates = (requires ?? []).length > 0 || anyOf !== undefined;

  const recognized =
    isJsonObject && requiredHold && alternativesHold && declaresPredicates;

  return recognized
    ? { recognized: true, confidence: "exact" }
    : {
        recognized: false,
        detail: isJsonObject ? detail : "The response is not a JSON object.",
      };
}

const DIALECT_ROOT = new URL("../../authority/dialects/", import.meta.url);

let declaredDialects: readonly ProviderDialect[] | null = null;

/** Loads every declared dialect document, in stable filename order. */
export function readsDeclaredDialects(): readonly ProviderDialect[] {
  declaredDialects = declaredDialects ?? loadsDialects();

  return declaredDialects;
}

function loadsDialects(): readonly ProviderDialect[] {
  return Object.freeze(
    readdirSync(fileURLToPath(DIALECT_ROOT))
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map(
        (entry) =>
          JSON.parse(
            readFileSync(fileURLToPath(new URL(entry, DIALECT_ROOT)), "utf8")
          ) as ProviderDialect
      )
  );
}

/** The adapter set every declared dialect provides. */
export function readsDeclaredAdapters(): readonly ProviderResponseAdapter[] {
  return Object.freeze(readsDeclaredDialects().map(createsDeclaredAdapter));
}
