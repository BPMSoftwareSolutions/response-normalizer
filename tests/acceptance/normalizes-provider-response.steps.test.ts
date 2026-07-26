import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizesProviderResponse } from "../../src/normalize-provider-response/normalizes-provider-response.js";
import { canonicalJson } from "../../src/adapters/runtime-ports.js";
import {
  buildsAnthropicResponse,
  buildsContext,
  buildsDependencies,
  buildsGeminiResponse,
  buildsOpenaiResponse,
  buildsPolicy,
  buildsValidProjection,
  createsFabricatingAdapter,
} from "./builds-normalizer-fixtures.js";

/**
 * Acceptance is governed by acceptance/normalizes-provider-response.feature.
 * Each describe block below is one scenario from that file, in order.
 */

describe("Scenario: Normalize a completed text response", () => {
  it("projects provider text and preserves the original finish reason", () => {
    // Given an authorized provider response adapter
    // And a provider response containing completed text
    const raw = buildsOpenaiResponse();

    // When the provider response is normalized
    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    // Then the result disposition is "normalized"
    assert.equal(result.disposition, "normalized");
    assert.ok(result.disposition === "normalized");

    // And the canonical response contains the provider text
    assert.equal(result.response.content.combinedText, "The capability is ready.");

    // And the canonical finish disposition is "completed"
    assert.equal(result.response.outcome.disposition, "completed");

    // And the original provider finish reason is preserved
    assert.equal(result.response.outcome.providerFinishReason, "stop");

    // And the raw provider response hash is recorded
    assert.match(
      result.response.provenance.rawResponseHash,
      /^sha256:[0-9a-f]{64}$/
    );
  });
});

describe("Scenario: Preserve multiple content segments in provider order", () => {
  it("projects every supported segment in source order", () => {
    // Given a provider response containing multiple content segments
    const raw = buildsAnthropicResponse({
      content: [
        { type: "text", text: "First. " },
        {
          type: "tool_use",
          id: "call-123",
          name: "searchFiles",
          input: { query: "*.json" },
        },
        { type: "text", text: "Second." },
      ],
      stop_reason: "tool_use",
    });

    // When the provider response is normalized
    const result = normalizesProviderResponse(
      buildsContext("anthropic", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    const { segments, combinedText } = result.response.content;

    // Then every supported segment is projected
    assert.equal(segments.length, 3);

    // And the segment order matches the provider response
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ["text", "tool-call", "text"]
    );
    assert.deepEqual(
      segments.map((segment) => segment.index),
      [0, 1, 2]
    );

    // And the combined text contains only textual segments
    assert.equal(combinedText, "First. Second.");
    assert.ok(!combinedText.includes("searchFiles"));
  });
});

describe("Scenario: Normalize a provider tool call", () => {
  it("preserves the call identity, name, and original arguments text", () => {
    // Given a provider response containing a tool call
    const raw = buildsOpenaiResponse({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-123",
                type: "function",
                function: {
                  name: "searchFiles",
                  arguments: '{"query":"*.json"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    // When the provider response is normalized
    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    const [toolCall] = result.response.content.toolCalls;

    // Then the canonical response contains the tool-call identifier
    assert.equal(toolCall?.callId, "call-123");

    // And the canonical response contains the tool name
    assert.equal(toolCall?.toolName, "searchFiles");

    // And the original tool arguments text is preserved
    assert.equal(toolCall?.argumentsText, '{"query":"*.json"}');

    // And parsed arguments are included when parsing succeeds
    assert.deepEqual(toolCall?.arguments, { query: "*.json" });
    assert.equal(toolCall?.argumentsDisposition, "parsed");

    assert.equal(result.response.outcome.disposition, "tool-calls-requested");
  });
});

describe("Scenario: Preserve malformed tool arguments", () => {
  it("retains unparseable arguments text without repairing it", () => {
    // Given a provider response containing malformed tool arguments
    const malformed = '{"query": "*.json"';

    const raw = buildsOpenaiResponse({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-123",
                type: "function",
                function: { name: "searchFiles", arguments: malformed },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });

    // When the provider response is normalized
    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    const [toolCall] = result.response.content.toolCalls;

    // Then the tool arguments text is preserved
    assert.equal(toolCall?.argumentsText, malformed);

    // And the parsed arguments are absent
    assert.equal(toolCall?.arguments, null);

    // And the arguments disposition is "invalid-json"
    assert.equal(toolCall?.argumentsDisposition, "invalid-json");

    // And a normalization diagnostic is recorded
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "TOOL_CALL_ARGUMENTS_PARSE_FAILED"
      )
    );
  });
});

describe("Scenario: Normalize observed token usage", () => {
  it("projects observed counts without introducing estimates", () => {
    // Given a provider response containing token usage testimony
    const raw = buildsOpenaiResponse();

    // When the provider response is normalized
    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    const { usage } = result.response;

    // Then the observed token counts are projected
    assert.equal(usage.inputTokens, 75);
    assert.equal(usage.outputTokens, 12);
    assert.equal(usage.totalTokens, 87);

    // And the usage disposition is "observed"
    assert.equal(usage.disposition, "observed");

    // And no estimated values are introduced
    assert.equal(usage.cachedInputTokens, null);
    assert.equal(usage.reasoningTokens, null);
  });
});

describe("Scenario: Report unavailable token usage", () => {
  it("reports absence rather than inventing zeroes", () => {
    // Given a provider response without token usage testimony
    const raw = buildsOpenaiResponse();
    delete raw.usage;

    // When the provider response is normalized
    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    const { usage } = result.response;

    // Then the usage disposition is "unavailable"
    assert.equal(usage.disposition, "unavailable");

    // And all unavailable token values are null
    assert.equal(usage.inputTokens, null);
    assert.equal(usage.outputTokens, null);
    assert.equal(usage.totalTokens, null);
    assert.equal(usage.cachedInputTokens, null);
    assert.equal(usage.reasoningTokens, null);
  });
});

describe("Scenario: Preserve a provider refusal", () => {
  it("represents a refusal as refused rather than completed", () => {
    // Given a provider response containing an explicit refusal
    const raw = buildsOpenaiResponse({
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            refusal: "I cannot help with that request.",
          },
          finish_reason: "stop",
        },
      ],
    });

    // When the provider response is normalized
    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");

    // Then the refusal is present in the canonical response
    assert.equal(result.response.refusal.present, true);
    assert.equal(
      result.response.refusal.reason,
      "I cannot help with that request."
    );

    // And the canonical disposition is "refused"
    assert.equal(result.response.outcome.disposition, "refused");

    // And the provider refusal category is preserved
    assert.equal(result.response.refusal.providerCategory, "refusal");

    // The provider's own finish reason survives the reclassification.
    assert.equal(result.response.outcome.providerFinishReason, "stop");
  });
});

