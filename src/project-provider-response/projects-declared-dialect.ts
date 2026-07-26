import { parsesJsonText, serializesJsonValue } from "../adapters/parses-json-text.js";
import { readsDeclaredDecision } from "../adapters/reads-authority-documents.js";
import { executesDeclaredProjection } from "../kernel/executes-declared-projection.js";
import { readsDeclaredPath } from "../kernel/reads-declared-path.js";
import { readsArray, readsObject, readsString } from "../kernel/reads-provider-values.js";
import { resolvesDeclaredDecision } from "../kernel/resolves-declared-decision.js";
import { selectsFirstMatchingRule } from "../kernel/selects-matching-rule.js";
import type {
  CanonicalModelResponseProjection,
  NormalizationDiagnostic,
  NormalizeProviderResponseContext,
} from "../shared/response-normalizer-contract.js";
import type {
  ProviderDialect,
  SegmentRule,
  ToolCallBinding,
} from "./provider-dialect.type.js";

/**
 * Executes a declared provider dialect.
 *
 * Every branch below selects declared authority rather than authoring meaning:
 * which segment rule applies comes from the dialect, what a finish reason means
 * comes from a decision table, and what a usage or arguments disposition is
 * comes from its own decision table. This body wires those together and
 * performs no domain judgement of its own.
 */
export function projectsDeclaredDialect(
  dialect: ProviderDialect,
  context: NormalizeProviderResponseContext
): CanonicalModelResponseProjection {
  const root = context.rawResponse;
  const diagnostics: NormalizationDiagnostic[] = [];

  const candidate = selectsAuthorizedCandidate(dialect, root, context, diagnostics);
  const segments = projectsSegments(dialect, candidate, root, context, diagnostics);
  const structuredOutput = projectsStructuredOutput(segments.textContent, context, diagnostics);
  const refusal = projectsRefusal(dialect, candidate, root);
  const safety = projectsSafety(dialect, candidate, root);
  const outcome = projectsOutcome(dialect, candidate, root, segments, refusal, safety, diagnostics);
  const usage = projectsUsage(dialect, root, context, diagnostics);
  const identity = projectsIdentity(dialect, root);

  return Object.freeze({
    provider: Object.freeze({
      providerResponseId: readsString(identity.providerResponseId),
      providerRequestId: readsString(identity.providerRequestId),
    }),
    model: Object.freeze({
      providerReportedModel: readsString(identity.providerReportedModel),
    }),
    outcome,
    content: Object.freeze({
      segments: segments.segments,
      combinedText: segments.textContent,
      structuredOutput,
      toolCalls: segments.toolCalls,
    }),
    refusal,
    safety,
    usage,
    diagnostics: Object.freeze(diagnostics),
  });
}

/** Reads the identity region through the dialect's declared field bindings. */
function projectsIdentity(
  dialect: ProviderDialect,
  root: unknown
): Record<string, unknown> {
  return executesDeclaredProjection(
    {
      projectionId: `${dialect.dialectId}-identity`,
      fields: {
        providerResponseId: sourceOrNull(dialect.identity.providerResponseId),
        providerRequestId: sourceOrNull(dialect.identity.providerRequestId),
        providerReportedModel: sourceOrNull(dialect.identity.providerReportedModel),
      },
    },
    root
  );
}

function sourceOrNull(path: string | null): { path: string } | { value: null } {
  return path === null ? { value: null } : { path };
}

/**
 * Selects the candidate this projection is authorized to read, recording the
 * dialect's declared diagnostic when the provider returned more than policy
 * authorizes.
 */
function selectsAuthorizedCandidate(
  dialect: ProviderDialect,
  root: unknown,
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[]
): unknown {
  const carriesResultOnRoot = dialect.candidates.path === SELF_PATH;

  const candidates = readsArray(
    readsDeclaredPath(dialect.candidates.path, root, root)
  );

  const overflowed =
    !carriesResultOnRoot &&
    candidates.length > context.normalizationPolicy.content.maximumCandidates;

  recordsWhen(overflowed, diagnostics, dialect.candidates.overflowDiagnostic);

  return carriesResultOnRoot ? root : candidates[0];
}

const SELF_PATH = "$self";

type SegmentProjection = Readonly<{
  segments: readonly CanonicalModelResponseProjection["content"]["segments"][number][];
  toolCalls: readonly CanonicalModelResponseProjection["content"]["toolCalls"][number][];
  textContent: string;
}>;

/**
 * Projects content parts into ordered canonical segments.
 *
 * Iteration order is the provider's. Which rule applies to a part is selected
 * by the kernel from the dialect's declared rules; this body only assembles
 * what those rules produced.
 */
