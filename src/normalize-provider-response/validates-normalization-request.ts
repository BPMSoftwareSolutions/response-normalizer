import { validatesAgainstSchema } from "../canonical-model-response/validates-against-schema.js";
import { readsNormalizationPolicySchema } from "../canonical-model-response/reads-authority-documents.js";
import type {
  NormalizationFailure,
  NormalizeProviderResponseContext,
} from "../shared/response-normalizer-contract.js";
import { readsObject } from "../shared/reads-provider-values.js";

/**
 * Rejects a normalization request that cannot be honoured.
 *
 * The policy is checked against its declared JSON Schema, so an unsupported
 * policy — including any attempt to introduce a semantic-rewriting setting the
 * closed schema does not permit — is refused before any provider testimony is
 * read.
 */

export type RequestValidation =
  | Readonly<{ accepted: true }>
  | Readonly<{ accepted: false; failure: NormalizationFailure }>;

export function validatesNormalizationRequest(
  context: unknown
): RequestValidation {
  const candidate = readsObject(context);

  if (!candidate) {
    return rejects(
      "NORMALIZATION_REQUEST_INVALID",
      "The normalization context must be an object.",
      "/"
    );
  }

  if (typeof candidate.correlationId !== "string" || candidate.correlationId === "") {
    return rejects(
      "NORMALIZATION_REQUEST_INVALID",
      "A non-empty correlationId is required.",
      "/correlationId"
    );
  }

  const authority = readsObject(candidate.providerAuthority);

  if (!authority) {
    return rejects(
      "NORMALIZATION_REQUEST_INVALID",
      "A providerAuthority is required.",
      "/providerAuthority"
    );
  }

  if (typeof authority.providerId !== "string" || authority.providerId === "") {
    return rejects(
      "NORMALIZATION_REQUEST_INVALID",
      "A non-empty providerAuthority.providerId is required.",
      "/providerAuthority/providerId"
    );
  }

  if (!Object.hasOwn(candidate, "rawResponse")) {
    return rejects(
      "NORMALIZATION_REQUEST_INVALID",
      "A rawResponse is required, even when the provider returned nothing.",
      "/rawResponse"
    );
  }

  if (
    typeof candidate.rawResponseHash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(candidate.rawResponseHash)
  ) {
    return rejects(
      "NORMALIZATION_REQUEST_INVALID",
      "A rawResponseHash of the form 'sha256:<64 hex characters>' is required.",
      "/rawResponseHash"
    );
  }

  const policyViolations = validatesAgainstSchema(
    candidate.normalizationPolicy,
    readsNormalizationPolicySchema()
  );

  if (policyViolations.length > 0) {
    const first = policyViolations[0];

    return rejects(
      "NORMALIZATION_POLICY_UNSUPPORTED",
      `The normalization policy does not satisfy its declared contract: ${first?.path} ${first?.message}`,
      "/normalizationPolicy"
    );
  }

  return Object.freeze({ accepted: true as const });
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