describe("Scenario: Preserve a provider safety block", () => {
  it("represents a blocked response as safety-blocked", () => {
    // Given a provider response blocked by a provider safety mechanism
    const raw = buildsGeminiResponse({
      candidates: [],
      promptFeedback: {
        blockReason: "SAFETY",
        safetyRatings: [
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            probability: "HIGH",
            blocked: true,
          },
        ],
      },
    });

    // When the provider response is normalized
    const result = normalizesProviderResponse(
      buildsContext("gemini", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");

    // Then the canonical disposition is "safety-blocked"
    assert.equal(result.response.outcome.disposition, "safety-blocked");

    // And the provider safety signals are preserved
    assert.equal(result.response.safety.signalsPresent, true);
    assert.ok(
      result.response.safety.signals.some(
        (signal) => signal.category === "HARM_CATEGORY_DANGEROUS_CONTENT"
      )
    );
    assert.ok(result.response.safety.signals.some((signal) => signal.blocked));

    // And the response is not represented as successfully completed
    assert.notEqual(result.response.outcome.disposition, "completed");
    assert.equal(result.response.content.combinedText, "");
  });
});

describe("Scenario: Reject an unsupported provider response", () => {
  it("rejects rather than fabricating a canonical response", () => {
    // Given no authorized adapter recognizes the provider response
    const raw = { unrecognizable: true };

    // When normalization is attempted
    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    // Then the result disposition is "rejected"
    assert.equal(result.disposition, "rejected");
    assert.ok(result.disposition === "rejected");

    // And the failure code is "PROVIDER_RESPONSE_NOT_RECOGNIZED"
    assert.equal(result.failure.code, "PROVIDER_RESPONSE_NOT_RECOGNIZED");

    // And no canonical response is fabricated
    assert.ok(!("response" in result));
  });
});

describe("Scenario: Reject an invalid canonical projection", () => {
  it("rejects an adapter projecting a noncanonical disposition", () => {
    // Given a provider adapter produces a projection
    // And the projection violates the canonical response contract
    const adapter = createsFabricatingAdapter(
      "openai",
      buildsValidProjection({
        outcome: {
          disposition: "totally-fine",
          providerFinishReason: "stop",
        },
      })
    );

    // When normalization is completed
    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies([adapter])
    );

    // Then the result disposition is "rejected"
    assert.equal(result.disposition, "rejected");
    assert.ok(result.disposition === "rejected");

    // And the failure code is "CANONICAL_PROJECTION_INVALID"
    assert.equal(result.failure.code, "CANONICAL_PROJECTION_INVALID");
  });
});

describe("Scenario: Produce byte-stable normalized output", () => {
  it("produces identical bytes across repeated executions", () => {
    // Given the same provider response
    const raw = buildsOpenaiResponse();

    // And the same normalization authority
    // When normalization is executed multiple times
    const first = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );
    const second = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    assert.ok(first.disposition === "normalized");
    assert.ok(second.disposition === "normalized");

    // Then the semantic canonical response is identical
    assert.deepEqual(first.response, second.response);

    // And deterministic fields are byte-stable
    assert.equal(canonicalJson(first.response), canonicalJson(second.response));
  });
});

