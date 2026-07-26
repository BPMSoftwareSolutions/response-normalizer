/**
 * Canonical vocabulary for the response normalizer.
 *
 * Nothing in this file may reference a provider SDK, a transport, or a runtime
 * environment. Provider dialect lives behind an adapter.
 *
 * The governing rule of this capability:
 *
 *     Normalize shape  ≠  Repair meaning
 *
 * Every type below exists to carry provider testimony forward without
 * inventing, repairing, or discarding a material fact.
 */

export type ProviderKind =
  | "openai"
  | "gemini"
  | "anthropic"
  | "litellm"
  | "llamacpp";

// ---------------------------------------------------------------------------
// Dispositions
// ---------------------------------------------------------------------------

/** The controlled outcome vocabulary. Provider strings never leak downstream. */
export const RESPONSE_DISPOSITIONS = [
  "completed",
  "length-limited",
  "tool-calls-requested",
  "refused",
  "safety-blocked",
  "content-filtered",
  "cancelled",
  "provider-failed",
  "malformed-provider-response",
  "unsupported-provider-response",
  "unknown",
] as const;

export type ResponseDisposition = (typeof RESPONSE_DISPOSITIONS)[number];

/**
 * Retryability is deliberately not decided here. The Retry Policy Executor
 * owns that judgement; the normalizer only states that it did not make it.
 */
export type RetryabilityDisposition = "not-classified";

export const USAGE_DISPOSITIONS = [
  "observed",
  "partially-observed",
  "unavailable",
  "not-applicable",
] as const;

export type UsageDisposition = (typeof USAGE_DISPOSITIONS)[number];

export const STRUCTURED_OUTPUT_DISPOSITIONS = [
  "not-requested",
  "not-present",
  "parsed",
  "invalid-json",
  "provider-native",
] as const;

export type StructuredOutputDisposition =
  (typeof STRUCTURED_OUTPUT_DISPOSITIONS)[number];

export const ARGUMENTS_DISPOSITIONS = [
  "parsed",
  "invalid-json",
  "absent",
] as const;

export type ArgumentsDisposition = (typeof ARGUMENTS_DISPOSITIONS)[number];

export const SEGMENT_KINDS = [
  "text",
  "tool-call",
  "refusal",
  "reasoning-summary",
  "image",
  "audio",
  "unsupported",
] as const;

export type SegmentKind = (typeof SEGMENT_KINDS)[number];

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = "info" | "warning" | "error";

export type NormalizationDiagnostic = Readonly<{
  code: string;
  severity: DiagnosticSeverity;
  path: string;
  message: string;
}>;

// ---------------------------------------------------------------------------
// Canonical content
// ---------------------------------------------------------------------------

export type CanonicalToolCall = Readonly<{
  callId: string;
  toolName: string;
  /** The provider's original argument text, always retained verbatim. */
  argumentsText: string | null;
  /** Present only when parsing actually succeeded. Never manufactured. */
  arguments: unknown;
  argumentsDisposition: ArgumentsDisposition;
}>;

export type CanonicalContentSegment = Readonly<{
  index: number;
  kind: SegmentKind;
  text?: string;
  toolCall?: CanonicalToolCall;
  /** Retained verbatim for segment kinds this version does not model. */
  raw?: unknown;
}>;

export type CanonicalStructuredOutput = Readonly<{
  disposition: StructuredOutputDisposition;
  value: unknown;
  source: "provider-structured-output" | "text-content" | null;
}>;

export type CanonicalContent = Readonly<{
  segments: readonly CanonicalContentSegment[];
  combinedText: string;
  structuredOutput: CanonicalStructuredOutput | null;
  toolCalls: readonly CanonicalToolCall[];
}>;

// ---------------------------------------------------------------------------
// Canonical observations
// ---------------------------------------------------------------------------

export type CanonicalRefusal = Readonly<{
  present: boolean;
  reason: string | null;
  providerCategory: string | null;
}>;

export type CanonicalSafetySignal = Readonly<{
  category: string;
  severity: string | null;
  blocked: boolean;
}>;

export type CanonicalSafety = Readonly<{
  signalsPresent: boolean;
  signals: readonly CanonicalSafetySignal[];
}>;

/**
 * Token counts are nullable on purpose. A null is testimony that the provider
 * did not say, which is materially different from a zero.
 */
export type CanonicalUsage = Readonly<{
  disposition: UsageDisposition;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  providerUsage: Readonly<Record<string, unknown>>;
}>;

// ---------------------------------------------------------------------------
// Canonical response
// ---------------------------------------------------------------------------

export type CanonicalProvider = Readonly<{
  providerId: string;
  adapterId: string;
  providerResponseId: string | null;
  providerRequestId: string | null;
}>;

export type CanonicalModel = Readonly<{
  requestedModel: string | null;
  resolvedModel: string | null;
  providerReportedModel: string | null;
}>;

export type CanonicalOutcome = Readonly<{
  disposition: ResponseDisposition;
  providerFinishReason: string | null;
  retryability: RetryabilityDisposition;
}>;

export type CanonicalProvenance = Readonly<{
  normalizedAt: string;
  normalizerVersion: string;
  adapterVersion: string;
  rawResponseHash: string;
  rawResponseReference: string | null;
}>;

export type CanonicalModelResponse = Readonly<{
  $schema?: string;
  contractVersion: string;

  responseId: string;
  correlationId: string;

  provider: CanonicalProvider;
  model: CanonicalModel;
  outcome: CanonicalOutcome;
  content: CanonicalContent;
  refusal: CanonicalRefusal;
  safety: CanonicalSafety;
  usage: CanonicalUsage;

  diagnostics: readonly NormalizationDiagnostic[];
  provenance: CanonicalProvenance;
}>;

