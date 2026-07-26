# Response Normalizer

This is the right next capability because the **Generic LLM Connector already gives us provider testimony**, but every provider speaks a different response dialect.

The Response Normalizer establishes one deterministic boundary:

> **Accept raw provider testimony and project it into one canonical response without inventing, repairing, or discarding material facts.**

That places it immediately after the connector and before validation, retry decisions, reporting, and receipt generation. 

```text
Generic LLM Connector
        │
        │ raw provider testimony
        ▼
Response Normalizer
        │
        │ canonical model response
        ├────────▶ JSON Output Validator
        ├────────▶ Token Usage Reporter
        ├────────▶ Retry Policy Executor
        └────────▶ Execution Receipt Generator
```

---

# 1. Capability Boundary

## Capability

```text
response-normalizer
```

## Public operation

```text
normalizesProviderResponse(
    providerResponse,
    normalizationAuthority
)
```

Or, using a result-oriented name:

```text
obtainsCanonicalModelResponse(
    providerResponse,
    normalizationAuthority
)
```

I prefer the first name for this micro-app because its responsibility is deliberately mechanical:

```text
normalizesProviderResponse(...)
```

It should not imply that it invoked the provider, validated the content, or accepted the answer.

## Responsibility

```text
projects provider-specific response testimony
into the canonical model-response contract
```

## It owns

* Provider-response shape recognition
* Canonical content projection
* Finish-disposition mapping
* Tool-call projection
* Structured-output extraction
* Usage projection
* Refusal and safety-signal preservation
* Provider metadata preservation
* Normalization diagnostics
* Unsupported-shape rejection

## It does not own

* Calling the provider
* Selecting a provider or model
* Parsing arbitrary malformed JSON into valid business output
* Validating the output against a JSON Schema
* Deciding whether to retry
* Calculating cost
* Generating the final execution receipt
* Hiding provider errors
* Guessing missing usage values

That gives us a clean boundary:

```text
Connector says:    “This is what the provider returned.”

Normalizer says:   “This is the canonical representation of that testimony.”

Validator says:    “This content does or does not satisfy the output contract.”

Retry executor says:
                   “Another attempt is or is not authorized.”
```

---

# 2. Core Architectural Rule

The normalizer must **preserve testimony rather than beautify it**.

```text
Normalize shape
      ≠
Repair meaning
```

For example, it may map:

```text
OpenAI:  finish_reason = "stop"
Gemini:  finishReason  = "STOP"
Claude:  stop_reason   = "end_turn"
```

into:

```json
{
  "finishDisposition": "completed"
}
```

But it must also preserve the original provider value:

```json
{
  "finishDisposition": "completed",
  "providerFinishReason": "STOP"
}
```

That gives downstream capabilities portability without losing evidence.

---

# 3. Canonical Response Contract

I would make the canonical result an immutable response body with five major regions:

```text
Canonical Model Response
├── identity
├── outcome
├── content
├── observations
└── provenance
```

A practical first version:

```json
{
  "$schema": "./canonical-model-response.schema.json",
  "contractVersion": "1.0.0",

  "responseId": "response-01J...",
  "correlationId": "request-01J...",

  "provider": {
    "providerId": "openai",
    "adapterId": "openai-responses-adapter",
    "providerResponseId": "resp_...",
    "providerRequestId": null
  },

  "model": {
    "requestedModel": "gpt-model-alias",
    "resolvedModel": "resolved-provider-model",
    "providerReportedModel": "resolved-provider-model"
  },

  "outcome": {
    "disposition": "completed",
    "providerFinishReason": "stop",
    "retryability": "not-classified"
  },

  "content": {
    "segments": [
      {
        "index": 0,
        "kind": "text",
        "text": "Normalized response text."
      }
    ],
    "combinedText": "Normalized response text.",
    "structuredOutput": null,
    "toolCalls": []
  },

  "refusal": {
    "present": false,
    "reason": null,
    "providerCategory": null
  },

  "safety": {
    "signalsPresent": false,
    "signals": []
  },

  "usage": {
    "disposition": "observed",
    "inputTokens": 125,
    "outputTokens": 48,
    "totalTokens": 173,
    "cachedInputTokens": null,
    "reasoningTokens": null,
    "providerUsage": {}
  },

  "diagnostics": [],

  "provenance": {
    "normalizedAt": "2026-07-26T09:45:00.000Z",
    "normalizerVersion": "0.1.0",
    "adapterVersion": "0.1.0",
    "rawResponseHash": "sha256:...",
    "rawResponseReference": null
  }
}
```

