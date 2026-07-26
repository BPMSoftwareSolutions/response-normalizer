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

## The four-layer discipline

Meaning expands in the semantic layer. Execution collapses in the code layer.

```text
Semantic authority   = what the system means
Kernel               = how declarations are mechanically interpreted
Adapter              = how external effects physically occur
Capability body      = the linear execution witness
```

None of the three code categories carries domain decisionality:

| Category | Directory | May branch? | Knows a provider? |
|---|---|---|---|
| **Kernel** | `src/kernel/` | yes — it is generic machinery | never |
| **Adapter** | `src/adapters/` | yes — platform mechanics | never |
| **Capability body** | `src/normalize-provider-response/`, `src/project-provider-response/` | **no** | never |

`npm run test:discipline` enforces this. A capability body containing an `if`,
`for`, `switch`, or `while` fails the build, as does any layer that names a
provider or a provider field in a string literal.

## Authority is JSON, code is a projection

```text
authority/
├── response-normalizer.sej.v1.json       capability journal
├── canonical-model-response.schema.json  the output contract
├── normalization-policy.schema.json      declared behaviour, closed
├── provider-dialect.schema.v1.json       how a dialect may be declared
├── decision.schema.v1.json               how a decision may be declared
├── code-body.conformance.v1.json         the four-layer build gate
├── decisions/                            every branch that carries meaning
│   ├── resolve-finish-disposition
│   ├── resolve-usage-disposition
│   ├── resolve-arguments-disposition
│   ├── resolve-structured-output-disposition
│   ├── resolve-adapter-resolution
│   ├── resolve-normalization-failure
│   └── classify-content-segment
├── dialects/                             one per provider
│   ├── openai.dialect.v1.json
│   ├── gemini.dialect.v1.json
│   └── anthropic.dialect.v1.json
├── iterations/                           declared iteration authority
├── execution-model/                      the ordered operation plan
└── projections/
```

Adding a provider is an authoring act, not a coding act: drop a dialect
document into `authority/dialects/` and it becomes an available adapter.

### Decision tables, not `if` chains

Every branch that carries meaning is declared, so it can be read and audited
without opening a code file:

```json
{
  "ruleId": "length-limited",
  "when": { "providerFinishReason": ["length", "max_tokens", "MAX_TOKENS"] },
  "then": "length-limited"
}
```

Rules are ordered, first match wins, and tables consulted with open-ended
testimony end with a catch-all — so nothing is ever silently dropped. A
conformance test proves each terminal rule exists and that every outcome lands
in the canonical vocabulary.

The kernel that evaluates these tables knows how to compare a value and
dispatch a rule. It does not know that `STOP` means completed.

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

Four suites, 90 tests:

- **`tests/acceptance/`** — one describe block per scenario in
  `acceptance/normalizes-provider-response.feature`, in order. A conformance
  test fails the build if a declared scenario has no implementation.
- **`tests/conformance/`** — the authority documents validate against their own
  schemas, every decision outcome is in the canonical vocabulary, every
  open-ended table declares a terminal rule, the policy schema declares no
  rewriting setting, and the projector carries no provider knowledge.
- **`tests/conformance/enforces-four-layer-discipline`** — the build gate. No
  capability body contains authored control flow, no layer names a provider or
  provider field, no body names a canonical disposition, and the kernel neither
  references this capability's vocabulary nor imports from it.
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
