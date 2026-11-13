Feature: A cached GraphQL schema resolves through the request running it

  The GraphQL schema is cached per scope, role and user, and built by the first
  request of that key after a schema change. Every later request of that key
  reuses its resolvers, which record the reads of the request running them, so
  that request's response is cached, and run its mutations with that request's
  accountability.

  Every scenario creates the user it reads as, so the first request that user
  sends is the one that builds its schema.

  A read is stated as the GraphQL `query` it sends and the `response` it
  answers with, as YAML.

  Scenario: a user's second read is cached, and purged by a write to its row
    Given a user whose schema is built by this read, which is cached:
      | query                                               | response       |
      | {                                                   | request_state: |+
      |   request_state(filter: { slot: { _eq: "one" } }) { |   - label: one |
      |     label                                           |                |
      |   }                                                 |                |
      | }                                                   |                |
    And this read is cached:
      | query                                               | response       |
      | {                                                   | request_state: |+
      |   request_state(filter: { slot: { _eq: "two" } }) { |   - label: two |
      |     label                                           |                |
      |   }                                                 |                |
      | }                                                   |                |
    When the row in slot "two" is relabelled "two again"
    Then the read is purged, since the write changed the row it read:
      | query                                               | response             |
      | {                                                   | request_state:       |+
      |   request_state(filter: { slot: { _eq: "two" } }) { |   - label: two again |
      |     label                                           |                      |
      |   }                                                 |                      |
      | }                                                   |                      |
    And the read that built the schema is still cached, since its row is untouched:
      | query                                               | response       |
      | {                                                   | request_state: |+
      |   request_state(filter: { slot: { _eq: "one" } }) { |   - label: one |
      |     label                                           |                |
      |   }                                                 |                |
      | }                                                   |                |

  Scenario: a mutation records the user agent of the request that sent it
    Given a user whose schema is built by a read sent as "first-agent"
    When the user creates a row in slot "three" through GraphQL, sent as "second-agent"
    Then the activity of that row names "second-agent" as its user agent
