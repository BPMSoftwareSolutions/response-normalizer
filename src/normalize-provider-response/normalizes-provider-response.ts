import { readsObject } from "../kernel/reads-provider-values.js";
import {
  CANONICAL_CONTRACT_VERSION,
  NORMALIZER_VERSION,
  type CanonicalModelResponse,
  type NormalizationDiagnostic,
  type NormalizationFailure,
  type NormalizeProviderResponseContext,
  type NormalizeProviderResponseResult,
  type NormalizerDependencies,
  type ProviderResponseAdapter,
} from "../shared/response-normalizer-contract.js";
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
 * The body is a linear execution witness. Each stage below either yields a
 * failure or passes its work forward; the first failure is the result. Nothing
 * here interprets a provider, a finish reason, or a usage value — those answers
 * arrive already resolved from the authority documents.
 */
export function normalizesProviderResponse(
  context: unknown,
  dependencies: NormalizerDependencies
): NormalizeProviderResponseResult {
  const stages: readonly NormalizationStage[] = [
    validatesRequest,
    resolvesAdapter,
    verifiesRawResponseHash,
    projectsTestimony,
    buildsAndValidatesResponse,
  ];

  const execution = stages.reduce<StageOutcome>(
    (carried, stage) => (carried.failure ? carried : stage(carried, dependencies)),
    Object.freeze({ context })
  );

  return execution.failure
    ? rejects(execution.failure, execution.response?.diagnostics)
    : Object.freeze({
        disposition: "normalized" as const,
        response: execution.response as CanonicalModelResponse,
        diagnostics: (execution.response as CanonicalModelResponse).diagnostics,
      });
}

type StageOutcome = Readonly<{
  context: unknown;
  adapter?: ProviderResponseAdapter;
  projection?: ReturnType<ProviderResponseAdapter["projectsCanonicalResponse"]>;
  response?: CanonicalModelResponse;
  failure?: NormalizationFailure;
}>;

type NormalizationStage = (
  carried: StageOutcome,
  dependencies: NormalizerDependencies
) => StageOutcome;

const validatesRequest: NormalizationStage = (carried) => {
  const validation = validatesNormalizationRequest(carried.context);

  return validation.accepted
    ? carried
    : Object.freeze({ ...carried, failure: validation.failure });
};

const resolvesAdapter: NormalizationStage = (carried, dependencies) => {
  const resolution = resolvesProviderResponseAdapter(
    asValidatedContext(carried.context),
    dependencies.adapters
  );

  return resolution.resolved
    ? Object.freeze({ ...carried, adapter: resolution.adapter })
    : Object.freeze({ ...carried, failure: resolution.failure });
};

/**
 * Verifying the supplied hash proves the testimony being projected is the
 * testimony that was witnessed. A mismatch means the evidence chain is broken.
 */
const verifiesRawResponseHash: NormalizationStage = (carried, dependencies) => {
  const context = asValidatedContext(carried.context);
  const observed = dependencies.hashes.hashes(context.rawResponse);

  return observed === context.rawResponseHash
    ? carried
    : Object.freeze({
        ...carried,
        failure: Object.freeze({
          code: "RAW_RESPONSE_HASH_MISMATCH" as const,
          detail: `The supplied rawResponseHash does not match the raw response. Expected ${context.rawResponseHash} but observed ${observed}.`,
          pointer: "/rawResponseHash",
        }),
      });
};

/**
 * Runs the adapter behind a mechanical boundary. The catch observes; it does
 * not classify. An adapter that omitted a canonical region is caught here too,
 * because the envelope cannot be built from a projection it cannot read.
 */
const projectsTestimony: NormalizationStage = (carried) => {
  const adapter = carried.adapter as ProviderResponseAdapter;
  const observed = observesProjection(adapter, asValidatedContext(carried.context));

  const missingRegion = CANONICAL_REGIONS.find(
    (region) =>
      observed.projected &&
      (readsObject(observed.projection)?.[region] ?? null) === null
  );

  const failure =
    observed.projected === false
      ? observed.failure
      : missingRegion !== undefined
        ? Object.freeze({
            code: "CANONICAL_PROJECTION_INVALID" as const,
            detail: `The adapter projection is missing the required "${missingRegion}" region.`,
            pointer: `$.${missingRegion}`,
          })
        : undefined;

  return failure
    ? Object.freeze({ ...carried, failure })
    : Object.freeze({
        ...carried,
        projection: (observed as { projection: StageOutcome["projection"] }).projection,
      });
};

const buildsAndValidatesResponse: NormalizationStage = (carried, dependencies) => {
  const context = asValidatedContext(carried.context);

  const response = buildsCanonicalResponse(
    context,
    carried.adapter as ProviderResponseAdapter,
    carried.projection as NonNullable<StageOutcome["projection"]>,
    dependencies
  );

  const contractCheck = validatesCanonicalResponseProjection(
    response,
    context.normalizationPolicy
  );

  return contractCheck.valid
    ? Object.freeze({ ...carried, response })
    : Object.freeze({ ...carried, response, failure: contractCheck.failure });
};

/** The canonical regions an adapter must supply for the envelope to be built. */
const CANONICAL_REGIONS = Object.freeze([
  "provider",
  "model",
  "outcome",
  "content",
  "refusal",
  "safety",
  "usage",
  "diagnostics",
] as const);

type ObservedProjection =
  | Readonly<{
      projected: true;
      projection: ReturnType<ProviderResponseAdapter["projectsCanonicalResponse"]>;
    }>
  | Readonly<{ projected: false; failure: NormalizationFailure }>;

function observesProjection(
  adapter: ProviderResponseAdapter,
  context: NormalizeProviderResponseContext
): ObservedProjection {
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
        detail: `The adapter "${adapter.adapterId}" could not project the provider response: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        pointer: "/rawResponse",
      }),
    });
  }
}

/**
 * Seals the adapter's projection into the canonical envelope.
 *
 * Identity and provenance are added here, never by an adapter, so every
 * canonical response carries the same evidence regardless of provider.
 */
function buildsCanonicalResponse(
  context: NormalizeProviderResponseContext,
  adapter: ProviderResponseAdapter,
  projection: NonNullable<StageOutcome["projection"]>,
  dependencies: NormalizerDependencies
): CanonicalModelResponse {
  const retainsReference =
    context.normalizationPolicy.rawResponse.retention === "hash-and-reference";

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
      rawResponseReference: retainsReference
        ? (context.rawResponseReference ?? null)
        : null,
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