function projectsSegments(
  dialect: ProviderDialect,
  candidate: unknown,
  root: unknown,
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[]
): SegmentProjection {
  const candidateDrafts = (dialect.content.candidateRules ?? []).flatMap((rule) =>
    projectsRuleAgainst(rule, candidate, root, context, diagnostics, CANDIDATE_PATH)
  );

  const singleText = readsString(
    readsDeclaredPath(dialect.content.singlePartPath ?? SELF_PATH, candidate, root)
  );

  const parts = readsArray(
    readsDeclaredPath(dialect.content.partsPath ?? SELF_PATH, candidate, root)
  );

  const bareTextDrafts = whenPresent(singleText, (text) => [
    Object.freeze({ kind: "text" as const, text, contributesToText: true }),
  ]);

  const partDrafts = parts.flatMap((part, position) =>
    projectsPart(dialect, part, root, context, diagnostics, position)
  );

  const toolCallDrafts = (dialect.content.toolCallSources ?? []).flatMap((source) =>
    readsArray(readsDeclaredPath(source.path, candidate, root)).map((entry, position) =>
      projectsToolCallDraft(
        source.toolCall,
        entry,
        root,
        context,
        diagnostics,
        `${source.diagnosticPath ?? source.path}[${position}]`,
        position
      )
    )
  );

  const drafts = [
    ...candidateDrafts,
    ...(singleText === null ? partDrafts : bareTextDrafts),
    ...toolCallDrafts,
  ];

  return assemblesSegments(drafts, context, diagnostics);
}

const CANDIDATE_PATH = "$.candidate";

type SegmentDraft = Readonly<{
  kind: CanonicalModelResponseProjection["content"]["segments"][number]["kind"];
  text?: string;
  toolCall?: CanonicalModelResponseProjection["content"]["toolCalls"][number];
  raw?: unknown;
  contributesToText?: boolean;
}>;

/**
 * Projects one content part through the first dialect rule that matches it.
 * A part no rule matches becomes an unsupported segment when the dialect says
 * to preserve it.
 */
function projectsPart(
  dialect: ProviderDialect,
  part: unknown,
  root: unknown,
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[],
  position: number
): readonly SegmentDraft[] {
  const matched = selectsFirstMatchingRule(dialect.content.segmentRules, part, root);

  const preservesUnmatched =
    dialect.content.unmatchedPart === "preserve-as-unsupported";

  const unmatchedDrafts = preservesUnmatched
    ? [Object.freeze({ kind: "unsupported" as const, raw: part })]
    : [];

  return matched === null
    ? unmatchedDrafts
    : projectsRuleAgainst(
        matched,
        part,
        root,
        context,
        diagnostics,
        `$.content.parts[${position}]`,
        position
      );
}

/**
 * Applies one matched rule. A rule gated on a policy flag that is disabled
 * yields no segment at all.
 */
function projectsRuleAgainst(
  rule: SegmentRule,
  value: unknown,
  root: unknown,
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[],
  path: string,
  position = 0
): readonly SegmentDraft[] {
  const ruleApplies =
    selectsFirstMatchingRule([rule], value, root) !== null &&
    satisfiesPolicyGate(rule, context);

  const toolCallDrafts = whenTrue(ruleApplies && rule.kind === "tool-call", () => [
    projectsToolCallDraft(
      rule.toolCall as ToolCallBinding,
      value,
      root,
      context,
      diagnostics,
      path,
      position
    ),
  ]);

  const textDrafts = whenTrue(ruleApplies && rule.kind !== "tool-call", () => [
    Object.freeze({
      kind: rule.kind,
      text: readsString(readsDeclaredPath(rule.textPath ?? SELF_PATH, value, root)) ?? "",
      contributesToText: rule.contributesToText === true,
    }),
  ]);

  return [...toolCallDrafts, ...textDrafts];
}

/**
 * Projects one tool call. The arguments disposition is decided by its declared
 * decision table, never by this body.
 */