---

# 4. Canonical Content Model

The biggest mistake would be assuming every model response is just one string.

Responses may contain:

* Text
* Structured JSON
* Tool calls
* Refusals
* Images or image references
* Audio references
* Reasoning summaries
* Provider annotations
* Multiple candidates
* Multiple content blocks

So the canonical body should use segments.

```json
{
  "content": {
    "segments": [
      {
        "index": 0,
        "kind": "text",
        "text": "I found three files."
      },
      {
        "index": 1,
        "kind": "tool-call",
        "toolCall": {
          "callId": "call-123",
          "toolName": "searchFiles",
          "argumentsText": "{\"query\":\"*.json\"}",
          "arguments": {
            "query": "*.json"
          },
          "argumentsDisposition": "parsed"
        }
      }
    ],
    "combinedText": "I found three files.",
    "structuredOutput": null,
    "toolCalls": [
      {
        "callId": "call-123",
        "toolName": "searchFiles",
        "argumentsText": "{\"query\":\"*.json\"}",
        "arguments": {
          "query": "*.json"
        },
        "argumentsDisposition": "parsed"
      }
    ]
  }
}
```

The segment sequence preserves provider order.

The convenience projections—`combinedText`, `structuredOutput`, and `toolCalls`—make downstream consumption easy.

---

# 5. Response Dispositions

We need a controlled vocabulary rather than leaking arbitrary provider strings throughout the ecosystem.

```text
completed
length-limited
tool-calls-requested
refused
safety-blocked
content-filtered
cancelled
provider-failed
malformed-provider-response
unsupported-provider-response
unknown
```

## Mapping examples

| Provider testimony                                 | Canonical disposition           |
| -------------------------------------------------- | ------------------------------- |
| `stop`, `STOP`, `end_turn`                         | `completed`                     |
| `length`, `MAX_TOKENS`, `max_tokens`               | `length-limited`                |
| `tool_calls`, `tool_use`                           | `tool-calls-requested`          |
| Explicit refusal block                             | `refused`                       |
| Safety filter or blocked candidate                 | `safety-blocked`                |
| Invocation error response                          | `provider-failed`               |
| Known provider but missing required response shape | `malformed-provider-response`   |
| No adapter supports the response shape             | `unsupported-provider-response` |

The original reason stays preserved:

```json
{
  "disposition": "length-limited",
  "providerFinishReason": "MAX_TOKENS"
}
```

---

# 6. Usage Testimony

Usage must never silently become fiction.

```text
usage.disposition
├── observed
├── partially-observed
├── unavailable
└── not-applicable
```

Example where the provider only gives input and output tokens:

```json
{
  "usage": {
    "disposition": "observed",
    "inputTokens": 100,
    "outputTokens": 25,
    "totalTokens": 125,
    "cachedInputTokens": null,
    "reasoningTokens": null
  }
}
```

Example where only total usage exists:

```json
{
  "usage": {
    "disposition": "partially-observed",
    "inputTokens": null,
    "outputTokens": null,
    "totalTokens": 125,
    "cachedInputTokens": null,
    "reasoningTokens": null
  }
}
```

Example where no usage was supplied:

```json
{
  "usage": {
    "disposition": "unavailable",
    "inputTokens": null,
    "outputTokens": null,
    "totalTokens": null,
    "cachedInputTokens": null,
    "reasoningTokens": null
  }
}
```

The later Token Usage Reporter may produce estimates, but the normalizer should only project what the provider actually testified.

---

