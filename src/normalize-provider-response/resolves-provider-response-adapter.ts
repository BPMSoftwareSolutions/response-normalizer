import { readsDeclaredDecision } from "../adapters/reads-authority-documents.js";
import { resolvesDeclaredDecision } from "../kernel/resolves-declared-decision.js";
import type {
  NormalizationFailure,
  NormalizeProviderResponseContext,
  ProviderResponseAdapter,
} from "../shared/response-normalizer-contract.js";

/**
 * Chooses the one adapter authorized to project this response.
 *
 * Whether zero, one, or several declared adapters constitutes an authorization
 * is decided by resolve-adapter-resolution, not here. This body observes the
 * facts and reports what that decision returned.
 */

export type AdapterResolution =
  | Readonly<{ resolved: true; adapter: ProviderResponseAdapter }>
  | Readonly<{ resolved: false; failure: NormalizationFailure }>;

export function resolvesProviderResponseAdapter(
  context: NormalizeProviderResponseContext,
  adapters: readonly ProviderResponseAdapter[]
): AdapterResolution {
  const { providerId, adapterId } = context.providerAuthority;

  const declared = adapters.filter(
    (adapter) =>
      adapter.providerId === providerId &&
      [undefined, "", adapter.adapterId].includes(adapterId)
  );

  const candidate = declared[0];
  const recognition = candidate?.recognizes(context.rawResponse);

  const outcome = resolvesDeclaredDecision(
    readsDeclaredDecision("resolve-adapter-resolution"),
    {
      declaredAdapterCount: declared.length,
      multipleAdaptersDeclared: declared.length > 1,
      responseRecognized: recognition?.recognized === true,
    }
  ).outcome;

  const detail = DETAILS[outcome]?.({
    providerId,
    adapterId,
    declared,
    recognitionDetail:
      recognition?.recognized === false ? recognition.detail : "",
  });

  return outcome === ADAPTER_RESOLVED
    ? Object.freeze({
        resolved: true as const,
        adapter: candidate as ProviderResponseAdapter,
      })
    : Object.freeze({
        resolved: false as const,
        failure: Object.freeze({
          code: outcome as NormalizationFailure["code"],
          detail: detail ?? "No authorized adapter could be resolved.",
          pointer: POINTERS[outcome] ?? "/providerAuthority",
        }),
      });
}

const ADAPTER_RESOLVED = "adapter-resolved";

type DetailFacts = Readonly<{
  providerId: string;
  adapterId: string;
  declared: readonly ProviderResponseAdapter[];
  recognitionDetail: string;
}>;

/** Human-readable testimony for each declared outcome. */
const DETAILS: Readonly<Record<string, (facts: DetailFacts) => string>> =
  Object.freeze({
    PROVIDER_ADAPTER_NOT_FOUND: ({ providerId, adapterId }) =>
      `No authorized adapter is declared for provider "${providerId}"${
        adapterId ? ` and adapter "${adapterId}"` : ""
      }.`,
    PROVIDER_ADAPTER_AMBIGUOUS: ({ providerId, declared }) =>
      `${declared.length} adapters claim provider "${providerId}": ${declared
        .map((adapter) => adapter.adapterId)
        .join(", ")}. Exactly one must be authorized.`,
    PROVIDER_RESPONSE_NOT_RECOGNIZED: ({ declared, recognitionDetail }) =>
      `The adapter "${declared[0]?.adapterId}" does not recognize the provider response: ${recognitionDetail}`,
  });

const POINTERS: Readonly<Record<string, string>> = Object.freeze({
  PROVIDER_ADAPTER_NOT_FOUND: "/providerAuthority",
  PROVIDER_ADAPTER_AMBIGUOUS: "/providerAuthority",
  PROVIDER_RESPONSE_NOT_RECOGNIZED: "/rawResponse",
});