function projectsToolCallDraft(
  binding: ToolCallBinding,
  value: unknown,
  root: unknown,
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[],
  path: string,
  position: number
): SegmentDraft {
  const providerParsed =
    binding.parsedArgumentsPath === undefined
      ? undefined
      : readsDeclaredPath(binding.parsedArgumentsPath, value, root);

  const declaredText =
    binding.argumentsTextPath === undefined
      ? null
      : readsString(readsDeclaredPath(binding.argumentsTextPath, value, root));

  // When a provider supplies arguments already structured, the retained text is
  // a faithful serialization of that same value, not separate testimony.
  const argumentsText =
    declaredText ?? whenPresentValue(providerParsed, serializesJsonValue);

  const observedParse = whenPresentValue(declaredText, parsesJsonText);

  const resolution = resolvesDeclaredDecision(
    readsDeclaredDecision("resolve-arguments-disposition"),
    {
      providerSuppliedParsedArguments: providerParsed !== undefined,
      argumentsTextPresent: argumentsText !== null,
      parsingAuthorized: context.normalizationPolicy.toolCalls.parseArguments,
      parseSucceeded: observedParse?.parsed ?? false,
    }
  );

  recordsWhen(true, diagnostics, rebasesDiagnostic(resolution.diagnostic, path));

  const parsedValue =
    providerParsed !== undefined
      ? providerParsed
      : (observedParse?.parsed === true ? observedParse.value : null);

  return Object.freeze({
    kind: "tool-call" as const,
    toolCall: Object.freeze({
      callId:
        readsString(
          readsDeclaredPath(binding.callIdPath ?? SELF_PATH, value, root)
        ) ?? `tool-call-${position}`,
      toolName:
        readsString(readsDeclaredPath(binding.toolNamePath, value, root)) ??
        "unknown-tool",
      argumentsText: context.normalizationPolicy.toolCalls.retainArgumentsText
        ? argumentsText
        : null,
      arguments: resolution.outcome === "parsed" ? parsedValue : null,
      argumentsDisposition: resolution.outcome as "parsed" | "invalid-json" | "absent",
    }),
  });
}

/** Assigns segment indices in provider order and derives the projections. */
function assemblesSegments(
  drafts: readonly SegmentDraft[],
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[]
): SegmentProjection {
  const segments = drafts.map((draft, index) =>
    Object.freeze({
      index,
      kind: draft.kind,
      ...(draft.text !== undefined ? { text: draft.text } : {}),
      ...(draft.toolCall !== undefined ? { toolCall: draft.toolCall } : {}),
      ...(draft.raw !== undefined ? { raw: draft.raw } : {}),
    })
  );

  drafts.forEach((draft, index) =>
    recordsWhen(draft.kind === "unsupported", diagnostics, {
      code: "UNSUPPORTED_CONTENT_SEGMENT_PRESERVED",
      severity: "warning",
      path: `$.content.segments[${index}]`,
      message:
        "The provider returned a content segment this contract version does not model. It was preserved verbatim.",
    })
  );

  const contributing = drafts.filter((draft) => draft.contributesToText === true);

  const textSource = context.normalizationPolicy.content.combineTextSegments
    ? contributing
    : contributing.slice(0, 1);

  return Object.freeze({
    segments: Object.freeze(segments) as SegmentProjection["segments"],
    toolCalls: Object.freeze(
      drafts
        .filter((draft) => draft.toolCall !== undefined)
        .map((draft) => draft.toolCall)
    ) as SegmentProjection["toolCalls"],
    textContent: textSource.map((draft) => draft.text ?? "").join(""),
  });
}

/** Resolves the structured-output region through its declared decision. */
function projectsStructuredOutput(
  textContent: string,
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[]
): CanonicalModelResponseProjection["content"]["structuredOutput"] {
  const requested = context.structuredOutputRequested === true;
  const policy = context.normalizationPolicy.structuredOutput.parseTextAsJson;

  const parsingAuthorized =
    policy === "always" || (policy === "only-when-declared" && requested);

  const textPresent = textContent.trim() !== "";

  const observedParse = whenTrue(parsingAuthorized && textPresent, () => [
    parsesJsonText(textContent),
  ])[0];

  const resolution = resolvesDeclaredDecision(
    readsDeclaredDecision("resolve-structured-output-disposition"),
    {
      providerSuppliedNativeValue: false,
      parsingAuthorized,
      structuredOutputRequested: requested,
      textPresent,
      parseSucceeded: observedParse?.parsed ?? false,
    }
  );

  recordsWhen(true, diagnostics, resolution.diagnostic);

  const carriesValue = resolution.outcome === "parsed";
  const readFromText =
    resolution.outcome === "parsed" || resolution.outcome === "invalid-json";

  return Object.freeze({
    disposition: resolution.outcome as
      | "not-requested"
      | "not-present"
      | "parsed"
      | "invalid-json"
      | "provider-native",
    value: carriesValue ? (observedParse?.value ?? null) : null,
    source: readFromText ? ("text-content" as const) : null,
  });
}

