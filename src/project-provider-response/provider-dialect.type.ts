import type {
  NormalizationDiagnostic,
  SegmentKind,
} from "../shared/response-normalizer-contract.js";
import type { DeclaredPredicate } from "../kernel/reads-declared-path.js";

/**
 * The TypeScript view of a provider dialect document.
 *
 * The authoritative shape is authority/provider-dialect.schema.v1.json. These
 * types are a projection of that schema for the TypeScript runtime, not a
 * second source of truth.
 */

export type ToolCallBinding = Readonly<{
  callIdPath?: string;
  toolNamePath: string;
  argumentsTextPath?: string;
  parsedArgumentsPath?: string;
}>;

export type SegmentRule = Readonly<{
  ruleId: string;
  when: readonly DeclaredPredicate[];
  kind: SegmentKind;
  textPath?: string;
  contributesToText?: boolean;
  includeWhenPolicy?: "content.includeReasoningSummary";
  toolCall?: ToolCallBinding;
}>;

export type ToolCallSource = Readonly<{
  path: string;
  diagnosticPath?: string;
  toolCall: ToolCallBinding;
}>;

export type SafetyRatingSource = Readonly<{
  path: string;
  categoryPath: string;
  severityPaths?: readonly string[];
  blockedWhen?: DeclaredPredicate;
}>;

export type SafetyFilterMapSource = Readonly<{
  path: string;
  severityKey?: string;
  blockedKey?: string;
}>;

export type ProviderDialect = Readonly<{
  dialectId: string;
  providerId: string;
  adapterId: string;
  adapterVersion: string;
  description?: string;

  recognition: Readonly<{
    detail: string;
    requires?: readonly DeclaredPredicate[];
    anyOf?: readonly DeclaredPredicate[];
  }>;

  identity: Readonly<{
    providerResponseId: string | null;
    providerRequestId: string | null;
    providerReportedModel: string | null;
  }>;

  candidates: Readonly<{
    path: string;
    overflowDiagnostic?: NormalizationDiagnostic;
  }>;

  content: Readonly<{
    partsPath?: string;
    singlePartPath?: string;
    segmentRules: readonly SegmentRule[];
    candidateRules?: readonly SegmentRule[];
    toolCallSources?: readonly ToolCallSource[];
    unmatchedPart?: "preserve-as-unsupported" | "ignore";
  }>;

  outcome: Readonly<{
    finishReasonSources: readonly string[];
    absentDiagnostic?: NormalizationDiagnostic;
    emptyCandidateDiagnostic?: NormalizationDiagnostic;
  }>;

  refusal: Readonly<{
    supported: boolean;
    reasonPath?: string;
    providerCategory?: string | null;
  }>;

  safety: Readonly<{
    supported: boolean;
    ratingSources?: readonly SafetyRatingSource[];
    filterMapSources?: readonly SafetyFilterMapSource[];
    blockSignal?: Readonly<{ categoryPath: string }>;
  }>;

  usage: Readonly<{
    path: string;
    inputTokens?: string;
    outputTokens?: string;
    totalTokens?: string;
    cachedInputTokens?: string;
    reasoningTokens?: string;
  }>;
}>;