# 7. Structured Output Handling

The Response Normalizer should distinguish three concepts:

```text
Text extraction
JSON parsing
Schema validation
```

Only the first two belong here.

```text
Provider content
      │
      ▼
Extract text or structured payload
      │
      ▼
Parse JSON when explicitly authorized
      │
      ▼
Canonical structuredOutput
      │
      ▼
JSON Output Validator validates schema
```

Canonical representation:

```json
{
  "structuredOutput": {
    "disposition": "parsed",
    "value": {
      "capabilityId": "response-normalizer"
    },
    "source": "provider-structured-output"
  }
}
```

Possible dispositions:

```text
not-requested
not-present
parsed
invalid-json
provider-native
```

If JSON parsing fails, the normalizer should not manufacture corrected JSON:

```json
{
  "structuredOutput": {
    "disposition": "invalid-json",
    "value": null,
    "source": "text-content"
  },
  "diagnostics": [
    {
      "code": "STRUCTURED_OUTPUT_PARSE_FAILED",
      "severity": "error",
      "path": "$.content",
      "message": "The declared structured output could not be parsed as JSON."
    }
  ]
}
```

Whether that failure triggers a retry belongs elsewhere.

---

# 8. Provider Adapter Model

The normalizer should not become one giant provider-switch statement.

```text
Response Normalizer
        │
        ▼
Provider Adapter Registry
        │
        ├── openai response adapter
        ├── gemini response adapter
        ├── anthropic response adapter
        ├── litellm response adapter
        └── llamacpp response adapter
```

## Adapter contract

```ts
export interface ProviderResponseAdapter {
  readonly providerId: string;
  readonly adapterVersion: string;

  recognizes(
    response: UnknownProviderResponse
  ): ProviderResponseRecognition;

  projectsCanonicalResponse(
    context: NormalizeProviderResponseContext
  ): CanonicalModelResponseProjection;
}
```

The adapter should only understand its provider dialect.

The normalizer owns common policy and orchestration:

```text
1. Validate normalization request
2. Resolve provider adapter
3. Confirm adapter recognizes response
4. Ask adapter to project provider testimony
5. Enforce canonical response schema
6. Add provenance and diagnostics
7. Return normalization result
```

---

# 9. Immutable Input Context

To avoid DTO stitching, pass one immutable context across the boundary.

```ts
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
  normalizationPolicy: NormalizationPolicy;
}>;
```

The operation becomes:

```ts
export function normalizesProviderResponse(
  context: NormalizeProviderResponseContext,
  dependencies: NormalizeProviderResponseDependencies
): NormalizeProviderResponseResult
```

No scattered argument list such as:

```ts
normalize(
  provider,
  model,
  rawResponse,
  requestId,
  parseJson,
  preserveRaw,
  allowEmpty,
  finishReasonMap
);
```

The context itself is the sealed edge.

---

# 10. Normalization Policy

Provider mechanics should live in adapters, but cross-provider normalization behavior should be declared through policy.

```json
{
  "policyVersion": "1.0.0",
  "content": {
    "preserveSegmentOrder": true,
    "combineTextSegments": true,
    "includeReasoningSummary": false
  },
  "structuredOutput": {
    "parseTextAsJson": "only-when-declared",
    "preserveOriginalText": true
  },
  "toolCalls": {
    "parseArguments": true,
    "retainArgumentsText": true
  },
  "usage": {
    "allowDerivedTotal": true,
    "allowEstimatedUsage": false
  },
  "rawResponse": {
    "retention": "hash-and-reference"
  },
  "unsupportedContent": {
    "disposition": "preserve-with-diagnostic"
  }
}
```

The policy must never authorize semantic rewriting.

There should be no setting like:

```json
{
  "repairMalformedJson": true
}
```

That would belong to a separate bounded cognitive or repair capability.

---

# 11. Result Contract

The operation itself should return a deterministic success-or-failure result.

```ts
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
```

## Failure classifications

