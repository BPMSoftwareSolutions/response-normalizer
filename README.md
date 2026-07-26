# Response Normalizer

> Accept raw provider testimony and project it into one canonical response
> without inventing, repairing, or discarding material facts.

This project follows the Deterministic Micro-Capability Engineering Standard
(DMES-001). Canonical intent and semantic authority are the source of truth.
Language-specific code bodies contain execution mechanics only.

The normalizer sits between the connector and everything that consumes a model
result:

```text
Generic LLM Connector
        │  raw provider testimony
        ▼
Response Normalizer          ← this capability
        │  canonical model response
        ├────────▶ JSON Output Validator
        ├────────▶ Token Usage Reporter
        ├────────▶ Retry Policy Executor
        └────────▶ Execution Receipt Generator
```

It is not a formatting utility. It is the semantic anti-corruption layer
between nondeterministic provider testimony and the deterministic capability
ecosystem.

---

## The governing rule

```text
Normalize shape  ≠  Repair meaning
```

Every design decision falls out of that line. The normalizer maps
`"stop"`, `"STOP"`, and `"end_turn"` onto one canonical `completed`
disposition — and keeps the provider's original word next to it:

```json
{
  "disposition": "completed",
  "providerFinishReason": "STOP"
}
```

Downstream capabilities get portability. Nobody loses evidence.

---

## Authority is JSON, code is a projection

No provider knowledge lives in TypeScript. A provider is described by a
**dialect document**, and one generic projector executes it:

```text
authority/
├── response-normalizer.sej.v1.json          capability journal
├── canonical-model-response.schema.json     the output contract
├── normalization-policy.schema.json         declared behaviour, closed
├── default-normalization-policy.json        the default policy instance
├── provider-dialect.schema.v1.json          how a dialect may be declared
├── finish-disposition.decision.v1.json      the disposition decision table
└── dialects/
    ├── openai.dialect.v1.json
    ├── gemini.dialect.v1.json
    └── anthropic.dialect.v1.json
```

Adding a provider is an authoring act, not a coding act: drop a dialect
document into `authority/dialects/` and it becomes an available adapter.

A conformance test asserts this stays true — the shared projector may not
contain a provider name or a provider field name in any string literal.

### The decision table, not an `if` chain

The finish-reason mapping is declared, so it can be read and audited without
opening a code file:

```json
{
  "ruleId": "length-limited",
  "when": { "providerFinishReason": ["length", "max_tokens", "MAX_TOKENS"] },
  "then": "length-limited"
}
```

Rules are ordered, first match wins, and the table ends with a catch-all that
resolves to `unknown` plus a diagnostic — so no testimony is ever silently
dropped.

---

## What it refuses to do

The policy schema is **closed**. A policy carrying a setting like
`repairMalformedJson` is rejected with `NORMALIZATION_POLICY_UNSUPPORTED`
before any provider testimony is read. Estimation is likewise refused:
`allowEstimatedUsage` may only be `false`, because estimating belongs to the
Token Usage Reporter.

Concretely, the normalizer will not:

| Situation | What it does instead |
|---|---|
| Tool arguments are malformed JSON | Preserves the text, reports `invalid-json`, records a diagnostic |
| The provider sent no usage | Reports `unavailable` with null counts — never zeroes |
| A token count arrives as `"75"` | Refuses to coerce it, reports it as uninterpretable |
| No adapter recognizes the response | Rejects; fabricates nothing |
| Two adapters both claim it | Rejects as `PROVIDER_ADAPTER_AMBIGUOUS` rather than guessing |
| The raw response no longer matches its hash | Rejects as `RAW_RESPONSE_HASH_MISMATCH` |
| A segment kind isn't modelled yet | Preserves it verbatim with a diagnostic |

---

## Usage

```ts
import {
  normalizesProviderResponse,
  readsDeclaredAdapters,
  readsDefaultNormalizationPolicy,
  sha256Hashes,
  systemClock,
  randomIdentity,
} from "response-normalizer";

const rawResponse = await callProvider();

const result = normalizesProviderResponse(
  {
    correlationId: "request-01J...",
    providerAuthority: { providerId: "openai", adapterId: "" },
    requestedModel: "instruction-capable-model",
    resolvedModel: "resolved-provider-model",
    rawResponse,
    rawResponseHash: sha256Hashes.hashes(rawResponse),
    normalizationPolicy: readsDefaultNormalizationPolicy(),
  },
  {
    adapters: readsDeclaredAdapters(),
    clock: systemClock,
    hashes: sha256Hashes,
    identity: randomIdentity,
  }
);

if (result.disposition === "rejected") {
  // result.failure.code is a stable, machine-readable classification.
  return;
}

result.response.content.combinedText;
result.response.outcome.disposition;
result.response.usage.disposition;
```

The context is one sealed immutable edge — no positional argument list, no DTO
stitching at the call site.

---

## Execution slice

```text
validatesNormalizationRequest
        ▼
resolvesProviderResponseAdapter
        ▼
adapter.recognizes ──── no ──▶ reject with testimony
        ▼
verify raw response hash ── mismatch ──▶ reject
        ▼
adapter.projectsCanonicalResponse
        ▼
validatesCanonicalResponseProjection ── invalid ──▶ reject with diagnostics
        ▼
attach provenance
        ▼
Canonical model response
```

The adapter never builds provenance or identity; the orchestrator never learns
a provider field name.

---

## Proof

```bash
npm install
npm run typecheck
npm test
```

Three suites, 55 tests:

- **`tests/acceptance/`** — one describe block per scenario in
  `acceptance/normalizes-provider-response.feature`, in order. A conformance
  test fails the build if a declared scenario has no implementation.
- **`tests/conformance/`** — the authority documents validate against their own
  schemas, every decision outcome is in the canonical vocabulary, the policy
  schema declares no rewriting setting, and the projector carries no provider
  knowledge.
- **`tests/mutation/`** — the adversarial catalogue. Deleted finish reasons,
  stringified token counts, reordered blocks, ambiguous adapters, empty
  candidates, safety metadata without content, fabricated totals, omitted
  provider identity, noncanonical dispositions, and tampered raw responses.

The mutation suite is the real proof, establishing three claims:

```text
The normalizer rejects unsupported testimony.
The normalizer preserves inconvenient testimony.
The normalizer never silently converts uncertainty into success.
```

Determinism is proven rather than asserted: tests inject a fixed clock and a
sequential identity source, then compare canonical JSON byte-for-byte.

---

## Scope

Built in this version: the canonical response contract, normalization policy,
the dialect contract, OpenAI / Gemini / Anthropic dialects, content segments,
tool calls, structured-output extraction, finish dispositions, usage,
refusal and safety preservation, diagnostics, and the acceptance suite.

Deliberately deferred: LiteLLM and llama.cpp dialects, streaming-event
normalization, and multimodal segment modelling — image and audio blocks are
recognized and preserved verbatim today, but not yet interpreted.
