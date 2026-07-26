import {
  projectsCanonicalContent,
  projectsStructuredOutput,
  projectsToolCall,
  type SegmentDraft,
} from "../canonical-model-response/projects-canonical-content.js";
import { projectsCanonicalUsage } from "../canonical-model-response/projects-canonical-usage.js";
import { resolvesFinishDisposition } from "../canonical-model-response/resolves-finish-disposition.js";
import type {
  CanonicalModelResponseProjection,
  CanonicalRefusal,
  CanonicalSafety,
  CanonicalSafetySignal,
  CanonicalToolCall,
  NormalizationDiagnostic,
  NormalizeProviderResponseContext,
} from "../shared/response-normalizer-contract.js";
import {
  readsArray,
  readsObject,
  readsString,
} from "../shared/reads-provider-values.js";
import type {
  ProviderDialect,
  SegmentRule,
  ToolCallBinding,
} from "./provider-dialect.type.js";
import {
  readsDeclaredPath,
  satisfiesDeclaredPredicate,
} from "./reads-declared-path.js";

/**
 * The single provider-neutral projector.
 *
 * All provider shape knowledge lives in the dialect document under
 * authority/dialects/. This body executes that resolved authority: it locates
 * declared paths, applies declared segment rules, and assembles the canonical
 * regions. It contains no provider names and no provider field names.
 */
