import type {
  NormalizationFailure,
  NormalizeProviderResponseContext,
  ProviderResponseAdapter,
} from "../shared/response-normalizer-contract.js";

/**
 * Chooses the one adapter authorized to project this response.
 *
 * Ambiguity is a rejection, never a silent pick. If two adapters both claim a
 * response, the capability cannot say whose testimony it is projecting, so it
 * declines rather than guessing.
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
      (adapterId === undefined || adapterId === "" || adapter.adapterId === adapterId)
  );

  if (declared.length === 0) {
    return rejects(
      "PROVIDER_ADAPTER_NOT_FOUND",
      `No authorized adapter is declared for provider "${providerId}"${
        adapterId ? ` and adapter "${adapterId}"` : ""
      }.`,
      "/providerAuthority"
    );
  }

  if (declared.length > 1) {
    return rejects(
      "PROVIDER_ADAPTER_AMBIGUOUS",
      `${declared.length} adapters claim provider "${providerId}": ${declared
        .map((adapter) => adapter.adapterId)
        .join(", ")}. Exactly one must be authorized.`,
      "/providerAuthority"
    );
  }

  const adapter = declared[0] as ProviderResponseAdapter;
  const recognition = adapter.recognizes(context.rawResponse);

  if (!recognition.recognized) {
    return rejects(
      "PROVIDER_RESPONSE_NOT_RECOGNIZED",
      `The adapter "${adapter.adapterId}" does not recognize the provider response: ${recognition.detail}`,
      "/rawResponse"
    );
  }

  return Object.freeze({ resolved: true as const, adapter });
}

function rejects(
  code: NormalizationFailure["code"],
  detail: string,
  pointer: string
): AdapterResolution {
  return Object.freeze({
    resolved: false as const,
    failure: Object.freeze({ code, detail, pointer }),
  });
}
