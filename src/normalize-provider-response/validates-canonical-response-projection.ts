import { readsCanonicalResponseSchema } from "../adapters/reads-authority-documents.js";
import { validatesAgainstSchema } from "../kernel/validates-against-schema.js";
import type {
  CanonicalModelResponse,
  NormalizationFailure,
  NormalizationPolicy,
} from "../shared/response-normalizer-contract.js";

/**
 * Enforces the canonical contract on an adapter's work.
 *
 * The schema catches structural violations — a noncanonical disposition, a
 * missing provider identity, a parsed value attached to unparseable testimony.
 * The usage assertions below catch an adapter fabricating arithmetic the
 * provider never testified to.
 */

export type ProjectionValidation =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; failure: NormalizationFailure }>;

type UsageAssertion = Readonly<{
  pointer: string;
  detail: (facts: UsageFacts) => string;
  violated: (facts: UsageFacts) => boolean;
}>;

type UsageFacts = Readonly<{
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  disposition: CanonicalModelResponse["usage"]["disposition"];
  allowDerivedTotal: boolean;
}>;

/**
 * A provider may legitimately report a total exceeding input + output, since
 * some bill reasoning separately. A total *below* the sum of its own parts is
 * arithmetic no provider testimony supports.
 */
const USAGE_ASSERTIONS: readonly UsageAssertion[] = Object.freeze([
  {
    pointer: "$.usage.totalTokens",
    detail: ({ totalTokens, inputTokens, outputTokens }) =>
      `The projected totalTokens (${totalTokens}) is less than the sum of the observed input and output tokens (${(inputTokens ?? 0) + (outputTokens ?? 0)}).`,
    violated: ({ inputTokens, outputTokens, totalTokens, allowDerivedTotal }) =>
      inputTokens !== null &&
      outputTokens !== null &&
      totalTokens !== null &&
      totalTokens < inputTokens + outputTokens &&
      !allowDerivedTotal,
  },
  {
    pointer: "$.usage.disposition",
    detail: () =>
      "The usage disposition claims full observation but the projection is missing an observed token count.",
    violated: ({ inputTokens, outputTokens, disposition }) =>
      disposition === "observed" && (inputTokens === null || outputTokens === null),
  },
]);

export function validatesCanonicalResponseProjection(
  response: CanonicalModelResponse,
  policy: NormalizationPolicy
): ProjectionValidation {
  const violations = validatesAgainstSchema(
    response,
    readsCanonicalResponseSchema()
  );

  const schemaFailure = whenPresent(violations[0], (violation) =>
    rejects(
      `The canonical projection violates the response contract: ${violation.path} ${violation.message}`,
      violation.path
    )
  );

  const facts: UsageFacts = Object.freeze({
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.totalTokens,
    disposition: response.usage.disposition,
    allowDerivedTotal: policy.usage.allowDerivedTotal,
  });

  const usageApplies = !UNCOUNTED_DISPOSITIONS.includes(facts.disposition);

  const breached = USAGE_ASSERTIONS.find(
    (assertion) => usageApplies && assertion.violated(facts)
  );

  const usageFailure = whenPresent(breached, (assertion) =>
    rejects(assertion.detail(facts), assertion.pointer)
  );

  return schemaFailure ?? usageFailure ?? Object.freeze({ valid: true as const });
}

/** Dispositions that carry no counts, so the arithmetic assertions do not apply. */
const UNCOUNTED_DISPOSITIONS: readonly string[] = Object.freeze([
  "unavailable",
  "not-applicable",
]);

function rejects(detail: string, pointer?: string): ProjectionValidation {
  return Object.freeze({
    valid: false as const,
    failure: Object.freeze({
      code: "CANONICAL_PROJECTION_INVALID" as const,
      detail,
      ...(pointer ? { pointer } : {}),
    }),
  });
}

function whenPresent<T, R>(
  value: T | undefined,
  produces: (present: T) => R
): R | undefined {
  return value === undefined ? undefined : produces(value);
}
