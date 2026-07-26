import type {
  NormalizationDiagnostic,
  ResponseDisposition,
} from "../shared/response-normalizer-contract.js";
import { readsFinishDispositionDecision } from "./reads-authority-documents.js";

/**
 * Executes the declared finish-disposition decision table.
 *
 * The mapping itself lives in authority/finish-disposition.decision.v1.json.
 * This body evaluates the resolved authority; it does not own the mapping and
 * must not acquire provider knowledge of its own.
 */

export type FinishDispositionFacts = Readonly<{
  providerId: string;
  providerFinishReason: string | null;
  refusalPresent: boolean;
  safetyBlocked: boolean;
  toolCallsPresent: boolean;
}>;

export type FinishDispositionResolution = Readonly<{
  disposition: ResponseDisposition;
  ruleId: string;
  diagnostics: readonly NormalizationDiagnostic[];
}>;

export function resolvesFinishDisposition(
  facts: FinishDispositionFacts
): FinishDispositionResolution {
  const decision = readsFinishDispositionDecision();
  const caseInsensitive =
    decision.matching.providerFinishReason === "case-insensitive";

  for (const rule of decision.rules) {
    if (!satisfiesRule(rule.when, facts, caseInsensitive)) {
      continue;
    }

    return Object.freeze({
      disposition: rule.then,
      ruleId: rule.ruleId,
      diagnostics: Object.freeze(rule.diagnostic ? [rule.diagnostic] : []),
    });
  }

  // The authority document declares a terminal catch-all rule, so this is
  // reachable only if that rule were removed.
  return Object.freeze({
    disposition: "unknown" as const,
    ruleId: "no-matching-rule",
    diagnostics: Object.freeze([
      {
        code: "FINISH_DISPOSITION_DECISION_INCOMPLETE",
        severity: "warning" as const,
        path: "$.outcome.disposition",
        message:
          "No rule in the finish-disposition decision table matched the observed testimony.",
      },
    ]),
  });
}

type DecisionCondition = Readonly<{
  providerId?: string | null;
  providerFinishReason?: readonly string[] | null | "*";
  refusalPresent?: boolean;
  safetyBlocked?: boolean;
  toolCallsPresent?: boolean;
}>;

function satisfiesRule(
  condition: DecisionCondition,
  facts: FinishDispositionFacts,
  caseInsensitive: boolean
): boolean {
  if (
    condition.providerId !== undefined &&
    condition.providerId !== facts.providerId
  ) {
    return false;
  }

  if (
    condition.refusalPresent !== undefined &&
    condition.refusalPresent !== facts.refusalPresent
  ) {
    return false;
  }

  if (
    condition.safetyBlocked !== undefined &&
    condition.safetyBlocked !== facts.safetyBlocked
  ) {
    return false;
  }

  if (
    condition.toolCallsPresent !== undefined &&
    condition.toolCallsPresent !== facts.toolCallsPresent
  ) {
    return false;
  }

  if (condition.providerFinishReason !== undefined) {
    if (!satisfiesFinishReason(condition.providerFinishReason, facts, caseInsensitive)) {
      return false;
    }
  }

  return true;
}

function satisfiesFinishReason(
  expected: readonly string[] | null | "*",
  facts: FinishDispositionFacts,
  caseInsensitive: boolean
): boolean {
  if (expected === "*") {
    return true;
  }

  if (expected === null) {
    return facts.providerFinishReason === null;
  }

  const observed = facts.providerFinishReason;

  if (observed === null) {
    return false;
  }

  return expected.some((candidate) =>
    caseInsensitive
      ? candidate.toLowerCase() === observed.toLowerCase()
      : candidate === observed
  );
}
