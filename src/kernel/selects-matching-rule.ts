import { satisfiesDeclaredPredicate, type DeclaredPredicate } from "./reads-declared-path.js";

/**
 * KERNEL — generic predicate-rule selection.
 *
 * Returns the first rule whose declared predicates all hold, or null when none
 * do. It knows how to evaluate a predicate; it does not know what any rule
 * means.
 */

export type PredicateRule = Readonly<{
  ruleId: string;
  when: readonly DeclaredPredicate[];
}>;

export function selectsFirstMatchingRule<TRule extends PredicateRule>(
  rules: readonly TRule[],
  value: unknown,
  root: unknown
): TRule | null {
  return (
    rules.find((rule) =>
      rule.when.every((predicate) =>
        satisfiesDeclaredPredicate(predicate, value, root)
      )
    ) ?? null
  );
}
