import { readsCanonicalResponseSchema } from "../canonical-model-response/reads-authority-documents.js";
import { validatesAgainstSchema } from "../canonical-model-response/validates-against-schema.js";
import type {
  CanonicalModelResponse,
  NormalizationFailure,
  NormalizationPolicy,
} from "../shared/response-normalizer-contract.js";

/**
 * Enforces the canonical contract on an adapter's work.
 *
 * Two classes of defect are caught here. The schema catches structural
 * violations — a noncanonical disposition, a missing provider identity, a
 * parsed value attached to unparseable testimony. The semantic checks catch an
 * adapter fabricating arithmetic the provider never testified to.
 */

export type ProjectionValidation =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; failure: NormalizationFailure }>;

export function validatesCanonicalResponseProjection(
  response: CanonicalModelResponse,
  policy: NormalizationPolicy
): ProjectionValidation {
  const violations = validatesAgainstSchema(
    response,
    readsCanonicalResponseSchema()
  );

  if (violations.length > 0) {
    const first = violations[0];

    return rejects(
      `The canonical projection violates the response contract: ${first?.path} ${first?.message}`,
      first?.path
    );
  }

  return validatesUsageTestimony(response, policy);
}

/**
 * A total the provider did not report may only appear when policy authorizes a
 * derived total and both operands were observed. Anything else is invention.
 */
function validatesUsageTestimony(
  response: CanonicalModelResponse,
  policy: NormalizationPolicy
): ProjectionValidation {
  const { usage } = response;

  if (usage.disposition === "unavailable" || usage.disposition === "not-applicable") {
    return Object.freeze({ valid: true as const });
  }

  const { inputTokens, outputTokens, totalTokens } = usage;

  if (totalTokens === null) {
    return Object.freeze({ valid: true as const });
  }

  const bothOperandsObserved = inputTokens !== null && outputTokens !== null;

  if (bothOperandsObserved) {
    const sum = (inputTokens as number) + (outputTokens as number);

    // A provider may legitimately report a total that exceeds input + output,
    // since some providers bill reasoning tokens separately. A total *below*
    // the sum of its own parts is arithmetic no provider testimony supports.
    if (totalTokens < sum && !policy.usage.allowDerivedTotal) {
      return rejects(
        `The projected totalTokens (${totalTokens}) is less than the sum of the observed input and output tokens (${sum}).`,
        "$.usage.totalTokens"
      );
    }

    return Object.freeze({ valid: true as const });
  }

  // Only one operand was observed, so the total must be the provider's own.
  if (usage.disposition === "observed") {
    return rejects(
      "The usage disposition claims full observation but the projection is missing an observed token count.",
      "$.usage.disposition"
    );
  }

  return Object.freeze({ valid: true as const });
}

function rejects(detail: string, pointer?: string): ProjectionValidation {
  const failure: NormalizationFailure = Object.freeze({
    code: "CANONICAL_PROJECTION_INVALID" as const,
    detail,
    ...(pointer ? { pointer } : {}),
  });

  return Object.freeze({ valid: false as const, failure });
}