```text
NORMALIZATION_REQUEST_INVALID
PROVIDER_ADAPTER_NOT_FOUND
PROVIDER_ADAPTER_AMBIGUOUS
PROVIDER_RESPONSE_NOT_RECOGNIZED
PROVIDER_RESPONSE_MALFORMED
CANONICAL_PROJECTION_INVALID
RAW_RESPONSE_HASH_MISMATCH
NORMALIZATION_POLICY_UNSUPPORTED
NORMALIZATION_FAILED
```

This makes failure classification stable and machine-readable.

---

# 12. C4 Component View

```text
┌──────────────────────── RESPONSE NORMALIZER ─────────────────────────┐
│                                                                      │
│  ┌────────────────────────┐                                          │
│  │ Normalization Request  │                                          │
│  │ Validator              │                                          │
│  └────────────┬───────────┘                                          │
│               ▼                                                      │
│  ┌────────────────────────┐       ┌──────────────────────────────┐   │
│  │ Provider Adapter       │──────▶│ Provider Response Adapter    │   │
│  │ Resolver               │       │                              │   │
│  └────────────────────────┘       │ OpenAI / Gemini / Claude /   │   │
│                                   │ LiteLLM / llama.cpp           │   │
│                                   └──────────────┬───────────────┘   │
│                                                  ▼                   │
│                                   ┌──────────────────────────────┐   │
│                                   │ Content Segment Projector    │   │
│                                   └──────────────┬───────────────┘   │
│                                                  ▼                   │
│       ┌─────────────────────┐      ┌──────────────────────────────┐   │
│       │ Finish Disposition  │─────▶│ Canonical Response Builder   │   │
│       │ Resolver            │      │                              │   │
│       └─────────────────────┘      │ content                      │   │
│                                    │ outcome                      │   │
│       ┌─────────────────────┐      │ usage                        │   │
│       │ Usage Projector     │─────▶│ refusal / safety             │   │
│       └─────────────────────┘      │ provider provenance          │   │
│                                    └──────────────┬───────────────┘   │
│       ┌─────────────────────┐                     ▼                   │
│       │ Tool Call Projector │─────▶┌──────────────────────────────┐   │
│       └─────────────────────┘      │ Canonical Contract Validator │   │
│                                    └──────────────┬───────────────┘   │
│       ┌─────────────────────┐                     ▼                   │
│       │ Diagnostic Builder  │─────▶ Normalized Response Result       │
│       └─────────────────────┘                                         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

# 13. Repository Body

Following the noun-folder and verb-file posture:

```text
response-normalizer/
├── README.md
├── package.json
├── tsconfig.json
│
├── authority/
│   ├── response-normalizer.capability.json
│   ├── canonical-model-response.schema.json
│   ├── normalization-policy.schema.json
│   └── response-normalizer.feature
│
├── src/
│   ├── normalize-provider-response/
│   │   ├── normalize-provider-response.context.type.ts
│   │   ├── normalize-provider-response.result.type.ts
│   │   ├── normalizes-provider-response.ts
│   │   ├── validates-normalization-request.ts
│   │   ├── resolves-provider-response-adapter.ts
│   │   ├── validates-canonical-response-projection.ts
│   │   └── builds-normalization-failure.ts
│   │
│   ├── project-openai-response/
│   │   ├── recognizes-openai-response.ts
│   │   ├── projects-openai-response.ts
│   │   ├── projects-openai-content-segments.ts
│   │   ├── projects-openai-tool-calls.ts
│   │   └── projects-openai-usage.ts
│   │
│   ├── project-gemini-response/
│   │   ├── recognizes-gemini-response.ts
│   │   ├── projects-gemini-response.ts
│   │   ├── projects-gemini-content-segments.ts
│   │   ├── projects-gemini-safety-signals.ts
│   │   └── projects-gemini-usage.ts
│   │
│   ├── project-anthropic-response/
│   │   ├── recognizes-anthropic-response.ts
│   │   ├── projects-anthropic-response.ts
│   │   ├── projects-anthropic-content-segments.ts
│   │   ├── projects-anthropic-tool-calls.ts
│   │   └── projects-anthropic-usage.ts
│   │
│   └── canonical-model-response/
│       ├── canonical-model-response.type.ts
│       ├── canonical-content-segment.type.ts
│       ├── canonical-tool-call.type.ts
│       ├── canonical-usage.type.ts
│       └── normalization-diagnostic.type.ts
│
└── tests/
    ├── normalize-provider-response/
    │   └── normalizes-provider-response.test.ts
    ├── project-openai-response/
    │   └── projects-openai-response.test.ts
    ├── project-gemini-response/
    │   └── projects-gemini-response.test.ts
    └── project-anthropic-response/
        └── projects-anthropic-response.test.ts
