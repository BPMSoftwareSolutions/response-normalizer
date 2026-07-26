import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizesProviderResponse } from "../../src/normalize-provider-response/normalizes-provider-response.js";
import { readsDeclaredAdapters } from "../../src/project-provider-response/creates-declared-adapter.js";
import { sha256Hashes } from "../../src/adapters/runtime-ports.js";
import {
  buildsAnthropicResponse,
  buildsContext,
  buildsDependencies,
  buildsGeminiResponse,
  buildsOpenaiResponse,
  buildsPolicy,
  buildsValidProjection,
  createsFabricatingAdapter,
} from "../acceptance/builds-normalizer-fixtures.js";

/**
 * The mutation suite proves the capability does more than pass happy-path
 * fixtures. Each case below is a negative control from the intent's
 * adversarial catalogue.
 *
 * Together they establish three claims:
 *
 *   The normalizer rejects unsupported testimony.
 *   The normalizer preserves inconvenient testimony.
 *   The normalizer never silently converts uncertainty into success.
 */

describe("Mutation: delete the provider finish reason", () => {
  it("classifies from remaining testimony and records a diagnostic", () => {
    const raw = buildsOpenaiResponse({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Text without a finish reason." },
        },
      ],
    });

    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");

    // Absent testimony becomes "unknown", never an assumed "completed".
    assert.equal(result.response.outcome.disposition, "unknown");
    assert.equal(result.response.outcome.providerFinishReason, null);

    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "PROVIDER_FINISH_REASON_ABSENT"
      )
    );
  });

  it("still recognizes tool calls when the finish reason is missing", () => {
    const raw = buildsAnthropicResponse({
      content: [
        { type: "tool_use", id: "call-1", name: "searchFiles", input: {} },
      ],
    });
    delete raw.stop_reason;

    const result = normalizesProviderResponse(
      buildsContext("anthropic", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    assert.equal(result.response.outcome.disposition, "tool-calls-requested");
  });
});

describe("Mutation: change a usage token field from number to string", () => {
  it("refuses to coerce the value and reports the unusable testimony", () => {
    const raw = buildsOpenaiResponse({
      usage: {
        prompt_tokens: "75",
        completion_tokens: 12,
        total_tokens: 87,
      },
    });

    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");

    // The string is not silently parsed into 75.
    assert.equal(result.response.usage.inputTokens, null);
    assert.equal(result.response.usage.outputTokens, 12);
    assert.equal(result.response.usage.disposition, "partially-observed");

    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "USAGE_TOKEN_COUNT_NOT_INTERPRETABLE"
      )
    );
  });

  it("refuses a negative or fractional token count", () => {
    for (const value of [-5, 12.5]) {
      const result = normalizesProviderResponse(
        buildsContext(
          "openai",
          buildsOpenaiResponse({
            usage: { prompt_tokens: value, completion_tokens: 12 },
          })
        ),
        buildsDependencies()
      );

      assert.ok(result.disposition === "normalized");
      assert.equal(result.response.usage.inputTokens, null);
    }
  });
});

describe("Mutation: reorder provider content blocks", () => {
  it("follows the source order rather than a canonical sort", () => {
    const forward = normalizesProviderResponse(
      buildsContext(
        "anthropic",
        buildsAnthropicResponse({
          content: [
            { type: "text", text: "alpha" },
            { type: "text", text: "beta" },
          ],
        })
      ),
      buildsDependencies()
    );

    const reversed = normalizesProviderResponse(
      buildsContext(
        "anthropic",
        buildsAnthropicResponse({
          content: [
            { type: "text", text: "beta" },
            { type: "text", text: "alpha" },
          ],
        })
      ),
      buildsDependencies()
    );

    assert.ok(forward.disposition === "normalized");
    assert.ok(reversed.disposition === "normalized");

    assert.equal(forward.response.content.combinedText, "alphabeta");
    assert.equal(reversed.response.content.combinedText, "betaalpha");
  });
});

describe("Mutation: introduce two matching adapters", () => {
  it("rejects with PROVIDER_ADAPTER_AMBIGUOUS rather than picking one", () => {
    const declared = readsDeclaredAdapters();
    const openai = declared.find((adapter) => adapter.providerId === "openai");

    assert.ok(openai);

    const duplicate = createsFabricatingAdapter(
      "openai",
      buildsValidProjection(),
      "openai-duplicate-adapter"
    );

    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies([openai, duplicate])
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "PROVIDER_ADAPTER_AMBIGUOUS");
  });

  it("rejects when no adapter is declared for the provider", () => {
    const result = normalizesProviderResponse(
      buildsContext("provider-never-declared", buildsOpenaiResponse()),
      buildsDependencies()
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "PROVIDER_ADAPTER_NOT_FOUND");
  });
});