/** Resolves the outcome region through the finish-disposition decision. */
function projectsOutcome(
  dialect: ProviderDialect,
  candidate: unknown,
  root: unknown,
  segments: SegmentProjection,
  refusal: CanonicalModelResponseProjection["refusal"],
  safety: CanonicalModelResponseProjection["safety"],
  diagnostics: NormalizationDiagnostic[]
): CanonicalModelResponseProjection["outcome"] {
  const providerFinishReason =
    dialect.outcome.finishReasonSources
      .map((source) => readsString(readsDeclaredPath(source, candidate, root)))
      .find((value) => value !== null) ?? null;

  recordsWhen(
    providerFinishReason === null && candidate !== undefined,
    diagnostics,
    dialect.outcome.absentDiagnostic
  );

  const resolution = resolvesDeclaredDecision(
    readsDeclaredDecision("resolve-finish-disposition"),
    {
      providerId: dialect.providerId,
      providerFinishReason,
      refusalPresent: refusal.present,
      safetyBlocked: safety.signals.some((signal) => signal.blocked),
      toolCallsPresent: segments.toolCalls.length > 0,
    }
  );

  recordsWhen(true, diagnostics, resolution.diagnostic);

  recordsWhen(
    resolution.outcome !== "completed" && segments.segments.length === 0,
    diagnostics,
    dialect.outcome.emptyCandidateDiagnostic
  );

  return Object.freeze({
    disposition: resolution.outcome as CanonicalModelResponseProjection["outcome"]["disposition"],
    providerFinishReason,
  });
}

function projectsRefusal(
  dialect: ProviderDialect,
  candidate: unknown,
  root: unknown
): CanonicalModelResponseProjection["refusal"] {
  const reason = whenTrue(
    dialect.refusal.supported && dialect.refusal.reasonPath !== undefined,
    () => [readsString(readsDeclaredPath(dialect.refusal.reasonPath as string, candidate, root))]
  )[0] ?? null;

  return Object.freeze({
    present: reason !== null,
    reason,
    providerCategory: reason === null ? null : (dialect.refusal.providerCategory ?? null),
  });
}

/**
 * Projects graded safety ratings, filter maps, and provider-level blocks into
 * one safety region. A rating is retained whenever the provider graded it,
 * whether or not it caused a block.
 */
function projectsSafety(
  dialect: ProviderDialect,
  candidate: unknown,
  root: unknown
): CanonicalModelResponseProjection["safety"] {
  const ratingSignals = (dialect.safety.ratingSources ?? []).flatMap((source) =>
    readsArray(readsDeclaredPath(source.path, candidate, root))
      .map((entry) => ({
        category: readsString(readsDeclaredPath(source.categoryPath, entry, root)),
        severity:
          (source.severityPaths ?? [])
            .map((severityPath) => readsString(readsDeclaredPath(severityPath, entry, root)))
            .find((value) => value !== null) ?? null,
        blocked:
          source.blockedWhen !== undefined &&
          selectsFirstMatchingRule(
            [{ ruleId: source.path, when: [source.blockedWhen], kind: "text" }],
            entry,
            root
          ) !== null,
      }))
      .filter((signal) => signal.category !== null)
  );

  const filterSignals = (dialect.safety.filterMapSources ?? []).flatMap((source) =>
    Object.entries(readsObject(readsDeclaredPath(source.path, candidate, root)) ?? {})
      .map(([category, value]) => {
        const detail = readsObject(value) ?? {};

        return {
          category,
          severity:
            source.severityKey === undefined
              ? null
              : readsString(detail[source.severityKey]),
          blocked:
            source.blockedKey !== undefined && detail[source.blockedKey] === true,
        };
      })
      .filter((signal) => signal.blocked || signal.severity !== null)
  );

  const blockCategory = whenTrue(dialect.safety.blockSignal !== undefined, () => [
    readsString(
      readsDeclaredPath(
        (dialect.safety.blockSignal as { categoryPath: string }).categoryPath,
        candidate,
        root
      )
    ),
  ])[0];

  const blockSignals = whenPresent(blockCategory ?? null, (category) => [
    { category, severity: null, blocked: true },
  ]);

  const signals = [...ratingSignals, ...filterSignals, ...blockSignals].map(
    (signal) => Object.freeze(signal as { category: string; severity: string | null; blocked: boolean })
  );

  return Object.freeze({
    signalsPresent: signals.length > 0,
    signals: Object.freeze(signals),
  });
}

/**
 * Projects usage through the dialect's declared field bindings, then resolves
 * the disposition through its declared decision.
 */
