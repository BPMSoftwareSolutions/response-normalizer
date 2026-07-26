Exactly. **That discipline is not optional decoration around the micro-capabilities—it is the defining engineering constraint.**

The micro-capability is not merely “small code.” It is:

> **Small canonical meaning, resolved into executable authority, projected into a collapsed linear body, and verified through proof.**

The semantic layer owns the intelligence. The code body owns only mechanical execution. That is the central rule of the engineering standard. 

# The Correct Architectural Shape

```text
Intent
  │
  ▼
Scenario
  │
  ▼
Semantic authority
  │
  ├── decisions
  ├── policies
  ├── DTO projections
  ├── iteration authority
  ├── state transitions
  ├── failure dispositions
  ├── ports
  ├── effects
  └── proof requirements
  │
  ▼
Resolved execution authority
  │
  ├── immutable context
  ├── ordered operations
  ├── resolved DTOs
  ├── authorized effects
  └── resolved continuation
  │
  ▼
Collapsed code body
  │
  ├── observe
  ├── invoke
  ├── project
  └── return
  │
  ▼
Proof
```

The code body is therefore not where the application “figures things out.”

It is where already-resolved meaning becomes physical execution.

---

# What “Collapsed Code Body” Means

A collapsed body should read almost like an execution transcript.

```typescript
export async function normalizesProviderResponse(
  context: NormalizeProviderResponseContext
): Promise<CanonicalModelResponse> {
  const projection = await edges.invokes(
    "resolve-provider-response-projection",
    context
  );

  const normalizedResponse = await edges.invokes(
    "execute-resolved-response-projection",
    projection
  );

  return edges.projects(
    "project-canonical-model-response",
    normalizedResponse
  );
}
```

That body contains:

```text
Resolve
Execute
Project
Return
```

It does not contain:

```text
Inspect provider name
Choose adapter
Interpret finish reason
Construct usage DTO
Parse tool arguments conditionally
Choose refusal disposition
Select fallback
Decide whether malformed JSON is acceptable
```

All of that is semantic authority.

---

# The Four-Layer Discipline

## 1. Semantic Authority Owns Decisionality

Every meaningful decision must be visible in the semantic layer.

For the Response Normalizer, decisions include:

```text
Which provider adapter applies?

What canonical disposition corresponds
to the provider finish reason?

Is the response completed, refused,
blocked, truncated, or malformed?

Should text be interpreted as structured output?

How are multiple candidates handled?

What happens when token usage is absent?

What happens when tool arguments are invalid JSON?

What happens when two adapters recognize the same response?
```

These should appear in decision catalogs or tables.

```json
{
  "decisionId": "resolve-canonical-finish-disposition",
  "inputs": [
    "providerId",
    "providerFinishReason",
    "refusal.present",
    "safety.blocked",
    "toolCalls.present"
  ],
  "rules": [
    {
      "when": {
        "refusal.present": true
      },
      "then": "refused"
    },
    {
      "when": {
        "safety.blocked": true
      },
      "then": "safety-blocked"
    },
    {
      "when": {
        "providerFinishReason": {
          "in": ["stop", "STOP", "end_turn"]
        }
      },
      "then": "completed"
    },
    {
      "when": {
        "providerFinishReason": {
          "in": ["length", "MAX_TOKENS", "max_tokens"]
        }
      },
      "then": "length-limited"
    },
    {
      "when": {
        "toolCalls.present": true
      },
      "then": "tool-calls-requested"
    },
    {
      "when": {
        "*": true
      },
      "then": "unknown"
    }
  ]
}
```

The code body invokes that authority:

```typescript
const disposition = await edges.invokes(
  "resolve-canonical-finish-disposition",
  context
);
```

It does not reproduce the rules.

The standard explicitly requires decisions to be authored semantically rather than hidden in `if` statements. 

---

## 2. Semantic Projections Own DTO Mechanics

This is equally important.

We do not want code bodies doing this:

```typescript
const response = {
  provider: {
    providerId: context.provider.id,
    adapterId: adapter.id,
    providerResponseId: raw.id ?? null
  },
  model: {
    requestedModel: context.requestedModel,
    resolvedModel: context.resolvedModel,
    providerReportedModel: raw.model ?? null
  },
  usage: {
    inputTokens: raw.usage?.prompt_tokens ?? null,
    outputTokens: raw.usage?.completion_tokens ?? null,
    totalTokens: raw.usage?.total_tokens ?? null
  }
};
```

That is authored DTO stitching.

It creates several problems:

* Meaning is buried in TypeScript.
* The mapping cannot be inspected independently.
* Another language must reimplement it.
* Field drift becomes likely.
* Tests validate implementation mechanics rather than canonical authority.
* The LLM may reconstruct the mapping differently every time.

Instead, declare the projection:

```json
{
  "projectionId": "project-openai-response-to-canonical-model-response",
  "from": "openai-provider-response",
  "to": "canonical-model-response",
  "fields": {
    "provider.providerId": {
      "value": "openai"
    },
    "provider.providerResponseId": "$.id",
    "model.providerReportedModel": "$.model",
    "usage.inputTokens": "$.usage.prompt_tokens",
    "usage.outputTokens": "$.usage.completion_tokens",
    "usage.totalTokens": "$.usage.total_tokens",
    "outcome.providerFinishReason": "$.choices[0].finish_reason"
  }
}
```

Then the body becomes:

```typescript
const canonicalResponse = edges.projects(
  "project-openai-response-to-canonical-model-response",
  context
);
```

That exact separation—semantic projection versus authored DTO stitching—is required by the standard. 

---

## 3. Semantic Execution Models Own Control Flow

“No loops” does not mean iteration disappears from the system.

It means **the code body does not author the meaning of iteration**.

Suppose the provider returns multiple content segments.

Do not write:

```typescript
const segments = [];

for (const part of response.parts) {
  if (part.text) {
    segments.push({
      kind: "text",
      text: part.text
    });
  }

  if (part.functionCall) {
    segments.push({
      kind: "tool-call",
      toolCall: mapFunctionCall(part.functionCall)
    });
  }
}
```

That body contains:

* Iteration policy
* Segment classification
* Filtering
* Ordering
* DTO shaping
* Dispatch
* Aggregation

Instead, declare iteration authority:

```json
{
  "iterationId": "project-provider-content-segments",
  "collection": "$.providerResponse.contentParts",
  "order": "provider-declared-order",
  "forEach": {
    "resolve": "resolve-provider-content-segment-kind",
    "invoke": "project-resolved-content-segment"
  },
  "collect": {
    "projection": "collect-canonical-content-segments"
  },
  "unsupportedItemDisposition": "preserve-with-diagnostic"
}
```

Then the body is:

```typescript
const segments = await edges.invokes(
  "project-provider-content-segments",
  context
);
```

The loop may exist inside the generic resolver runtime or iteration engine, but it is **catalog-driven machinery**, not authored capability decisionality.

That is the distinction:

```text
Forbidden:
Capability body authors a loop and decides what it means.

Allowed:
Generic runtime executes semantically declared iteration authority.
```

The standard describes loops as semantic iteration authority and delegates ordering, filtering, stopping, and aggregation to that declaration. 

---

## 4. Adapters Own Only Irreducible Mechanics

There will still be language and platform mechanics.

For example:

```typescript
export async function invokesProviderAdapter(
  request: ProviderInvocationRequest
): Promise<unknown> {
  return providerClient.responses.create(request);
}
```

Or:

```typescript
export async function parsesJsonText(
  request: ParseJsonTextRequest
): Promise<unknown> {
  return JSON.parse(request.text);
}
```

These are mechanical adapter bodies.

They may call:

* `fetch`
* SDK methods
* `JSON.parse`
* File system APIs
* Hash libraries
* Database drivers
* Serialization APIs

But they must not decide:

* Whether JSON parsing is authorized
* Whether an invalid JSON result is repairable
* Whether another provider should be attempted
* Whether an absent field should be defaulted
* Whether a refusal counts as success
* Whether an operation should retry

That meaning remains above the adapter.

```text
Semantic layer:
“Parse this field as JSON under this declared policy.”

Adapter:
Calls JSON.parse and returns observed success or failure.
```

---

# The Response Normalizer Reframed Correctly

The earlier response-normalizer design can be tightened further.

Instead of thinking of it as several authored TypeScript components:

```text
Response Normalizer
├── adapter resolver
├── finish reason mapper
├── content mapper
├── usage mapper
├── tool call mapper
└── response builder
```

The stronger architecture is:

```text
Response Normalizer Semantic Authority
├── provider-recognition catalog
├── finish-disposition decision catalog
├── content-segment classification catalog
├── canonical projection catalog
├── usage projection catalog
├── refusal projection catalog
├── safety projection catalog
├── iteration authority
├── failure classification catalog
└── proof contract

Generic Semantic Runtime
├── resolves decisions
├── executes iteration
├── executes projections
├── invokes ports
└── records testimony

Collapsed Response Normalizer Body
├── resolve
├── execute
├── project
└── return
```

So the application repository may contain many semantic declarations, but extremely little authored execution code.

---

# A Better Collapsed Body

Here is how I would now shape the primary operation:

```typescript
export async function normalizesProviderResponse(
  context: NormalizeProviderResponseContext
): Promise<NormalizeProviderResponseResult> {
  const authority = await edges.invokes(
    "resolve-provider-response-normalization-authority",
    context
  );

  const execution = await edges.invokes(
    "execute-resolved-provider-response-normalization",
    authority
  );

  return edges.projects(
    "project-provider-response-normalization-result",
    execution
  );
}
```

That is the body.

Potentially three operations.

No `if`.

No `switch`.

No loop.

No object stitching.

No provider-specific imports.

No fallback.

No retry.

No business exception interpretation.

---

# What the Resolved Authority Looks Like

The resolver should produce a complete executable plan before the code body performs normalization.

```json
{
  "authorityType": "resolved-provider-response-normalization.v1",
  "normalizationId": "normalize-response-01J...",
  "providerId": "gemini",
  "adapterId": "gemini-generate-content-response-adapter",
  "operations": [
    {
      "sequence": 1,
      "operation": "project-provider-identity",
      "projectionId": "project-gemini-provider-identity"
    },
    {
      "sequence": 2,
      "operation": "project-model-identity",
      "projectionId": "project-gemini-model-identity"
    },
    {
      "sequence": 3,
      "operation": "project-content-segments",
      "iterationId": "project-gemini-content-parts"
    },
    {
      "sequence": 4,
      "operation": "resolve-finish-disposition",
      "decisionId": "resolve-gemini-finish-disposition"
    },
    {
      "sequence": 5,
      "operation": "project-usage",
      "projectionId": "project-gemini-token-usage"
    },
    {
      "sequence": 6,
      "operation": "project-safety-signals",
      "projectionId": "project-gemini-safety-signals"
    },
    {
      "sequence": 7,
      "operation": "validate-canonical-contract",
      "contractId": "canonical-model-response.v1"
    }
  ],
  "failurePolicyId": "provider-response-normalization-failure-policy",
  "proofContractId": "provider-response-normalization-proof.v1"
}
```

By the time execution receives this, nothing remains to interpret.

```text
Execution does not ask:

“What kind of provider is this?”
“What should STOP mean?”
“How should usage be mapped?”
“What should happen with unsupported content?”

Execution receives the answers.
```

---

# Where Does `if` Actually Go?

This is an important nuance.

The machine ultimately performs conditional operations somewhere. CPUs branch. Interpreters evaluate predicates. Resolver engines select matching rules.

So the doctrine is not that conditionality ceases to exist physically.

The doctrine is:

> **Capability-specific conditional meaning must not be authored inside the language code body.**

The generic semantic resolver may internally implement logic like:

```typescript
for (const rule of decision.rules) {
  if (predicateEvaluator.matches(rule.when, context)) {
    return rule.then;
  }
}
```

But that implementation belongs to the **generic semantic execution kernel**, not to the Response Normalizer.

That kernel contains no provider-specific or product-specific meaning.

```text
Generic kernel knows:

- how to evaluate equality
- how to dispatch a decision
- how to iterate a declared collection
- how to apply a projection
- how to invoke a port

Generic kernel does not know:

- that STOP means completed
- that tool_calls means tool-calls-requested
- that Gemini safety blocks are rejections
- that OpenAI prompt_tokens map to inputTokens
```

That is the separation that preserves deterministic semantics.

---

# The Three Kinds of Code

The repository ecosystem should recognize three code categories.

| Code category       | Allowed content                                           | Domain decisionality |
| ------------------- | --------------------------------------------------------- | -------------------: |
| **Kernel**          | Generic resolver, projector, iterator, predicate dispatch |                 None |
| **Adapter**         | SDK, file system, network, parser, database mechanics     |                 None |
| **Capability body** | Ordered semantic edge invocations                         |                 None |

The semantic layer contains the domain intelligence.

```text
Semantic authority
    = what the system means

Kernel
    = how declarations are mechanically interpreted

Adapter
    = how external effects physically occur

Capability body
    = the linear execution witness
```

---

# What About Error Handling?

Same rule.

Avoid:

```typescript
try {
  return await adapter.normalize(response);
} catch (error) {
  if (error instanceof SyntaxError) {
    return {
      disposition: "invalid-json"
    };
  }

  if (error instanceof UnsupportedResponseError) {
    return {
      disposition: "unsupported"
    };
  }

  throw error;
}
```

Prefer a mechanical boundary:

```typescript
export async function observesNormalizationAttempt(
  context: NormalizationAttemptContext
): Promise<ObservedNormalizationAttempt> {
  try {
    return await ports.executesNormalizationOperation(context.request);
  } catch (error) {
    return edges.projects(
      "project-observed-normalization-failure",
      { context, error }
    );
  }
}
```

Then semantic authority classifies the observed failure:

```typescript
const disposition = await edges.invokes(
  "resolve-normalization-failure-disposition",
  observedFailure
);
```

The catch observes.

The semantic layer decides.

This is also the standard’s explicit treatment of try/catch and failure policy. 

---

# What About Multiple Providers?

We should not produce files like:

```text
projects-openai-response.ts
projects-gemini-response.ts
projects-anthropic-response.ts
```

if each contains hand-authored mappings and decisions.

Instead, provider support should mostly be semantic packs:

```text
semantic-authority/
├── providers/
│   ├── openai/
│   │   ├── recognizes-openai-response.sej.v1.json
│   │   ├── resolves-openai-finish-disposition.sej.v1.json
│   │   ├── projects-openai-content.sej.v1.json
│   │   └── projects-openai-usage.sej.v1.json
│   │
│   ├── gemini/
│   │   ├── recognizes-gemini-response.sej.v1.json
│   │   ├── resolves-gemini-finish-disposition.sej.v1.json
│   │   ├── projects-gemini-content.sej.v1.json
│   │   └── projects-gemini-usage.sej.v1.json
│   │
│   └── anthropic/
│       ├── recognizes-anthropic-response.sej.v1.json
│       ├── resolves-anthropic-finish-disposition.sej.v1.json
│       ├── projects-anthropic-content.sej.v1.json
│       └── projects-anthropic-usage.sej.v1.json
```

The adapter body for each provider may become almost nonexistent unless the provider response needs an unavoidable platform-specific extraction mechanism.

In many cases, a generic JSON semantic projector can normalize all providers without provider-authored TypeScript at all.

That is where the architecture becomes very powerful:

```text
Add provider support
        ≠
Write another implementation

Add provider support
        =
Register another semantic authority pack
```

---

# Scenario Responsibility Shape

Each scenario should still have one responsibility and one collapsed body.

For example:

```text
Scenario:
Normalize a completed text response

Responsibilities:
├── resolves-completed-response-normalization-authority
├── executes-resolved-completed-response-normalization
└── projects-completed-response-normalization-receipt
```

Bodies:

```typescript
export async function resolvesCompletedResponseNormalizationAuthority(
  context: CompletedResponseNormalizationContext
) {
  return edges.invokes(
    "resolve-completed-response-normalization-authority",
    context
  );
}
```

```typescript
export async function executesResolvedCompletedResponseNormalization(
  context: ResolvedCompletedResponseNormalizationContext
) {
  return edges.invokes(
    "execute-resolved-completed-response-normalization",
    context
  );
}
```

```typescript
export function projectsCompletedResponseNormalizationReceipt(
  context: CompletedResponseNormalizationExecution
) {
  return edges.projects(
    "project-completed-response-normalization-receipt",
    context
  );
}
```

Whether we collapse these into one public operation or retain individual responsibility files depends on the scenario/body contract, but none of them should reintroduce decisionality.

The standard’s preferred relationship is one scenario, one responsibility, one body. 

---

# Enforcement Must Be Automated

This cannot remain a style preference. The conveyor should reject violations.

## Code-body conformance checks

For capability bodies, prohibit:

```text
if
else
switch
case
for
forEach
while
do
ternary expressions
logical fallback with ||
null fallback with ??
object literals used for DTO construction
array mutation
push
provider-specific imports
direct SDK calls
direct file-system calls
direct JSON-path field mapping
business exception classification
```

Some syntax may be allowed in kernels and adapters, but not in collapsed capability bodies.

## Required body shape

A body should conform to something like:

```text
Function
├── accepts one immutable context
├── invokes declared semantic edge
├── optionally invokes additional ordered edge
├── projects declared result
└── returns
```

Example AST rule:

```json
{
  "ruleId": "capability-body-must-be-linear",
  "appliesTo": {
    "bodyKind": "scenario-responsibility"
  },
  "forbiddenSyntax": [
    "IfStatement",
    "SwitchStatement",
    "ForStatement",
    "ForOfStatement",
    "ForInStatement",
    "WhileStatement",
    "DoWhileStatement",
    "ConditionalExpression"
  ],
  "forbiddenOperations": [
    "dto-object-construction",
    "business-exception-classification",
    "provider-selection",
    "retry-selection"
  ],
  "requiredInvocations": [
    "edges.invokes",
    "edges.projects"
  ]
}
```

---

# The Architectural Litmus Test

For every line inside a code body, ask:

```text
Does this line express meaning?

If yes:
    It belongs in semantic authority.

Does this line construct a domain DTO?

If yes:
    It belongs in a semantic projection.

Does this line select among outcomes?

If yes:
    It belongs in a semantic decision.

Does this line control repetition?

If yes:
    It belongs in semantic iteration authority.

Does this line classify failure?

If yes:
    It belongs in semantic failure policy.

Does this line call a platform API?

If yes:
    It belongs behind a port adapter.

Does this line merely invoke resolved authority?

If yes:
    It belongs in the collapsed body.
```

---

# Response Normalizer Under the Discipline

The final architecture is not:

```text
Response Normalizer
    = a pile of provider mapping code
```

It is:

```text
Response Normalizer
    =
Canonical intent
+
Gherkin scenarios
+
Provider semantic packs
+
Decision catalogs
+
Projection catalogs
+
Iteration declarations
+
Failure policy
+
Proof contract
+
Three-line execution body
```

That matches the broader foundry architecture: semantic authority authorizes execution, while the capability runtime performs deterministic mechanics and proof establishes what happened. 

# North Star

```text
Meaning expands in the semantic layer.

Execution collapses in the code layer.
```

Or even more directly:

> **The semantic layer should be rich enough that the code body has nothing left to decide.**

That is how these micro-capabilities stay portable, inspectable, reprojectable, composable, and deterministic. The objective is not merely fewer lines of code. It is **zero independently authored meaning below the projection boundary**.