describe("Mutation: return an empty successful candidate", () => {
  it("does not represent empty content as completed text", () => {
    const raw = buildsGeminiResponse({
      candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }],
    });

    const result = normalizesProviderResponse(
      buildsContext("gemini", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");

    // The provider said "STOP", so that testimony stands, but no text is invented.
    assert.equal(result.response.content.combinedText, "");
    assert.equal(result.response.content.segments.length, 0);
    assert.equal(result.response.outcome.providerFinishReason, "STOP");
  });
});

describe("Mutation: return safety metadata without content", () => {
  it("preserves graded ratings that did not cause a block", () => {
    const raw = buildsGeminiResponse({
      candidates: [
        {
          content: { role: "model", parts: [] },
          finishReason: "SAFETY",
          safetyRatings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              probability: "MEDIUM",
              blocked: false,
            },
          ],
        },
      ],
    });

    const result = normalizesProviderResponse(
      buildsContext("gemini", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    assert.equal(result.response.outcome.disposition, "safety-blocked");

    // An unblocked rating is still evidence and is preserved.
    assert.equal(result.response.safety.signalsPresent, true);
    assert.equal(result.response.safety.signals[0]?.severity, "MEDIUM");
    assert.equal(result.response.safety.signals[0]?.blocked, false);
  });
});

describe("Mutation: return multiple candidates when policy allows only one", () => {
  it("projects only the authorized candidate and records the omission", () => {
    const raw = buildsOpenaiResponse({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "First candidate." },
          finish_reason: "stop",
        },
        {
          index: 1,
          message: { role: "assistant", content: "Second candidate." },
          finish_reason: "stop",
        },
      ],
    });

    const result = normalizesProviderResponse(
      buildsContext("openai", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    assert.equal(result.response.content.combinedText, "First candidate.");

    // Discarding a candidate silently would be losing material testimony.
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "ADDITIONAL_CANDIDATES_NOT_PROJECTED"
      )
    );
  });
});

describe("Mutation: cause an adapter to fabricate totalTokens", () => {
  it("rejects a total below the sum of its own observed parts", () => {
    const adapter = createsFabricatingAdapter(
      "openai",
      buildsValidProjection({
        usage: {
          disposition: "observed",
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 7,
          cachedInputTokens: null,
          reasoningTokens: null,
          providerUsage: {},
        },
      })
    );

    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse(), {
        normalizationPolicy: buildsPolicy({
          usage: { allowDerivedTotal: false, allowEstimatedUsage: false },
        }),
      }),
      buildsDependencies([adapter])
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "CANONICAL_PROJECTION_INVALID");
  });

  it("rejects a claim of full observation with a missing count", () => {
    const adapter = createsFabricatingAdapter(
      "openai",
      buildsValidProjection({
        usage: {
          disposition: "observed",
          inputTokens: null,
          outputTokens: null,
          totalTokens: 125,
          cachedInputTokens: null,
          reasoningTokens: null,
          providerUsage: {},
        },
      })
    );

    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies([adapter])
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "CANONICAL_PROJECTION_INVALID");
  });

  it("rejects token counts attached to an unavailable disposition", () => {
    const adapter = createsFabricatingAdapter(
      "openai",
      buildsValidProjection({
        usage: {
          disposition: "unavailable",
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cachedInputTokens: null,
          reasoningTokens: null,
          providerUsage: {},
        },
      })
    );

    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies([adapter])
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "CANONICAL_PROJECTION_INVALID");
  });
});

describe("Mutation: cause an adapter to omit the provider identity", () => {
  it("rejects a projection missing a required canonical region", () => {
    const projection = buildsValidProjection();
    delete (projection as Record<string, unknown>).provider;

    const adapter = createsFabricatingAdapter("openai", projection);

    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies([adapter])
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "CANONICAL_PROJECTION_INVALID");
  });
});