```

Each scenario gets its own bounded implementation and test placement.

---

# 14. Gherkin Acceptance Authority

```gherkin
Feature: Normalize provider responses

  The response normalizer projects provider-specific testimony
  into one canonical model-response contract without inventing
  or discarding material execution facts.

  Scenario: Normalize a completed text response
    Given an authorized provider response adapter
    And a provider response containing completed text
    When the provider response is normalized
    Then the result disposition is "normalized"
    And the canonical response contains the provider text
    And the canonical finish disposition is "completed"
    And the original provider finish reason is preserved
    And the raw provider response hash is recorded

  Scenario: Preserve multiple content segments in provider order
    Given a provider response containing multiple content segments
    When the provider response is normalized
    Then every supported segment is projected
    And the segment order matches the provider response
    And the combined text contains only textual segments

  Scenario: Normalize a provider tool call
    Given a provider response containing a tool call
    When the provider response is normalized
    Then the canonical response contains the tool-call identifier
    And the canonical response contains the tool name
    And the original tool arguments text is preserved
    And parsed arguments are included when parsing succeeds

  Scenario: Preserve malformed tool arguments
    Given a provider response containing malformed tool arguments
    When the provider response is normalized
    Then the tool arguments text is preserved
    And the parsed arguments are absent
    And the arguments disposition is "invalid-json"
    And a normalization diagnostic is recorded

  Scenario: Normalize observed token usage
    Given a provider response containing token usage testimony
    When the provider response is normalized
    Then the observed token counts are projected
    And the usage disposition is "observed"
    And no estimated values are introduced

  Scenario: Report unavailable token usage
    Given a provider response without token usage testimony
    When the provider response is normalized
    Then the usage disposition is "unavailable"
    And all unavailable token values are null

  Scenario: Preserve a provider refusal
    Given a provider response containing an explicit refusal
    When the provider response is normalized
    Then the refusal is present in the canonical response
    And the canonical disposition is "refused"
    And the provider refusal category is preserved

  Scenario: Preserve a provider safety block
    Given a provider response blocked by a provider safety mechanism
    When the provider response is normalized
    Then the canonical disposition is "safety-blocked"
    And the provider safety signals are preserved
    And the response is not represented as successfully completed

  Scenario: Reject an unsupported provider response
    Given no authorized adapter recognizes the provider response
    When normalization is attempted
    Then the result disposition is "rejected"
    And the failure code is "PROVIDER_RESPONSE_NOT_RECOGNIZED"
    And no canonical response is fabricated

  Scenario: Reject an invalid canonical projection
    Given a provider adapter produces a projection
    And the projection violates the canonical response contract
    When normalization is completed
    Then the result disposition is "rejected"
    And the failure code is "CANONICAL_PROJECTION_INVALID"

  Scenario: Produce byte-stable normalized output
    Given the same provider response
    And the same normalization authority
    When normalization is executed multiple times
    Then the semantic canonical response is identical
    And deterministic fields are byte-stable
