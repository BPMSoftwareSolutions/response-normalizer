import type {
  CanonicalUsage,
  NormalizationDiagnostic,
  NormalizationPolicy,
} from "../shared/response-normalizer-contract.js";

/**
 * Provider-neutral usage projection.
 *
 * Usage must never silently become fiction. A count is projected only when the
 * provider testified to it as a non-negative integer. Anything else becomes
 * null plus a diagnostic — never a zero, never an estimate.
 */

export type UsageObservation = Readonly<{
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  cachedInputTokens?: unknown;
  reasoningTokens?: unknown;
  providerUsage?: Readonly<Record<string, unknown>>;
}>;

export type UsageProjection = Readonly<{
  usage: CanonicalUsage;
  diagnostics: readonly NormalizationDiagnostic[];
}>;

export function projectsCanonicalUsage(
  observation: UsageObservation | undefined,
  policy: NormalizationPolicy,
  path = "$.usage"
): UsageProjection {
  const diagnostics: NormalizationDiagnostic[] = [];

  if (observation === undefined) {
    return Object.freeze({
      usage: unavailableUsage(),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  const inputTokens = readsTokenCount(
    observation.inputTokens,
    `${path}.inputTokens`,
    diagnostics
  );
  const outputTokens = readsTokenCount(
    observation.outputTokens,
    `${path}.outputTokens`,
    diagnostics
  );
  const cachedInputTokens = readsTokenCount(
    observation.cachedInputTokens,
    `${path}.cachedInputTokens`,
    diagnostics
  );
  const reasoningTokens = readsTokenCount(
    observation.reasoningTokens,
    `${path}.reasoningTokens`,
    diagnostics
  );

  let totalTokens = readsTokenCount(
    observation.totalTokens,
    `${path}.totalTokens`,
    diagnostics
  );

  // A derived total is arithmetic over observed testimony, not an estimate.
  // It is only permitted when both operands were actually observed.
  if (
    totalTokens === null &&
    policy.usage.allowDerivedTotal &&
    inputTokens !== null &&
    outputTokens !== null
  ) {
    totalTokens = inputTokens + outputTokens;
  }

  const observedCounts = [inputTokens, outputTokens, totalTokens];
  const observedCount = observedCounts.filter((count) => count !== null).length;

  const disposition =
    observedCount === 0
      ? ("unavailable" as const)
      : inputTokens !== null && outputTokens !== null
        ? ("observed" as const)
        : ("partially-observed" as const);

  if (disposition === "unavailable") {
    return Object.freeze({
      usage: unavailableUsage(observation.providerUsage),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  return Object.freeze({
    usage: Object.freeze({
      disposition,
      inputTokens,
      outputTokens,
      totalTokens,
      cachedInputTokens,
      reasoningTokens,
      providerUsage: Object.freeze({ ...(observation.providerUsage ?? {}) }),
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Accepts a token count only as a non-negative integer. A string, a float, or
 * a negative number is provider testimony this contract cannot represent, so
 * it is reported and dropped rather than coerced.
 */
function readsTokenCount(
  value: unknown,
  path: string,
  diagnostics: NormalizationDiagnostic[]
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  diagnostics.push({
    code: "USAGE_TOKEN_COUNT_NOT_INTERPRETABLE",
    severity: "warning",
    path,
    message: `The provider reported a token count this contract cannot represent (${JSON.stringify(value)}). It was not projected.`,
  });

  return null;
}

function unavailableUsage(
  providerUsage?: Readonly<Record<string, unknown>>
): CanonicalUsage {
  return Object.freeze({
    disposition: "unavailable" as const,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
    reasoningTokens: null,
    providerUsage: Object.freeze({ ...(providerUsage ?? {}) }),
  });
}