function projectsUsage(
  dialect: ProviderDialect,
  root: unknown,
  context: NormalizeProviderResponseContext,
  diagnostics: NormalizationDiagnostic[]
): CanonicalModelResponseProjection["usage"] {
  const rawUsage = readsObject(readsDeclaredPath(dialect.usage.path, root, root));

  const observed = executesDeclaredProjection(
    {
      projectionId: `${dialect.dialectId}-usage`,
      fields: {
        inputTokens: sourceOrNull(dialect.usage.inputTokens ?? null),
        outputTokens: sourceOrNull(dialect.usage.outputTokens ?? null),
        totalTokens: sourceOrNull(dialect.usage.totalTokens ?? null),
        cachedInputTokens: sourceOrNull(dialect.usage.cachedInputTokens ?? null),
        reasoningTokens: sourceOrNull(dialect.usage.reasoningTokens ?? null),
      },
    },
    rawUsage ?? {}
  );

  const counts = readsTokenCounts(observed, diagnostics);

  const derivedTotal =
    context.normalizationPolicy.usage.allowDerivedTotal &&
    counts.totalTokens === null &&
    counts.inputTokens !== null &&
    counts.outputTokens !== null
      ? counts.inputTokens + counts.outputTokens
      : counts.totalTokens;

  const resolution = resolvesDeclaredDecision(
    readsDeclaredDecision("resolve-usage-disposition"),
    {
      inputObserved: counts.inputTokens !== null,
      outputObserved: counts.outputTokens !== null,
      totalObserved: derivedTotal !== null,
    }
  );

  const unavailable = resolution.outcome === "unavailable" || rawUsage === null;

  return Object.freeze({
    disposition: unavailable
      ? ("unavailable" as const)
      : (resolution.outcome as "observed" | "partially-observed"),
    inputTokens: unavailable ? null : counts.inputTokens,
    outputTokens: unavailable ? null : counts.outputTokens,
    totalTokens: unavailable ? null : derivedTotal,
    cachedInputTokens: unavailable ? null : counts.cachedInputTokens,
    reasoningTokens: unavailable ? null : counts.reasoningTokens,
    providerUsage: Object.freeze({ ...(rawUsage ?? {}) }),
  });
}

type TokenCounts = Readonly<{
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
}>;

/**
 * A token count is accepted only as a non-negative integer. A string, a float,
 * or a negative number is testimony this contract cannot represent, so it is
 * reported and dropped rather than coerced.
 */
function readsTokenCounts(
  observed: Record<string, unknown>,
  diagnostics: NormalizationDiagnostic[]
): TokenCounts {
  const readsCount = (field: string): number | null => {
    const value = observed[field];
    const usable =
      typeof value === "number" && Number.isInteger(value) && value >= 0;

    recordsWhen(value !== null && value !== undefined && !usable, diagnostics, {
      code: "USAGE_TOKEN_COUNT_NOT_INTERPRETABLE",
      severity: "warning",
      path: `$.usage.${field}`,
      message: `The provider reported a token count this contract cannot represent (${JSON.stringify(value)}). It was not projected.`,
    });

    return usable ? (value as number) : null;
  };

  return Object.freeze({
    inputTokens: readsCount("inputTokens"),
    outputTokens: readsCount("outputTokens"),
    totalTokens: readsCount("totalTokens"),
    cachedInputTokens: readsCount("cachedInputTokens"),
    reasoningTokens: readsCount("reasoningTokens"),
  });
}

function satisfiesPolicyGate(
  rule: SegmentRule,
  context: NormalizeProviderResponseContext
): boolean {
  return (
    rule.includeWhenPolicy !== "content.includeReasoningSummary" ||
    context.normalizationPolicy.content.includeReasoningSummary
  );
}

function rebasesDiagnostic(
  diagnostic: NormalizationDiagnostic | undefined,
  path: string
): NormalizationDiagnostic | undefined {
  return diagnostic === undefined
    ? undefined
    : Object.freeze({ ...diagnostic, path });
}

function recordsWhen(
  condition: boolean,
  diagnostics: NormalizationDiagnostic[],
  diagnostic: NormalizationDiagnostic | undefined
): void {
  const recordable = condition && diagnostic !== undefined;

  diagnostics.push(...(recordable ? [diagnostic as NormalizationDiagnostic] : []));
}

function whenTrue<T>(condition: boolean, produces: () => readonly T[]): readonly T[] {
  return condition ? produces() : [];
}

function whenPresent<T, R>(
  value: T | null,
  produces: (present: T) => readonly R[]
): readonly R[] {
  return value === null ? [] : produces(value);
}

function whenPresentValue<T, R>(
  value: T | null | undefined,
  produces: (present: T) => R
): R | null {
  return value === null || value === undefined ? null : produces(value);
}
