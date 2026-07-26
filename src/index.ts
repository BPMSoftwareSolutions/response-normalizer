/**
 * Response Normalizer.
 *
 * The semantic anti-corruption layer between nondeterministic provider
 * testimony and the deterministic capability ecosystem.
 */

export { normalizesProviderResponse } from "./normalize-provider-response/normalizes-provider-response.js";

export {
  createsDeclaredAdapter,
  readsDeclaredAdapters,
  readsDeclaredDialects,
} from "./project-provider-response/creates-declared-adapter.js";

export {
  readsDefaultNormalizationPolicy,
  readsCanonicalResponseSchema,
  readsNormalizationPolicySchema,
  readsFinishDispositionDecision,
} from "./canonical-model-response/reads-authority-documents.js";

export {
  canonicalJson,
  createsFixedClock,
  createsSequentialIdentity,
  randomIdentity,
  sha256Hashes,
  systemClock,
} from "./shared/runtime-ports.js";

export { validatesAgainstSchema } from "./canonical-model-response/validates-against-schema.js";

export type {
  CanonicalContent,
  CanonicalContentSegment,
  CanonicalModelResponse,
  CanonicalModelResponseProjection,
  CanonicalToolCall,
  CanonicalUsage,
  NormalizationDiagnostic,
  NormalizationFailure,
  NormalizationFailureCode,
  NormalizationPolicy,
  NormalizeProviderResponseContext,
  NormalizeProviderResponseResult,
  NormalizerDependencies,
  ProviderResponseAdapter,
  ResponseDisposition,
  UsageDisposition,
} from "./shared/response-normalizer-contract.js";

export {
  FAILURE_EXIT_CODES,
  NORMALIZATION_FAILURE_CODES,
  RESPONSE_DISPOSITIONS,
  USAGE_DISPOSITIONS,
} from "./shared/response-normalizer-contract.js";

export type { ProviderDialect } from "./project-provider-response/provider-dialect.type.js";
