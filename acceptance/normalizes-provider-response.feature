Feature: Normalize provider responses

  The response normalizer projects provider-specific testimony
  into one canonical model-response contract without inventing
  or discarding material execution facts.

  Scenario: Normalize a completed text response
    Given an authorized provider response adapter
    And a provider response containing completed text
    When the provider response is normalized
    Then the result disposition is "normalized"
    And the canonical response contains the provider text
    And the canonical finish disposition is "completed"
    And the original provider finish reason is preserved
    And the raw provider response hash is recorded

  Scenario: Preserve multiple content segments in provider order
    Given a provider response containing multiple content segments
    When the provider response is normalized
    Then every supported segment is projected
    And the segment order matches the provider response
    And the combined text contains only textual segments

  Scenario: Normalize a provider tool call
    Given a provider response containing a tool call
    When the provider response is normalized
    Then the canonical response contains the tool-call identifier
    And the canonical response contains the tool name
    And the original tool arguments text is preserved
    And parsed arguments are included when parsing succeeds

  Scenario: Preserve malformed tool arguments
    Given a provider response containing malformed tool arguments
    When the provider response is normalized
    Then the tool arguments text is preserved
    And the parsed arguments are absent
    And the arguments disposition is "invalid-json"
    And a normalization diagnostic is recorded

  Scenario: Normalize observed token usage
    Given a provider response containing token usage testimony
    When the provider response is normalized
    Then the observed token counts are projected
    And the usage disposition is "observed"
    And no estimated values are introduced

  Scenario: Report unavailable token usage
    Given a provider response without token usage testimony
    When the provider response is normalized
    Then the usage disposition is "unavailable"
    And all unavailable token values are null

  Scenario: Preserve a provider refusal
    Given a provider response containing an explicit refusal
    When the provider response is normalized
    Then the refusal is present in the canonical response
    And the canonical disposition is "refused"
    And the provider refusal category is preserved

  Scenario: Preserve a provider safety block
    Given a provider response blocked by a provider safety mechanism
    When the provider response is normalized
    Then the canonical disposition is "safety-blocked"
    And the provider safety signals are preserved
    And the response is not represented as successfully completed

  Scenario: Reject an unsupported provider response
    Given no authorized adapter recognizes the provider response
    When normalization is attempted
    Then the result disposition is "rejected"
    And the failure code is "PROVIDER_RESPONSE_NOT_RECOGNIZED"
    And no canonical response is fabricated

  Scenario: Reject an invalid canonical projection
    Given a provider adapter produces a projection
    And the projection violates the canonical response contract
    When normalization is completed
    Then the result disposition is "rejected"
    And the failure code is "CANONICAL_PROJECTION_INVALID"

  Scenario: Produce byte-stable normalized output
    Given the same provider response
    And the same normalization authority
    When normalization is executed multiple times
    Then the semantic canonical response is identical
    And deterministic fields are byte-stable

  Scenario: Collapse provider dialects into one contract
    Given equivalent responses from two different providers
    When each provider response is normalized
    Then both canonical responses carry the same disposition
    And both canonical responses carry the same combined text
    And each canonical response preserves its own provider provenance