```

For timestamps and generated identifiers, the deterministic test should inject a fixed clock and identity source rather than weakening the byte-stability claim.

---

# 15. Example Transformation

## Raw OpenAI-style testimony

```json
{
  "id": "response-123",
  "model": "model-x",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capability is ready."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 75,
    "completion_tokens": 12,
    "total_tokens": 87
  }
}
```

## Canonical response

```json
{
  "provider": {
    "providerId": "openai",
    "providerResponseId": "response-123"
  },
  "model": {
    "providerReportedModel": "model-x"
  },
  "outcome": {
    "disposition": "completed",
    "providerFinishReason": "stop"
  },
  "content": {
    "segments": [
      {
        "index": 0,
        "kind": "text",
        "text": "The capability is ready."
      }
    ],
    "combinedText": "The capability is ready.",
    "structuredOutput": null,
    "toolCalls": []
  },
  "usage": {
    "disposition": "observed",
    "inputTokens": 75,
    "outputTokens": 12,
    "totalTokens": 87
  }
}
```

## Raw Gemini-style testimony

```json
{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [
          {
            "text": "The capability is ready."
          }
        ]
      },
      "finishReason": "STOP"
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 75,
    "candidatesTokenCount": 12,
    "totalTokenCount": 87
  }
}
```

The canonical result should be semantically equivalent to the OpenAI projection while preserving Gemini-specific provenance.

That is the actual value of the capability:

```text
Different provider dialects
          ↓
Same downstream contract
```

---

# 16. Mutation and Adversarial Tests

The capability should prove that it does not merely pass happy-path fixtures.

High-value negative controls:

* Delete the provider finish reason and verify the adapter classifies the response correctly or rejects it.
* Change a usage token field from number to string.
* Reorder provider content blocks and verify canonical ordering follows the source.
* Introduce two matching adapters and require `PROVIDER_ADAPTER_AMBIGUOUS`.
* Return a tool call with malformed arguments.
* Return an empty successful candidate.
* Return safety metadata without content.
* Return multiple candidates when policy allows only one.
* Cause an adapter to fabricate `totalTokens`.
* Cause an adapter to omit the provider identity.
* Cause an adapter to project a noncanonical disposition.
* Modify the raw response after its supplied hash was calculated.

The mutation suite should establish:

```text
The normalizer rejects unsupported testimony.
The normalizer preserves inconvenient testimony.
The normalizer never silently converts uncertainty into success.
```

---

# 17. Minimum Useful v0.1

To keep this micro-app small, I would build only this first slice:

```text
v0.1
├── canonical response schema
├── normalization policy
├── provider adapter contract
├── OpenAI adapter
├── Gemini adapter
├── text-content projection
├── finish-disposition projection
├── basic token-usage projection
├── refusal/safety preservation
├── deterministic diagnostics
└── Gherkin acceptance suite
```

Then grow it deliberately:

```text
v0.2  Tool-call normalization
v0.3  Structured-output projection
v0.4  Anthropic adapter
v0.5  LiteLLM and llama.cpp adapters
v0.6  Streaming-event normalization
v0.7  Multimodal content segments
v1.0  Stable canonical response contract
```

---

# 18. The Execution Slice

```text
Raw provider response
        │
        ▼
validatesNormalizationRequest
        │
        ▼
resolvesProviderResponseAdapter
        │
        ▼
adapter.recognizes
        │
        ├── no ──▶ reject with testimony
        │
        ▼
adapter.projectsCanonicalResponse
        │
        ▼
validatesCanonicalResponseProjection
        │
        ├── invalid ──▶ reject with diagnostics
        │
        ▼
attachesNormalizationProvenance
        │
        ▼
Canonical model response
```

And its relationship to the rest of Season 1 is clean:

```text
Prompt Builder
      ↓
Generic LLM Connector
      ↓
Response Normalizer       ← this capability
      ↓
JSON Output Validator
      ↓
Retry Policy Executor
      ↓
Execution Receipt Generator
```

The first-season architecture already identifies this capability as the provider-neutral result boundary that feeds validation, usage reporting, retry handling, and proof. 

# Final Mental Model

```text
The connector crosses the provider boundary.

The normalizer collapses provider dialects.

The validator governs the requested output.

The receipt preserves what happened.
```

So the Response Normalizer is not a formatting utility. It is the **semantic anti-corruption layer between nondeterministic provider testimony and the deterministic capability ecosystem**.
