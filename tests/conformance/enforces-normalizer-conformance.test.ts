import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  readsAllDeclaredDecisions,
  readsCanonicalResponseSchema,
  readsDeclaredDecision,
  readsDecisionSchema,
  readsDefaultNormalizationPolicy,
  readsNormalizationPolicySchema,
} from "../../src/adapters/reads-authority-documents.js";
import { validatesAgainstSchema } from "../../src/kernel/validates-against-schema.js";
import { normalizesProviderResponse } from "../../src/normalize-provider-response/normalizes-provider-response.js";
import {
  readsDeclaredAdapters,
  readsDeclaredDialects,
} from "../../src/project-provider-response/creates-declared-adapter.js";
import {
  RESPONSE_DISPOSITIONS,
  FAILURE_EXIT_CODES,
  NORMALIZATION_FAILURE_CODES,
} from "../../src/shared/response-normalizer-contract.js";
import { canonicalJson } from "../../src/adapters/runtime-ports.js";
import {
  buildsContext,
  buildsDependencies,
  buildsGeminiResponse,
  buildsOpenaiResponse,
} from "../acceptance/builds-normalizer-fixtures.js";

/**
 * Conformance proves the capability obeys its own declared authority: the JSON
 * under authority/ governs the code, the code does not quietly diverge from it,
 * and every acceptance scenario has a home in the test suite.
 */

const AUTHORITY_ROOT = new URL("../../authority/", import.meta.url);

function readsAuthorityJson(fileName: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(fileName, AUTHORITY_ROOT)), "utf8")
  ) as Record<string, unknown>;
}

describe("Conformance: the declared authority is internally valid", () => {
  it("validates the default policy against the policy schema", () => {
    const violations = validatesAgainstSchema(
      readsDefaultNormalizationPolicy(),
      readsNormalizationPolicySchema()
    );

    assert.deepEqual(violations, []);
  });

  it("validates every dialect against the dialect schema", () => {
    const dialectSchema = readsAuthorityJson("provider-dialect.schema.v1.json");

    for (const dialect of readsDeclaredDialects()) {
      const violations = validatesAgainstSchema(dialect, dialectSchema);

      assert.deepEqual(
        violations,
        [],
        `Dialect "${dialect.dialectId}" violates the dialect contract: ${JSON.stringify(violations)}`
      );
    }
  });

  it("validates every declared decision against the decision schema", () => {
    const decisions = readsAllDeclaredDecisions();

    assert.ok(decisions.length >= 6);

    for (const decision of decisions) {
      const violations = validatesAgainstSchema(decision, readsDecisionSchema());

      assert.deepEqual(
        violations,
        [],
        `Decision "${decision.decisionId}" violates the decision contract: ${JSON.stringify(violations)}`
      );
    }
  });

  it("declares a terminal catch-all rule so no testimony goes unclassified", () => {
    // Every decision consulted with open-ended testimony must resolve to
    // something rather than falling through unmatched.
    for (const decisionId of [
      "resolve-finish-disposition",
      "resolve-usage-disposition",
      "resolve-normalization-failure",
    ]) {
      const { rules } = readsDeclaredDecision(decisionId);
      const terminal = rules[rules.length - 1];

      assert.ok(
        Object.values(terminal?.when ?? {}).includes("*"),
        `Decision "${decisionId}" declares no terminal catch-all rule.`
      );
    }
  });

  it("resolves every finish-disposition outcome to the canonical vocabulary", () => {
    for (const rule of readsDeclaredDecision("resolve-finish-disposition").rules) {
      assert.ok(
        RESPONSE_DISPOSITIONS.includes(rule.then as never),
        `Rule "${rule.ruleId}" resolves to a noncanonical disposition.`
      );
    }
  });

  it("resolves every failure outcome to the stable failure vocabulary", () => {
    for (const rule of readsDeclaredDecision("resolve-normalization-failure").rules) {
      assert.ok(
        NORMALIZATION_FAILURE_CODES.includes(rule.then as never),
        `Rule "${rule.ruleId}" resolves to an unrecognized failure code.`
      );
    }
  });

  it("declares no policy setting that would authorize semantic rewriting", () => {
    const serialized = canonicalJson(readsNormalizationPolicySchema());

    for (const forbidden of ["repair", "correct", "fix", "rewrite", "estimate"]) {
      assert.ok(
        !new RegExp(`"${forbidden}[A-Za-z]*"\\s*:`, "i").test(serialized),
        `The policy schema must not declare a "${forbidden}" setting.`
      );
    }
  });
});