export function projectsDeclaredDialect(
  dialect: ProviderDialect,
  context: NormalizeProviderResponseContext
): CanonicalModelResponseProjection {
  const diagnostics: NormalizationDiagnostic[] = [];
  const policy = context.normalizationPolicy;
  const root = context.rawResponse;

  const candidate = readsAuthorizedCandidate(dialect, root, policy.content.maximumCandidates, diagnostics);

  const segments = projectsSegments(dialect, candidate, root, context, diagnostics);

  const structured = projectsStructuredOutput({
    textContent: segments.textContent,
    structuredOutputRequested: context.structuredOutputRequested === true,
    policy,
  });

  diagnostics.push(...structured.diagnostics);

  const content = projectsCanonicalContent(
    segments.drafts,
    structured.structuredOutput,
    policy
  );

  diagnostics.push(...content.diagnostics);

  const refusal = projectsDeclaredRefusal(dialect, candidate, root);
  const safety = projectsDeclaredSafety(dialect, candidate, root);

  const providerFinishReason = readsDeclaredFinishReason(dialect, candidate, root);

  if (providerFinishReason === null && candidate !== undefined) {
    pushesTemplate(diagnostics, dialect.outcome.absentDiagnostic);
  }

  const finish = resolvesFinishDisposition({
    providerId: dialect.providerId,
    providerFinishReason,
    refusalPresent: refusal.present,
    safetyBlocked: safety.signals.some((signal) => signal.blocked),
    toolCallsPresent: segments.toolCalls.length > 0,
  });

  diagnostics.push(...finish.diagnostics);

  if (finish.disposition !== "completed" && segments.drafts.length === 0) {
    pushesTemplate(diagnostics, dialect.outcome.emptyCandidateDiagnostic);
  }

  const usage = projectsDeclaredUsage(dialect, root, context, diagnostics);

  return Object.freeze({
    provider: Object.freeze({
      providerResponseId: readsDeclaredString(dialect.identity.providerResponseId, root, root),
      providerRequestId: readsDeclaredString(dialect.identity.providerRequestId, root, root),
    }),
    model: Object.freeze({
      providerReportedModel: readsDeclaredString(
        dialect.identity.providerReportedModel,
        root,
        root
      ),
    }),
    outcome: Object.freeze({
      disposition: finish.disposition,
      providerFinishReason,
    }),
    content: content.content,
    refusal,
    safety,
    usage,
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Selects the candidate this projection is authorized to read. A dialect whose
 * candidate path is "$self" carries its result on the response root.
 */
function readsAuthorizedCandidate(
  dialect: ProviderDialect,
  root: unknown,
  maximumCandidates: number,
  diagnostics: NormalizationDiagnostic[]
): unknown {
  if (dialect.candidates.path === "$self") {
    return root;
  }

  const candidates = readsArray(readsDeclaredPath(dialect.candidates.path, root, root));

  if (candidates.length > maximumCandidates) {
    pushesTemplate(diagnostics, dialect.candidates.overflowDiagnostic);
  }

  return candidates[0];
}

type SegmentProjection = Readonly<{
  drafts: readonly SegmentDraft[];
  toolCalls: readonly CanonicalToolCall[];
  textContent: string;
}>;

function projectsSegments(
  dialect: ProviderDialect,
  candidate: unknown,
  root: unknown,
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[]
): SegmentProjection {
  const drafts: SegmentDraft[] = [];
  const toolCalls: CanonicalToolCall[] = [];
  const collectedText: string[] = [];

  if (candidate === undefined || candidate === null) {
    return Object.freeze({ drafts, toolCalls, textContent: "" });
  }

  const collector: SegmentCollector = {
    drafts,
    toolCalls,
    collectedText,
    diagnostics,
  };

  // Candidate-level rules read fields carried on the message itself, such as a
  // refusal, rather than on a content part.
  for (const rule of dialect.content.candidateRules ?? []) {
    appliesRuleWhenMatched(rule, candidate, root, context, collector, "$.candidate", 0);
  }

  // A dialect may carry content as a bare string rather than an array of parts.
  const singleText =
    dialect.content.singlePartPath === undefined
      ? null
      : readsString(readsDeclaredPath(dialect.content.singlePartPath, candidate, root));

  if (singleText !== null) {
    drafts.push({ kind: "text", text: singleText });
    collectedText.push(singleText);
  } else {
    const parts =
      dialect.content.partsPath === undefined
        ? []
        : readsArray(readsDeclaredPath(dialect.content.partsPath, candidate, root));

    parts.forEach((part, position) => {
      appliesPartRules(dialect, part, root, context, collector, position);
    });
  }

  for (const source of dialect.content.toolCallSources ?? []) {
    const entries = readsArray(readsDeclaredPath(source.path, candidate, root));

    entries.forEach((entry, position) => {
      appliesToolCallBinding(
        source.toolCall,
        entry,
        root,
        context,
        collector,
        `${source.diagnosticPath ?? source.path}[${position}]`,
        position
      );
    });
  }

  return Object.freeze({
    drafts,
    toolCalls,
    textContent: collectedText.join(""),
  });
}

type SegmentCollector = {
  drafts: SegmentDraft[];
  toolCalls: CanonicalToolCall[];
  collectedText: string[];
  diagnostics: NormalizationDiagnostic[];
};

/**
 * Applies the declared part rules to one content part, first matching rule
 * wins. A part matching no rule is preserved verbatim when the dialect says so.
 */
function appliesPartRules(
  dialect: ProviderDialect,
  part: unknown,
  root: unknown,
  context: NormalizeProviderResponseContext,
  collector: SegmentCollector,
  position: number
): void {
  const path = `$.content.parts[${position}]`;

  for (const rule of dialect.content.segmentRules) {
    if (!matchesRule(rule, part, root)) {
      continue;
    }

    // A rule gated on a policy flag that is disabled drops the segment rather
    // than falling through to a later rule.
    if (!satisfiesPolicyGate(rule, context)) {
      return;
    }

    appliesRule(rule, part, root, context, collector, path, position);

    return;
  }

  if (dialect.content.unmatchedPart === "preserve-as-unsupported") {
    collector.drafts.push({ kind: "unsupported", raw: part });
  }
}

function appliesRuleWhenMatched(
  rule: SegmentRule,
  value: unknown,
  root: unknown,
  context: NormalizeProviderResponseContext,
  collector: SegmentCollector,
  path: string,
  position: number
): void {
  if (!matchesRule(rule, value, root) || !satisfiesPolicyGate(rule, context)) {
    return;
  }

  appliesRule(rule, value, root, context, collector, path, position);
}

function matchesRule(rule: SegmentRule, value: unknown, root: unknown): boolean {
  return rule.when.every((predicate) =>
    satisfiesDeclaredPredicate(predicate, value, root)
  );
}

function appliesRule(
  rule: SegmentRule,
  value: unknown,
  root: unknown,
  context: NormalizeProviderResponseContext,
  collector: SegmentCollector,
  path: string,
  position: number
): void {
  if (rule.kind === "tool-call" && rule.toolCall) {
    appliesToolCallBinding(
      rule.toolCall,
      value,
      root,
      context,
      collector,
      path,
      position
    );

    return;
  }

  const text =
    rule.textPath === undefined
      ? null
      : readsString(readsDeclaredPath(rule.textPath, value, root));

  collector.drafts.push({ kind: rule.kind, text: text ?? "" });

  if (rule.contributesToText === true && text !== null) {
    collector.collectedText.push(text);
  }
}

/** Projects one tool call from its declared field bindings. */
function appliesToolCallBinding(
  binding: ToolCallBinding,
  value: unknown,
  root: unknown,
  context: NormalizeProviderResponseContext,
  collector: SegmentCollector,
  path: string,
  position: number
): void {
  const parsedArguments =
    binding.parsedArgumentsPath === undefined
      ? undefined
      : readsDeclaredPath(binding.parsedArgumentsPath, value, root);

  // When a provider supplies arguments already structured, the retained text is
  // a faithful serialization of that same value rather than separate testimony.
  const argumentsText =
    binding.argumentsTextPath === undefined
      ? parsedArguments === undefined
        ? null
        : JSON.stringify(parsedArguments)
      : readsString(readsDeclaredPath(binding.argumentsTextPath, value, root));

  const draft: {
    callId: string;
    toolName: string;
    argumentsText: string | null;
    providerParsedArguments?: unknown;
  } = {
    callId:
      (binding.callIdPath === undefined
        ? null
        : readsString(readsDeclaredPath(binding.callIdPath, value, root))) ??
      `tool-call-${position}`,
    toolName:
      readsString(readsDeclaredPath(binding.toolNamePath, value, root)) ??
      "unknown-tool",
    argumentsText,
  };

  if (parsedArguments !== undefined) {
    draft.providerParsedArguments = parsedArguments;
  }

  const projection = projectsToolCall(draft, context.normalizationPolicy, path);

  collector.diagnostics.push(...projection.diagnostics);
  collector.toolCalls.push(projection.toolCall);
  collector.drafts.push({ kind: "tool-call", toolCall: projection.toolCall });
}

function satisfiesPolicyGate(
  rule: SegmentRule,
  context: NormalizeProviderResponseContext
): boolean {
  if (rule.includeWhenPolicy === "content.includeReasoningSummary") {
    return context.normalizationPolicy.content.includeReasoningSummary;
  }

  return true;
}

function readsDeclaredFinishReason(
  dialect: ProviderDialect,
  candidate: unknown,
  root: unknown
): string | null {
  for (const source of dialect.outcome.finishReasonSources) {
    const observed = readsString(readsDeclaredPath(source, candidate, root));

    if (observed !== null) {
      return observed;
    }
  }

  return null;
}

function projectsDeclaredRefusal(
  dialect: ProviderDialect,
  candidate: unknown,
  root: unknown
): CanonicalRefusal {
  if (!dialect.refusal.supported || dialect.refusal.reasonPath === undefined) {
    return Object.freeze({ present: false, reason: null, providerCategory: null });
  }

  const reason = readsString(
    readsDeclaredPath(dialect.refusal.reasonPath, candidate, root)
  );

  return Object.freeze({
    present: reason !== null,
    reason,
    providerCategory: reason !== null ? (dialect.refusal.providerCategory ?? null) : null,
  });
}

function projectsDeclaredSafety(
  dialect: ProviderDialect,
  candidate: unknown,
  root: unknown
): CanonicalSafety {
  if (!dialect.safety.supported) {
    return Object.freeze({ signalsPresent: false, signals: Object.freeze([]) });
  }

  const signals: CanonicalSafetySignal[] = [];

  for (const source of dialect.safety.ratingSources ?? []) {
    for (const entry of readsArray(readsDeclaredPath(source.path, candidate, root))) {
      const category = readsString(
        readsDeclaredPath(source.categoryPath, entry, root)
      );

      if (category === null) {
        continue;
      }

      const severity =
        (source.severityPaths ?? [])
          .map((severityPath) => readsString(readsDeclaredPath(severityPath, entry, root)))
          .find((value) => value !== null) ?? null;

      signals.push(
        Object.freeze({
          category,
          severity,
          blocked:
            source.blockedWhen === undefined
              ? false
              : satisfiesDeclaredPredicate(source.blockedWhen, entry, root),
        })
      );
    }
  }

  for (const source of dialect.safety.filterMapSources ?? []) {
    const filterMap = readsObject(readsDeclaredPath(source.path, candidate, root));

    if (!filterMap) {
      continue;
    }

    for (const [category, value] of Object.entries(filterMap)) {
      const detail = readsObject(value) ?? {};

      const severity =
        source.severityKey === undefined
          ? null
          : readsString(detail[source.severityKey]);

      const blocked =
        source.blockedKey !== undefined && detail[source.blockedKey] === true;

      if (!blocked && severity === null) {
        continue;
      }

      signals.push(Object.freeze({ category, severity, blocked }));
    }
  }

  if (dialect.safety.blockSignal !== undefined) {
    const blockCategory = readsString(
      readsDeclaredPath(dialect.safety.blockSignal.categoryPath, candidate, root)
    );

    if (blockCategory !== null) {
      signals.push(
        Object.freeze({ category: blockCategory, severity: null, blocked: true })
      );
    }
  }

  return Object.freeze({
    signalsPresent: signals.length > 0,
    signals: Object.freeze(signals),
  });
}

function projectsDeclaredUsage(
  dialect: ProviderDialect,
  root: unknown,
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[]
): CanonicalModelResponseProjection["usage"] {
  const rawUsage = readsObject(readsDeclaredPath(dialect.usage.path, root, root));

  const projection = projectsCanonicalUsage(
    rawUsage
      ? {
          inputTokens: readsUsageValue(dialect.usage.inputTokens, rawUsage, root),
          outputTokens: readsUsageValue(dialect.usage.outputTokens, rawUsage, root),
          totalTokens: readsUsageValue(dialect.usage.totalTokens, rawUsage, root),
          cachedInputTokens: readsUsageValue(
            dialect.usage.cachedInputTokens,
            rawUsage,
            root
          ),
          reasoningTokens: readsUsageValue(
            dialect.usage.reasoningTokens,
            rawUsage,
            root
          ),
          providerUsage: rawUsage,
        }
      : undefined,
    context.normalizationPolicy
  );

  diagnostics.push(...projection.diagnostics);

  return projection.usage;
}

function readsUsageValue(
  path: string | undefined,
  usage: unknown,
  root: unknown
): unknown {
  return path === undefined ? undefined : readsDeclaredPath(path, usage, root);
}

function readsDeclaredString(
  path: string | null | undefined,
  local: unknown,
  root: unknown
): string | null {
  if (path === null || path === undefined) {
    return null;
  }

  return readsString(readsDeclaredPath(path, local, root));
}

function pushesTemplate(
  diagnostics: NormalizationDiagnostic[],
  template: NormalizationDiagnostic | undefined
): void {
  if (template !== undefined) {
    diagnostics.push(template);
  }
}
