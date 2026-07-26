import type {
  ArgumentsDisposition,
  CanonicalContent,
  CanonicalContentSegment,
  CanonicalStructuredOutput,
  CanonicalToolCall,
  NormalizationDiagnostic,
  NormalizationPolicy,
} from "../shared/response-normalizer-contract.js";

/**
 * Provider-neutral content assembly.
 *
 * Adapters decide what a segment *is* in their dialect. This module decides
 * how segments become the canonical content region, identically for every
 * provider.
 */

export type SegmentDraft = Readonly<{
  kind: CanonicalContentSegment["kind"];
  text?: string;
  toolCall?: CanonicalToolCall;
  raw?: unknown;
}>;

export type ContentProjection = Readonly<{
  content: CanonicalContent;
  diagnostics: readonly NormalizationDiagnostic[];
}>;

/**
 * Assembles segments in provider order and derives the convenience
 * projections. Order is never re-sorted: the index is assigned from the
 * position the provider used.
 */
export function projectsCanonicalContent(
  drafts: readonly SegmentDraft[],
  structuredOutput: CanonicalStructuredOutput | null,
  policy: NormalizationPolicy
): ContentProjection {
  const diagnostics: NormalizationDiagnostic[] = [];

  const segments: CanonicalContentSegment[] = drafts.map((draft, position) => {
    const segment: {
      index: number;
      kind: CanonicalContentSegment["kind"];
      text?: string;
      toolCall?: CanonicalToolCall;
      raw?: unknown;
    } = {
      index: position,
      kind: draft.kind,
    };

    if (draft.text !== undefined) {
      segment.text = draft.text;
    }

    if (draft.toolCall !== undefined) {
      segment.toolCall = draft.toolCall;
    }

    if (draft.raw !== undefined) {
      segment.raw = draft.raw;
    }

    if (draft.kind === "unsupported") {
      diagnostics.push({
        code: "UNSUPPORTED_CONTENT_SEGMENT_PRESERVED",
        severity: "warning",
        path: `$.content.segments[${position}]`,
        message:
          "The provider returned a content segment this contract version does not model. It was preserved verbatim.",
      });
    }

    return Object.freeze(segment);
  });

  // combinedText carries textual segments only. A tool call is not prose and
  // must never be flattened into the text a downstream consumer reads.
  const combinedText = policy.content.combineTextSegments
    ? segments
        .filter((segment) => segment.kind === "text")
        .map((segment) => segment.text ?? "")
        .join("")
    : (segments.find((segment) => segment.kind === "text")?.text ?? "");

  const toolCalls = segments
    .filter((segment) => segment.kind === "tool-call" && segment.toolCall)
    .map((segment) => segment.toolCall as CanonicalToolCall);

  return Object.freeze({
    content: Object.freeze({
      segments: Object.freeze(segments),
      combinedText,
      structuredOutput,
      toolCalls: Object.freeze(toolCalls),
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}

export type ToolCallDraft = Readonly<{
  callId: string;
  toolName: string;
  argumentsText: string | null;
  /** Set when the provider already supplies arguments as a parsed value. */
  providerParsedArguments?: unknown;
}>;

export type ToolCallProjection = Readonly<{
  toolCall: CanonicalToolCall;
  diagnostics: readonly NormalizationDiagnostic[];
}>;

/**
 * Projects one tool call. Malformed argument text is preserved exactly as the
 * provider sent it and reported as `invalid-json` — it is never repaired and
 * never dropped.
 */
export function projectsToolCall(
  draft: ToolCallDraft,
  policy: NormalizationPolicy,
  path: string
): ToolCallProjection {
  const diagnostics: NormalizationDiagnostic[] = [];

  const argumentsText = policy.toolCalls.retainArgumentsText
    ? draft.argumentsText
    : null;

  let parsedArguments: unknown = null;
  let argumentsDisposition: ArgumentsDisposition;

  if (draft.providerParsedArguments !== undefined) {
    parsedArguments = draft.providerParsedArguments;
    argumentsDisposition = "parsed";
  } else if (draft.argumentsText === null || draft.argumentsText === undefined) {
    argumentsDisposition = "absent";
  } else if (!policy.toolCalls.parseArguments) {
    argumentsDisposition = "absent";
  } else {
    try {
      parsedArguments = JSON.parse(draft.argumentsText);
      argumentsDisposition = "parsed";
    } catch {
      parsedArguments = null;
      argumentsDisposition = "invalid-json";

      diagnostics.push({
        code: "TOOL_CALL_ARGUMENTS_PARSE_FAILED",
        severity: "error",
        path,
        message:
          "The tool call arguments could not be parsed as JSON. The original text was preserved.",
      });
    }
  }

  return Object.freeze({
    toolCall: Object.freeze({
      callId: draft.callId,
      toolName: draft.toolName,
      argumentsText,
      arguments: parsedArguments,
      argumentsDisposition,
    }),
    diagnostics: Object.freeze(diagnostics),
  });
}

export type StructuredOutputProjection = Readonly<{
  structuredOutput: CanonicalStructuredOutput;
  diagnostics: readonly NormalizationDiagnostic[];
}>;

/**
 * Projects the structured-output region.
 *
 * Text is parsed as JSON only when the caller declared structured output and
 * policy authorizes it. A parse failure is reported, never corrected.
 */
export function projectsStructuredOutput(
  options: Readonly<{
    providerNativeValue?: unknown;
    textContent: string;
    structuredOutputRequested: boolean;
    policy: NormalizationPolicy;
  }>
): StructuredOutputProjection {
  const { providerNativeValue, textContent, structuredOutputRequested, policy } =
    options;

  const diagnostics: NormalizationDiagnostic[] = [];

  if (providerNativeValue !== undefined) {
    return Object.freeze({
      structuredOutput: Object.freeze({
        disposition: "provider-native" as const,
        value: providerNativeValue,
        source: "provider-structured-output" as const,
      }),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  const mayParseText =
    policy.structuredOutput.parseTextAsJson === "always" ||
    (policy.structuredOutput.parseTextAsJson === "only-when-declared" &&
      structuredOutputRequested);

  if (!mayParseText) {
    return Object.freeze({
      structuredOutput: Object.freeze({
        disposition: structuredOutputRequested
          ? ("not-present" as const)
          : ("not-requested" as const),
        value: null,
        source: null,
      }),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  if (textContent.trim() === "") {
    return Object.freeze({
      structuredOutput: Object.freeze({
        disposition: "not-present" as const,
        value: null,
        source: null,
      }),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  try {
    return Object.freeze({
      structuredOutput: Object.freeze({
        disposition: "parsed" as const,
        value: JSON.parse(textContent),
        source: "text-content" as const,
      }),
      diagnostics: Object.freeze(diagnostics),
    });
  } catch {
    diagnostics.push({
      code: "STRUCTURED_OUTPUT_PARSE_FAILED",
      severity: "error",
      path: "$.content",
      message:
        "The declared structured output could not be parsed as JSON.",
    });

    return Object.freeze({
      structuredOutput: Object.freeze({
        disposition: "invalid-json" as const,
        value: null,
        source: "text-content" as const,
      }),
      diagnostics: Object.freeze(diagnostics),
    });
  }
}
