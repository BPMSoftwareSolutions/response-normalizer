import { readsNormalizationPolicySchema } from "../adapters/reads-authority-documents.js";
import { readsObject } from "../kernel/reads-provider-values.js";
import { validatesAgainstSchema } from "../kernel/validates-against-schema.js";
import type {
  NormalizationFailure,
  NormalizeProviderResponseContext,
} from "../shared/response-normalizer-contract.js";

/**
 * Rejects a normalization request that cannot be honoured.
 *
 * Each requirement below is a declared field check evaluated in order; the
 * first unmet requirement is the failure. The policy is checked against its
 * declared JSON Schema, so an unsupported policy — including any attempt to
 * introduce a semantic-rewriting setting the closed schema does not permit —
 * is refused before any provider testimony is read.
 */

export type RequestValidation =
  | Readonly<{ accepted: true }>
  | Readonly<{ accepted: false; failure: NormalizationFailure }>;

type FieldRequirement = Readonly<{
  pointer: string;
  detail: string;
  holds: (candidate: Record<string, unknown>) => boolean;
}>;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** The declared request requirements, evaluated in order. */
const REQUIREMENTS: readonly FieldRequirement[] = Object.freeze([
  {
    pointer: "/correlationId",
    detail: "A non-empty correlationId is required.",
    holds: (candidate) =>
      typeof candidate.correlationId === "string" && candidate.correlationId !== "",
  },
  {
    pointer: "/providerAuthority",
    detail: "A providerAuthority is required.",
    holds: (candidate) => readsObject(candidate.providerAuthority) !== null,
  },
  {
    pointer: "/providerAuthority/providerId",
    detail: "A non-empty providerAuthority.providerId is required.",
    holds: (candidate) => {
      const authority = readsObject(candidate.providerAuthority) ?? {};

      return typeof authority.providerId === "string" && authority.providerId !== "";
    },
  },
  {
    pointer: "/rawResponse",
    detail: "A rawResponse is required, even when the provider returned nothing.",
    holds: (candidate) => Object.hasOwn(candidate, "rawResponse"),
  },
  {
    pointer: "/rawResponseHash",
    detail:
      "A rawResponseHash of the form 'sha256:<64 hex characters>' is required.",
    holds: (candidate) =>
      typeof candidate.rawResponseHash === "string" &&
      HASH_PATTERN.test(candidate.rawResponseHash),
  },
]);

export function validatesNormalizationRequest(
  context: unknown
): RequestValidation {
  const candidate = readsObject(context);

  const structuralFailure = whenAbsent(candidate, () =>
    rejects(
      "NORMALIZATION_REQUEST_INVALID",
      "The normalization context must be an object.",
      "/"
    )
  );

  const unmet = REQUIREMENTS.find(
    (requirement) => candidate !== null && !requirement.holds(candidate)
  );

  const requirementFailure = whenPresent(unmet, (requirement) =>
    rejects("NORMALIZATION_REQUEST_INVALID", requirement.detail, requirement.pointer)
  );

  const policyViolations = validatesAgainstSchema(
    candidate?.normalizationPolicy,
    readsNormalizationPolicySchema()
  );

  const policyFailure = whenPresent(policyViolations[0], (violation) =>
    rejects(
      "NORMALIZATION_POLICY_UNSUPPORTED",
      `The normalization policy does not satisfy its declared contract: ${violation.path} ${violation.message}`,
      "/normalizationPolicy"
    )
  );

  return (
    structuralFailure ??
    requirementFailure ??
    policyFailure ??
    Object.freeze({ accepted: true as const })
  );
}

/** Narrows a validated context. Only call after validation accepted it. */
export function asValidatedContext(
  context: unknown
): NormalizeProviderResponseContext {
  return context as NormalizeProviderResponseContext;
}

function rejects(
  code: NormalizationFailure["code"],
  detail: string,
  pointer: string
): RequestValidation {
  return Object.freeze({
    accepted: false as const,
    failure: Object.freeze({ code, detail, pointer }),
  });
}

function whenAbsent<T, R>(value: T | null, produces: () => R): R | undefined {
  return value === null ? produces() : undefined;
}

function whenPresent<T, R>(
  value: T | undefined,
  produces: (present: T) => R
): R | undefined {
  return value === undefined ? undefined : produces(value);
}
