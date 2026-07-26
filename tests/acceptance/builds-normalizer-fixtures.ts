import { readsDefaultNormalizationPolicy } from "../../src/canonical-model-response/reads-authority-documents.js";
import { readsDeclaredAdapters } from "../../src/project-provider-response/creates-declared-adapter.js";
import type {
  NormalizationPolicy,
  NormalizeProviderResponseContext,
  NormalizerDependencies,
  ProviderResponseAdapter,
} from "../../src/shared/response-normalizer-contract.js";
import {
  createsFixedClock,
  createsSequentialIdentity,
  sha256Hashes,
} from "../../src/shared/runtime-ports.js";

/**
 * Shared fixtures for the acceptance, conformance, and mutation suites.
 *
 * The clock and identity source are fixed so byte-stability is a provable
 * claim rather than a weakened one.
 */

export const FIXED_INSTANT = "2026-07-26T09:45:00.000Z";

export function buildsDependencies(
  adapters: readonly ProviderResponseAdapter[] = readsDeclaredAdapters()
): NormalizerDependencies {
  return Object.freeze({
    adapters,
    clock: createsFixedClock(FIXED_INSTANT),
    hashes: sha256Hashes,
    identity: createsSequentialIdentity(),
  });
}

export function buildsPolicy(
  overrides: Partial<NormalizationPolicy> = {}
): NormalizationPolicy {
  return Object.freeze({
    ...readsDefaultNormalizationPolicy(),
    ...overrides,
  }) as NormalizationPolicy;
}

/**
 * Builds a normalization context, computing the raw response hash so the
 * evidence chain is intact unless a test deliberately breaks it.
 */
export function buildsContext(
  providerId: string,
  rawResponse: unknown,
  overrides: Partial<NormalizeProviderResponseContext> = {}
): NormalizeProviderResponseContext {
  return Object.freeze({
    correlationId: "request-01JQTESTCORRELATION",
    providerAuthority: Object.freeze({
      providerId,
      adapterId: "",
    }),
    requestedModel: "instruction-capable-model",
    resolvedModel: "resolved-provider-model",
    rawResponse,
    rawResponseHash: sha256Hashes.hashes(rawResponse),
    normalizationPolicy: buildsPolicy(),
    ...overrides,
  }) as NormalizeProviderResponseContext;
}

// ---------------------------------------------------------------------------
// Provider testimony fixtures
// ---------------------------------------------------------------------------

export function buildsOpenaiResponse(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "response-123",
    model: "model-x",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "The capability is ready." },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 75,
      completion_tokens: 12,
      total_tokens: 87,
    },
    ...overrides,
  };
}

export function buildsGeminiResponse(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    responseId: "gemini-response-123",
    modelVersion: "model-x",
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text: "The capability is ready." }],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 75,
      candidatesTokenCount: 12,
      totalTokenCount: 87,
    },
    ...overrides,
  };
}

export function buildsAnthropicResponse(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "msg-123",
    type: "message",
    role: "assistant",
    model: "model-x",
    content: [{ type: "text", text: "The capability is ready." }],
    stop_reason: "end_turn",
    usage: { input_tokens: 75, output_tokens: 12 },
    ...overrides,
  };
}

/**
 * An adapter that returns whatever projection a test hands it, used to prove
 * the normalizer polices adapter output rather than trusting it.
 */
export function createsFabricatingAdapter(
  providerId: string,
  projection: unknown,
  adapterId = `${providerId}-fabricating-adapter`
): ProviderResponseAdapter {
  return Object.freeze({
    providerId,
    adapterId,
    adapterVersion: "0.1.0",
    recognizes: () => ({ recognized: true as const, confidence: "exact" as const }),
    projectsCanonicalResponse: () =>
      projection as ReturnType<
        ProviderResponseAdapter["projectsCanonicalResponse"]
      >,
  });
}

/** A well-formed projection a test can selectively corrupt. */
export function buildsValidProjection(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    provider: { providerResponseId: "response-123", providerRequestId: null },
    model: { providerReportedModel: "model-x" },
    outcome: { disposition: "completed", providerFinishReason: "stop" },
    content: {
      segments: [{ index: 0, kind: "text", text: "ok" }],
      combinedText: "ok",
      structuredOutput: null,
      toolCalls: [],
    },
    refusal: { present: false, reason: null, providerCategory: null },
    safety: { signalsPresent: false, signals: [] },
    usage: {
      disposition: "observed",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cachedInputTokens: null,
      reasoningTokens: null,
      providerUsage: {},
    },
    diagnostics: [],
    ...overrides,
  };
}