describe("Mutation: cause an adapter to project a noncanonical disposition", () => {
  it("rejects a disposition outside the controlled vocabulary", () => {
    const adapter = createsFabricatingAdapter(
      "openai",
      buildsValidProjection({
        outcome: { disposition: "mostly-fine", providerFinishReason: "stop" },
      })
    );

    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies([adapter])
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "CANONICAL_PROJECTION_INVALID");
  });

  it("rejects parsed arguments attached to unparseable testimony", () => {
    const adapter = createsFabricatingAdapter(
      "openai",
      buildsValidProjection({
        content: {
          segments: [],
          combinedText: "",
          structuredOutput: null,
          toolCalls: [
            {
              callId: "call-1",
              toolName: "searchFiles",
              argumentsText: '{"query":',
              arguments: { query: "repaired-by-the-adapter" },
              argumentsDisposition: "invalid-json",
            },
          ],
        },
      })
    );

    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies([adapter])
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "CANONICAL_PROJECTION_INVALID");
  });
});

describe("Mutation: modify the raw response after its hash was calculated", () => {
  it("rejects with RAW_RESPONSE_HASH_MISMATCH", () => {
    const witnessed = buildsOpenaiResponse();
    const witnessedHash = sha256Hashes.hashes(witnessed);

    const tampered = buildsOpenaiResponse({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Substituted testimony." },
          finish_reason: "stop",
        },
      ],
    });

    const result = normalizesProviderResponse(
      buildsContext("openai", tampered, { rawResponseHash: witnessedHash }),
      buildsDependencies()
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "RAW_RESPONSE_HASH_MISMATCH");
  });
});

describe("Mutation: submit an unsupported normalization policy", () => {
  it("rejects a policy carrying a semantic-rewriting setting", () => {
    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse(), {
        normalizationPolicy: {
          ...buildsPolicy(),
          repairMalformedJson: true,
        } as never,
      }),
      buildsDependencies()
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "NORMALIZATION_POLICY_UNSUPPORTED");
  });

  it("rejects a policy authorizing estimated usage", () => {
    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse(), {
        normalizationPolicy: buildsPolicy({
          usage: { allowDerivedTotal: true, allowEstimatedUsage: true },
        }),
      }),
      buildsDependencies()
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "NORMALIZATION_POLICY_UNSUPPORTED");
  });
});

describe("Mutation: submit a malformed normalization request", () => {
  it("rejects a missing correlation identifier", () => {
    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse(), {
        correlationId: "",
      }),
      buildsDependencies()
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "NORMALIZATION_REQUEST_INVALID");
  });

  it("rejects a malformed raw response hash", () => {
    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse(), {
        rawResponseHash: "not-a-hash",
      }),
      buildsDependencies()
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "NORMALIZATION_REQUEST_INVALID");
  });

  it("accepts a null raw response as testimony rather than an omission", () => {
    const result = normalizesProviderResponse(
      buildsContext("openai", null),
      buildsDependencies()
    );

    // A null response is present-but-unrecognizable, not an invalid request.
    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "PROVIDER_RESPONSE_NOT_RECOGNIZED");
  });
});

describe("Mutation: cause an adapter to throw", () => {
  it("classifies the failure rather than propagating an exception", () => {
    const adapter = Object.freeze({
      providerId: "openai",
      adapterId: "openai-throwing-adapter",
      adapterVersion: "0.1.0",
      recognizes: () => ({ recognized: true as const, confidence: "exact" as const }),
      projectsCanonicalResponse: () => {
        throw new Error("The adapter could not read the response.");
      },
    });

    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies([adapter])
    );

    assert.ok(result.disposition === "rejected");
    assert.equal(result.failure.code, "PROVIDER_RESPONSE_MALFORMED");
  });
});

describe("Mutation: preserve unmodelled content segments", () => {
  it("retains an unsupported segment verbatim with a diagnostic", () => {
    const raw = buildsAnthropicResponse({
      content: [
        { type: "text", text: "Here is a chart." },
        { type: "image", source: { type: "base64", data: "AAAA" } },
      ],
    });

    const result = normalizesProviderResponse(
      buildsContext("anthropic", raw),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");

    const unsupported = result.response.content.segments.find(
      (segment) => segment.kind === "unsupported"
    );

    assert.ok(unsupported);
    assert.deepEqual(unsupported.raw, {
      type: "image",
      source: { type: "base64", data: "AAAA" },
    });

    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "UNSUPPORTED_CONTENT_SEGMENT_PRESERVED"
      )
    );
  });
});