export const CANONICAL_CONTRACT_VERSION = "1.0.0";
export const NORMALIZER_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Normalization policy
// ---------------------------------------------------------------------------

/**
 * Cross-provider behaviour is declared, not hard-coded. The policy may never
 * authorize semantic rewriting: there is deliberately no `repairMalformedJson`.
 */
export type NormalizationPolicy = Readonly<{
  policyVersion: string;

  content: Readonly<{
    preserveSegmentOrder: boolean;
    combineTextSegments: boolean;
    includeReasoningSummary: boolean;
    /** How many provider candidates may be projected. */
    maximumCandidates: number;
  }>;

  structuredOutput: Readonly<{
    parseTextAsJson: "never" | "only-when-declared" | "always";
    preserveOriginalText: boolean;
  }>;

  toolCalls: Readonly<{
    parseArguments: boolean;
    retainArgumentsText: boolean;
  }>;

  usage: Readonly<{
    allowDerivedTotal: boolean;
    allowEstimatedUsage: boolean;
  }>;

  rawResponse: Readonly<{
    retention: "none" | "hash-only" | "hash-and-reference";
  }>;

  unsupportedContent: Readonly<{
    disposition: "preserve-with-diagnostic" | "reject";
  }>;
}>;

// ---------------------------------------------------------------------------
// Immutable input context
// ---------------------------------------------------------------------------

export type NormalizeProviderResponseContext = Readonly<{
  correlationId: string;

  providerAuthority: Readonly<{
    providerId: string;
    adapterId: string;
  }>;

  requestedModel: string | null;
  resolvedModel: string | null;

  rawResponse: unknown;
  rawResponseHash: string;
  rawResponseReference?: string | null;

  /**
   * Whether the caller asked the provider for structured output. The
   * normalizer parses text as JSON only when this is declared and policy
   * permits it.
   */
  structuredOutputRequested?: boolean;

  normalizationPolicy: NormalizationPolicy;
}>;

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

export type ProviderResponseRecognition =
  | Readonly<{ recognized: true; confidence: "exact" | "probable" }>
  | Readonly<{ recognized: false; detail: string }>;

/**
 * What an adapter is permitted to return. It projects dialect into canonical
 * regions; it never builds provenance, identity, or the envelope itself.
 */
export type CanonicalModelResponseProjection = Readonly<{
  provider: Readonly<{
    providerResponseId: string | null;
    providerRequestId: string | null;
  }>;
  model: Readonly<{ providerReportedModel: string | null }>;
  outcome: Readonly<{
    disposition: ResponseDisposition;
    providerFinishReason: string | null;
  }>;
  content: CanonicalContent;
  refusal: CanonicalRefusal;
  safety: CanonicalSafety;
  usage: CanonicalUsage;
  diagnostics: readonly NormalizationDiagnostic[];
}>;

export interface ProviderResponseAdapter {
  readonly providerId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;

  recognizes(response: unknown): ProviderResponseRecognition;

  projectsCanonicalResponse(
    context: NormalizeProviderResponseContext
  ): CanonicalModelResponseProjection;
}

// ---------------------------------------------------------------------------
// Result contract
// ---------------------------------------------------------------------------

export const NORMALIZATION_FAILURE_CODES = [
  "NORMALIZATION_REQUEST_INVALID",
  "PROVIDER_ADAPTER_NOT_FOUND",
  "PROVIDER_ADAPTER_AMBIGUOUS",
  "PROVIDER_RESPONSE_NOT_RECOGNIZED",
  "PROVIDER_RESPONSE_MALFORMED",
  "CANONICAL_PROJECTION_INVALID",
  "RAW_RESPONSE_HASH_MISMATCH",
  "NORMALIZATION_POLICY_UNSUPPORTED",
  "NORMALIZATION_FAILED",
] as const;

export type NormalizationFailureCode =
  (typeof NORMALIZATION_FAILURE_CODES)[number];

/** Exit codes are part of the contract, not a CLI implementation detail. */
export const FAILURE_EXIT_CODES: Readonly<
  Record<NormalizationFailureCode | "NORMALIZED", number>
> = Object.freeze({
  NORMALIZED: 0,
  NORMALIZATION_REQUEST_INVALID: 10,
  PROVIDER_ADAPTER_NOT_FOUND: 11,
  PROVIDER_ADAPTER_AMBIGUOUS: 12,
  PROVIDER_RESPONSE_NOT_RECOGNIZED: 13,
  PROVIDER_RESPONSE_MALFORMED: 20,
  CANONICAL_PROJECTION_INVALID: 21,
  RAW_RESPONSE_HASH_MISMATCH: 22,
  NORMALIZATION_POLICY_UNSUPPORTED: 30,
  NORMALIZATION_FAILED: 50,
});

export type NormalizationFailure = Readonly<{
  code: NormalizationFailureCode;
  detail: string;
  pointer?: string;
}>;

export type NormalizeProviderResponseResult =
  | Readonly<{
      disposition: "normalized";
      response: CanonicalModelResponse;
      diagnostics: readonly NormalizationDiagnostic[];
    }>
  | Readonly<{
      disposition: "rejected";
      failure: NormalizationFailure;
      diagnostics: readonly NormalizationDiagnostic[];
    }>;

// ---------------------------------------------------------------------------
// Runtime ports
// ---------------------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export interface HashPort {
  hashes(value: unknown): string;
}

export interface IdentityPort {
  newResponseId(): string;
}

export type NormalizerDependencies = Readonly<{
  adapters: readonly ProviderResponseAdapter[];
  clock: Clock;
  hashes: HashPort;
  identity: IdentityPort;
}>;
