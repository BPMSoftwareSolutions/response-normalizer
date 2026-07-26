import { readsDeclaredPath } from "./reads-declared-path.js";

/**
 * KERNEL — generic decision-table engine.
 *
 * This engine knows how to evaluate a declared decision: match rule conditions
 * against observed facts in order, first match wins, return the declared
 * outcome and any declared diagnostic.
 *
 * It does not know that "STOP" means completed, that a missing token count
 * means unavailable, or that two adapters matching is ambiguous. Every such
 * meaning lives in a decision document under authority/decisions/.
 */

export type DeclaredCondition = Readonly<Record<string, unknown>>;

export type DeclaredRule = Readonly<{
  ruleId: string;
  when: DeclaredCondition;
  then: string;
  diagnostic?: Readonly<{
    code: string;
    severity: "info" | "warning" | "error";
    path: string;
    message: string;
  }>;
}>;

export type DeclaredDecision = Readonly<{
  decisionId: string;
  matching?: Readonly<{
    caseSensitive?: boolean;
    order?: "first-matching-rule-wins";
  }>;
  rules: readonly DeclaredRule[];
}>;

export type DecisionResolution = Readonly<{
  outcome: string;
  ruleId: string;
  diagnostic?: DeclaredRule["diagnostic"];
}>;

/**
 * Resolves one decision against observed facts.
 *
 * Facts are addressed by declared path, so a condition key may be a simple
 * name or a dotted path into a nested fact object.
 */
export function resolvesDeclaredDecision(
  decision: DeclaredDecision,
  facts: unknown
): DecisionResolution {
  const caseSensitive = decision.matching?.caseSensitive === true;

  const matched = decision.rules.find((rule) =>
    satisfiesCondition(rule.when, facts, caseSensitive)
  );

  return Object.freeze({
    outcome: matched?.then ?? UNRESOLVED_OUTCOME,
    ruleId: matched?.ruleId ?? UNRESOLVED_RULE_ID,
    ...(matched?.diagnostic ? { diagnostic: matched.diagnostic } : {}),
  });
}

/** Reported when a decision table declares no matching rule. */
export const UNRESOLVED_OUTCOME = "__unresolved__";
export const UNRESOLVED_RULE_ID = "__no-matching-rule__";

/**
 * Every declared key must hold. A key's value may be:
 *
 *   "*"            matches anything, the terminal catch-all
 *   null           matches only absent testimony
 *   [a, b, c]      matches any listed value
 *   true / false   matches the boolean fact
 *   "literal"      matches that exact value
 */
function satisfiesCondition(
  condition: DeclaredCondition,
  facts: unknown,
  caseSensitive: boolean
): boolean {
  return Object.entries(condition).every(([path, expected]) =>
    satisfiesExpectation(expected, readsDeclaredPath(path, facts, facts), caseSensitive)
  );
}

function satisfiesExpectation(
  expected: unknown,
  observed: unknown,
  caseSensitive: boolean
): boolean {
  const wildcardMatches = expected === "*";
  const absenceMatches =
    expected === null && (observed === null || observed === undefined);
  const listMatches =
    Array.isArray(expected) &&
    expected.some((candidate) => matchesValue(candidate, observed, caseSensitive));
  const literalMatches =
    !wildcardMatches &&
    expected !== null &&
    !Array.isArray(expected) &&
    matchesValue(expected, observed, caseSensitive);

  return wildcardMatches || absenceMatches || listMatches || literalMatches;
}

function matchesValue(
  expected: unknown,
  observed: unknown,
  caseSensitive: boolean
): boolean {
  const bothStrings = typeof expected === "string" && typeof observed === "string";

  const caseInsensitiveMatch =
    bothStrings &&
    !caseSensitive &&
    (expected as string).toLowerCase() === (observed as string).toLowerCase();

  return expected === observed || caseInsensitiveMatch;
}