describe("Conformance: adapters are declared rather than coded", () => {
  it("derives one adapter from each declared dialect", () => {
    const dialects = readsDeclaredDialects();
    const adapters = readsDeclaredAdapters();

    assert.equal(adapters.length, dialects.length);
    assert.ok(adapters.length >= 3);
  });

  it("declares a unique adapter identity per provider", () => {
    const adapters = readsDeclaredAdapters();

    const providerIds = adapters.map((adapter) => adapter.providerId);
    const adapterIds = adapters.map((adapter) => adapter.adapterId);

    assert.equal(new Set(providerIds).size, providerIds.length);
    assert.equal(new Set(adapterIds).size, adapterIds.length);
  });

  it("recognizes only its own dialect", () => {
    const adapters = readsDeclaredAdapters();
    const openaiResponse = buildsOpenaiResponse();
    const geminiResponse = buildsGeminiResponse();

    const openai = adapters.find((adapter) => adapter.providerId === "openai");
    const gemini = adapters.find((adapter) => adapter.providerId === "gemini");
    const anthropic = adapters.find(
      (adapter) => adapter.providerId === "anthropic"
    );

    assert.ok(openai && gemini && anthropic);

    assert.equal(openai.recognizes(openaiResponse).recognized, true);
    assert.equal(openai.recognizes(geminiResponse).recognized, false);

    assert.equal(gemini.recognizes(geminiResponse).recognized, true);
    assert.equal(gemini.recognizes(openaiResponse).recognized, false);

    assert.equal(anthropic.recognizes(openaiResponse).recognized, false);
    assert.equal(anthropic.recognizes(geminiResponse).recognized, false);
  });

  it("carries no provider name in the shared projector", () => {
    const projector = readFileSync(
      fileURLToPath(
        new URL(
          "../../src/project-provider-response/projects-declared-dialect.ts",
          import.meta.url
        )
      ),
      "utf8"
    );

    // Provider knowledge belongs in the dialect documents, not the projector.
    for (const providerName of ["openai", "gemini", "anthropic", "claude"]) {
      assert.ok(
        !new RegExp(providerName, "i").test(projector),
        `The shared projector must not mention "${providerName}".`
      );
    }
  });

  it("carries no provider field name in the shared projector", () => {
    const projector = readFileSync(
      fileURLToPath(
        new URL(
          "../../src/project-provider-response/projects-declared-dialect.ts",
          import.meta.url
        )
      ),
      "utf8"
    );

    // Canonical concept names such as "candidates" and "finishReasonSources"
    // are expected here; only a bare provider field name is a leak. String
    // literals are the giveaway, since reading a provider field requires one.
    const stringLiterals = [
      ...projector.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g),
    ].map((match) => match[1] ?? match[2] ?? "");

    for (const fieldName of [
      "prompt_tokens",
      "completion_tokens",
      "usageMetadata",
      "finish_reason",
      "finishReason",
      "stop_reason",
      "tool_calls",
      "functionCall",
      "promptFeedback",
      "safetyRatings",
      "content_filter_results",
      "blockReason",
      "candidates",
    ]) {
      assert.ok(
        !stringLiterals.some((literal) => literal.includes(fieldName)),
        `The shared projector must not reference the provider field "${fieldName}".`
      );
    }
  });
});

describe("Conformance: every normalized response satisfies the canonical contract", () => {
  it("validates each provider projection against the response schema", () => {
    const cases = [
      ["openai", buildsOpenaiResponse()],
      ["gemini", buildsGeminiResponse()],
    ] as const;

    for (const [providerId, raw] of cases) {
      const result = normalizesProviderResponse(
        buildsContext(providerId, raw),
        buildsDependencies()
      );

      assert.ok(result.disposition === "normalized");

      const violations = validatesAgainstSchema(
        result.response,
        readsCanonicalResponseSchema()
      );

      assert.deepEqual(
        violations,
        [],
        `The ${providerId} projection violates the canonical contract: ${JSON.stringify(violations)}`
      );
    }
  });

  it("never classifies retryability", () => {
    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");

    // Retry authority belongs to the Retry Policy Executor.
    assert.equal(result.response.outcome.retryability, "not-classified");
  });

  it("always records the raw response hash as provenance", () => {
    const result = normalizesProviderResponse(
      buildsContext("openai", buildsOpenaiResponse()),
      buildsDependencies()
    );

    assert.ok(result.disposition === "normalized");
    assert.match(
      result.response.provenance.rawResponseHash,
      /^sha256:[0-9a-f]{64}$/
    );
    assert.equal(result.response.provenance.normalizerVersion, "0.1.0");
  });
});

describe("Conformance: the failure vocabulary is stable", () => {
  it("assigns a distinct exit code to every failure classification", () => {
    const codes = Object.values(FAILURE_EXIT_CODES);

    assert.equal(new Set(codes).size, codes.length);
    assert.equal(FAILURE_EXIT_CODES.NORMALIZED, 0);

    for (const failureCode of NORMALIZATION_FAILURE_CODES) {
      assert.ok(
        FAILURE_EXIT_CODES[failureCode] > 0,
        `The failure "${failureCode}" must map to a nonzero exit code.`
      );
    }
  });
});

describe("Conformance: every acceptance scenario is covered", () => {
  it("implements each scenario declared in the feature file", () => {
    const feature = readFileSync(
      fileURLToPath(
        new URL(
          "../../acceptance/normalizes-provider-response.feature",
          import.meta.url
        )
      ),
      "utf8"
    );

    const suite = readFileSync(
      fileURLToPath(
        new URL(
          "../acceptance/normalizes-provider-response.steps.test.ts",
          import.meta.url
        )
      ),
      "utf8"
    );

    const declaredScenarios = [...feature.matchAll(/^\s*Scenario:\s*(.+)$/gm)].map(
      (match) => match[1]?.trim()
    );

    assert.ok(declaredScenarios.length >= 12);

    for (const scenario of declaredScenarios) {
      assert.ok(
        suite.includes(`Scenario: ${scenario}`),
        `The acceptance suite is missing the declared scenario "${scenario}".`
      );
    }
  });
});
