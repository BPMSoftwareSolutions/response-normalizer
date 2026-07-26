import {
  resolvesDeclaredDecision,
  UNRESOLVED_OUTCOME,
  type DeclaredDecision,
} from "./resolves-declared-decision.js";
import { readsDeclaredPath } from "./reads-declared-path.js";

/**
 * KERNEL — generic iteration engine.
 *
 * Executes declared iteration authority: read a collection at a declared path,
 * classify each item through a declared decision, and project each classified
 * item through the handler the classification names.
 *
 * The loop is machinery here, not meaning. This engine does not know what a
 * content part is or which part kinds exist; the iteration document declares
 * the collection, the classifier, and the per-classification handlers.
 */

export type DeclaredIteration = Readonly<{
  iterationId: string;
  collection: string;
  order?: "provider-declared-order";
  classifyWith?: DeclaredDecision;
  /** Classification outcome → handler name the caller supplies. */
  handlers?: Readonly<Record<string, string>>;
  unsupportedItemDisposition?: "preserve-with-diagnostic" | "ignore";
}>;

export type ClassifiedItem = Readonly<{
  index: number;
  item: unknown;
  classification: string;
  ruleId: string;
  handler: string | null;
  diagnostic?: Readonly<{
    code: string;
    severity: "info" | "warning" | "error";
    path: string;
    message: string;
  }>;
}>;

/**
 * Classifies every item in the declared collection, in declared order.
 *
 * Returning classified items rather than invoking handlers directly keeps this
 * engine free of any knowledge about what the handlers do.
 */
export function executesDeclaredIteration(
  iteration: DeclaredIteration,
  source: unknown,
  root: unknown = source
): readonly ClassifiedItem[] {
  const observed = readsDeclaredPath(iteration.collection, source, root);
  const items = Array.isArray(observed) ? observed : [];

  return Object.freeze(
    items.map((item, index) => classifiesItem(iteration, item, index, root))
  );
}

function classifiesItem(
  iteration: DeclaredIteration,
  item: unknown,
  index: number,
  _root: unknown
): ClassifiedItem {
  const resolution = iteration.classifyWith
    ? resolvesDeclaredDecision(iteration.classifyWith, item)
    : { outcome: UNRESOLVED_OUTCOME, ruleId: "__no-classifier__" };

  const classification =
    resolution.outcome === UNRESOLVED_OUTCOME
      ? UNSUPPORTED_CLASSIFICATION
      : resolution.outcome;

  const handler = iteration.handlers?.[classification] ?? null;

  return Object.freeze({
    index,
    item,
    classification,
    ruleId: resolution.ruleId,
    handler,
    ...("diagnostic" in resolution && resolution.diagnostic
      ? { diagnostic: resolution.diagnostic }
      : {}),
  });
}

/** Applied to an item no declared rule classified. */
export const UNSUPPORTED_CLASSIFICATION = "unsupported";
