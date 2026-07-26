import {
  CANONICAL_CONTRACT_VERSION,
  NORMALIZER_VERSION,
  type CanonicalModelResponse,
  type NormalizationDiagnostic,
  type NormalizationFailure,
  type NormalizeProviderResponseResult,
  type NormalizerDependencies,
  type ProviderResponseAdapter,
} from "../shared/response-normalizer-contract.js";
import { readsObject } from "../shared/reads-provider-values.js";
import { resolvesProviderResponseAdapter } from "./resolves-provider-response-adapter.js";
import { validatesCanonicalResponseProjection } from "./validates-canonical-response-projection.js";
import {
  asValidatedContext,
  validatesNormalizationRequest,
} from "./validates-normalization-request.js";

/**
 * Accept raw provider testimony and project it into one canonical response
 * without inventing, repairing, or discarding material facts.
 *
 * The execution slice is fixed:
 *
 *   validate request
 *        ▼
 *   resolve adapter
 *        ▼
 *   confirm recognition
 *        ▼
 *   project provider testimony
 *        ▼
 *   enforce canonical contract
 *        ▼
 *   attach provenance
 *
 * No step is skipped, and no failure is converted into a partial success.
 */
export function normalizesProviderResponse(
  context: unknown,
  dependencies: NormalizerDependencies
): NormalizeProviderResponseResult {
  const validation = validatesNormalizationRequest(context);

  if (!validation.accepted) {
    return rejects(validation.failure);
  }

  const validContext = asValidatedContext(context);

  const resolution = resolvesProviderResponseAdapter(
    validContext,
    dependencies.adapters
  );

  if (!resolution.resolved) {
    return rejects(resolution.failure);
  }

  const { adapter } = resolution;

  // Verifying the supplied hash proves the testimony being projected is the
  // testimony that was witnessed. A mismatch means the evidence chain is broken.
  const observedHash = dependencies.hashes.hashes(validContext.rawResponse);

  if (observedHash !== validContext.rawResponseHash) {
    return rejects({
      code: "RAW_RESPONSE_HASH_MISMATCH",
      detail: `The supplied rawResponseHash does not match the raw response. Expected ${validContext.rawResponseHash} but observed ${observedHash}.`,
      pointer: "/rawResponseHash",
    });
  }

  const projection = projectsUnderAdapter(adapter, validContext);

  if (!projection.projected) {
    return rejects(projection.failure);
  }

  // An adapter that omitted a whole canonical region cannot be read safely, so
  // its shape is checked before the envelope is built rather than after.
  const shapeCheck = validatesProjectionShape(projection.projection);

  if (!shapeCheck.valid) {
    return rejects(shapeCheck.failure);
  }

  const response = buildsCanonicalResponse(
    validContext,
    adapter,
    projection.projection,
    dependencies
  );

  const contractCheck = validatesCanonicalResponseProjection(
    response,
    validContext.normalizationPolicy
  );

  if (!contractCheck.valid) {
    return rejects(contractCheck.failure, response.diagnostics);
  }

  return Object.freeze({
    disposition: "normalized" as const,
    response,
    diagnostics: response.diagnostics,
  });
}

type AdapterProjection =
  | Readonly<{
      projected: true;
      projection: ReturnType<ProviderResponseAdapter["projectsCanonicalResponse"]>;
    }>
  | Readonly<{ projected: false; failure: NormalizationFailure }>;

/**
 * Runs the adapter. A throwing adapter is observed and classified here; it does
 * not become an unhandled failure or a fabricated success.
 */
function projectsUnderAdapter(
  adapter: ProviderResponseAdapter,
  context: ReturnType<typeof asValidatedContext>
): AdapterProjection {
  try {
    return Object.freeze({
      projected: true as const,
      projection: adapter.projectsCanonicalResponse(context),
    });
  } catch (error) {
    return Object.freeze({
      projected: false as const,
      failure: Object.freeze({
        code: "PROVIDER_RESPONSE_MALFORMED" as const,
        detail:
          error instanceof Error
            ? `The adapter "${adapter.adapterId}" could not project the provider response: ${error.message}`
            : `The adapter "${adapter.adapterId}" could not project the provider response.`,
        pointer: "/rawResponse",
      }),
    });
  }
}

type ShapeCheck =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; failure: NormalizationFailure }>;

/**
 * Confirms every canonical region the envelope builder must read is present.
 *
 * This is deliberately narrow: it proves the projection can be read, and the
 * full contract validator then proves it is correct.
 */
function validatesProjectionShape(projection: unknown): ShapeCheck {
  const regions = [
    "provider",
    "model",
    "outcome",
    "content",
    "refusal",
    "safety",
    "usage",
    "diagnostics",
  ] as const;

  const candidate = readsObject(projection);

  if (!candidate) {
    return Object.freeze({
      valid: false as const,
      failure: Object.freeze({
        code: "CANONICAL_PROJECTION_INVALID" as const,
        detail: "The adapter did not return a projection object.",
        pointer: "$",
      }),
    });
  }

  for (const region of regions) {
    if (candidate[region] === undefined || candidate[region] === null) {
      return Object.freeze({
        valid: false as const,
        failure: Object.freeze({
          code: "CANONICAL_PROJECTION_INVALID" as const,
          detail: `The adapter projection is missing the required "${region}" region.`,
          pointer: `$.${region}`,
        }),
      });
    }
  }

  return Object.freeze({ valid: true as const });
}

/**
 * Seals the adapter's projection into the canonical envelope.
 *
 * Identity and provenance are added here, never by an adapter, so every
 * canonical response carries the same evidence regardless of provider.
 */
function buildsCanonicalResponse(
  context: ReturnType<typeof asValidatedContext>,
  adapter: ProviderResponseAdapter,
  projection: ReturnType<ProviderResponseAdapter["projectsCanonicalResponse"]>,
  dependencies: NormalizerDependencies
): CanonicalModelResponse {
  const retention = context.normalizationPolicy.rawResponse.retention;

  const rawResponseReference =
    retention === "hash-and-reference" ? (context.rawResponseReference ?? null) : null;

  return Object.freeze({
    contractVersion: CANONICAL_CONTRACT_VERSION,

    responseId: dependencies.identity.newResponseId(),
    correlationId: context.correlationId,

    provider: Object.freeze({
      providerId: adapter.providerId,
      adapterId: adapter.adapterId,
      providerResponseId: projection.provider.providerResponseId,
      providerRequestId: projection.provider.providerRequestId,
    }),

    model: Object.freeze({
      requestedModel: context.requestedModel,
      resolvedModel: context.resolvedModel,
      providerReportedModel: projection.model.providerReportedModel,
    }),

    outcome: Object.freeze({
      disposition: projection.outcome.disposition,
      providerFinishReason: projection.outcome.providerFinishReason,
      retryability: "not-classified" as const,
    }),

    content: projection.content,
    refusal: projection.refusal,
    safety: projection.safety,
    usage: projection.usage,

    diagnostics: projection.diagnostics,

    provenance: Object.freeze({
      normalizedAt: dependencies.clock.now().toISOString(),
      normalizerVersion: NORMALIZER_VERSION,
      adapterVersion: adapter.adapterVersion,
      rawResponseHash: context.rawResponseHash,
      rawResponseReference,
    }),
  });
}

function rejects(
  failure: NormalizationFailure,
  diagnostics: readonly NormalizationDiagnostic[] = []
): NormalizeProviderResponseResult {
  return Object.freeze({
    disposition: "rejected" as const,
    failure,
    diagnostics,
  });
}
