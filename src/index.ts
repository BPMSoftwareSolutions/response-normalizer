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
  readsAllDeclaredDecisions,
  readsCanonicalResponseSchema,
  readsDeclaredDecision,
  readsDecisionSchema,
  readsDefaultNormalizationPolicy,
  readsExecutionPlan,
  readsNormalizationPolicySchema,
  readsProviderDialectSchema,
} from "./adapters/reads-authority-documents.js";

export { resolvesDeclaredDecision } from "./kernel/resolves-declared-decision.js";
export { executesDeclaredProjection } from "./kernel/executes-declared-projection.js";
export { executesDeclaredIteration } from "./kernel/executes-declared-iteration.js";
export { selectsFirstMatchingRule } from "./kernel/selects-matching-rule.js";

export {
  canonicalJson,
  createsFixedClock,
  createsSequentialIdentity,
  randomIdentity,
  sha256Hashes,
  systemClock,
} from "./adapters/runtime-ports.js";

export { validatesAgainstSchema } from "./kernel/validates-against-schema.js";

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