describe("Scenario: Collapse provider dialects into one contract", () => {
  it("projects equivalent OpenAI and Gemini testimony onto one contract", () => {
    // Given equivalent responses from two different providers
    // When each provider response is normalized
    const openai = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies()
    );
    const gemini = normalizesProviderResponse(
      buildsContext("gemini", buildsGeminiResponse()),
      buildsDependencies()
    );

    assert.ok(openai.disposition === "normalized");
    assert.ok(gemini.disposition === "normalized");

    // Then both canonical responses carry the same disposition
    assert.equal(openai.response.outcome.disposition, "completed");
    assert.equal(gemini.response.outcome.disposition, "completed");

    // And both canonical responses carry the same combined text
    assert.equal(
      openai.response.content.combinedText,
      gemini.response.content.combinedText
    );

    // And each canonical response preserves its own provider provenance
    assert.equal(openai.response.provider.providerId, "openai");
    assert.equal(openai.response.outcome.providerFinishReason, "stop");

    assert.equal(gemini.response.provider.providerId, "gemini");
    assert.equal(gemini.response.outcome.providerFinishReason, "STOP");

    // Usage collapses onto the same canonical shape despite different dialects.
    assert.deepEqual(
      {
        input: openai.response.usage.inputTokens,
        output: openai.response.usage.outputTokens,
        total: openai.response.usage.totalTokens,
      },
      {
        input: gemini.response.usage.inputTokens,
        output: gemini.response.usage.outputTokens,
        total: gemini.response.usage.totalTokens,
      }
    );
  });
});

describe("Scenario: Normalize an Anthropic response", () => {
  it("projects the Anthropic dialect onto the same contract", () => {
    const result = normalizesProviderResponse(
      buildsContext("anthropic", buildsAnthropicResponse()),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    assert.equal(result.response.outcome.disposition, "completed");
    assert.equal(result.response.outcome.providerFinishReason, "end_turn");
    assert.equal(
      result.response.content.combinedText,
      "The capability is ready."
    );

    // Anthropic reports no total, so it is derived from observed operands only.
    assert.equal(result.response.usage.inputTokens, 75);
    assert.equal(result.response.usage.outputTokens, 12);
    assert.equal(result.response.usage.totalTokens, 87);
    assert.equal(result.response.usage.disposition, "observed");
  });
});

describe("Scenario: Apply the declared normalization policy", () => {
  it("parses declared structured output and reports unparseable output", () => {
    const parsed = normalizesProviderResponse(
      buildsContext(
        "openai",
        buildsOpenaiResponse({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: '{"capabilityId":"response-normalizer"}',
              },
              finish_reason: "stop",
            },
          ],
        }),
        { structuredOutputRequested: true }
      ),
      buildsDependencies()
    );

    assert.ok(parsed.disposition === "normalized");
    assert.equal(parsed.response.content.structuredOutput?.disposition, "parsed");
    assert.deepEqual(parsed.response.content.structuredOutput?.value, {
      capabilityId: "response-normalizer",
    });

    const invalid = normalizesProviderResponse(
      buildsContext(
        "openai",
        buildsOpenaiResponse({
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: '{"capabilityId":' },
              finish_reason: "stop",
            },
          ],
        }),
        { structuredOutputRequested: true }
      ),
      buildsDependencies()
    );

    assert.ok(invalid.disposition === "normalized");

    // The normalizer reports the failure; it never manufactures corrected JSON.
    assert.equal(
      invalid.response.content.structuredOutput?.disposition,
      "invalid-json"
    );
    assert.equal(invalid.response.content.structuredOutput?.value, null);
    assert.ok(
      invalid.diagnostics.some(
        (diagnostic) => diagnostic.code === "STRUCTURED_OUTPUT_PARSE_FAILED"
      )
    );

    // The original text is still available as a segment.
    assert.equal(invalid.response.content.combinedText, '{"capabilityId":');
  });

  it("omits reasoning segments unless policy includes them", () => {
    const raw = buildsAnthropicResponse({
      content: [
        { type: "thinking", thinking: "Considering the request." },
        { type: "text", text: "Answer." },
      ],
    });

    const excluded = normalizesProviderResponse(
      buildsContext("anthropic", raw),
      buildsDependencies()
    );

    assert.ok(excluded.disposition === "normalized");
    assert.deepEqual(
      excluded.response.content.segments.map((segment) => segment.kind),
      ["text"]
    );

    const included = normalizesProviderResponse(
      buildsContext("anthropic", raw, {
        normalizationPolicy: buildsPolicy({
          content: {
            preserveSegmentOrder: true,
            combineTextSegments: true,
            includeReasoningSummary: true,
            maximumCandidates: 1,
          },
        }),
      }),
      buildsDependencies()
    );

    assert.ok(included.disposition === "normalized");
    assert.deepEqual(
      included.response.content.segments.map((segment) => segment.kind),
      ["reasoning-summary", "text"]
    );

    // Reasoning never leaks into the combined text either way.
    assert.equal(included.response.content.combinedText, "Answer.");
  });
});
