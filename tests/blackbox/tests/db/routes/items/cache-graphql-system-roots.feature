Feature: A /graphql/system read is filed under every root it resolved

  A /graphql/system query can mix a system root — `users_me`, `server_info` —
  with an item root such as `roles`. The item roots fold their read meta into the
  response through `GraphQLService.read()`; the system roots call their services
  directly and used to fold nothing, so the response was filed under the item
  root's fingerprints alone. A write to the system root's row then purged
  nothing, and `{ users_me { first_name } roles { id } }` kept serving the old
  name after PATCH /users/me.

  A system root whose value carries no read meta at all (`server_info`) records
  nothing a write could purge by, so a response resolving one is refused in
  scoped mode, the same as a query that pinned nothing.

  A read is stated as the `user` sending it, the GraphQL `query` it sends and the
  `response` it answers with, both as YAML; the response holds only the roots
  that carry the scenario's point. Every user is created by the scenario that
  reads as them: the GraphQL schema is cached per user, and its resolvers keep
  the service of the request that built it, so only a user's first request
  files the read meta it resolved.

  Every scenario states what the read answers once the write has landed, so a
  purge that never happened shows up as the stale body it served, and caches a
  witness read whose verdict tells a narrow purge from a flush.

  Scenario: renaming yourself purges a read mixing users_me with an item root
    Given the users:
      | marker  | first_name |
      | reader  | Ada        |
      | witness | Grace      |
    And this read is cached:
      | user   | query                       | response          |+
      | reader | >-                          | users_me:         |
      |        |   { users_me { first_name } |   first_name: Ada |
      |        |   roles { id } }            |                   |
    And the witness reads are cached:
      | user    | query                       | response            |+
      | witness | >-                          | users_me:           |
      |         |   { users_me { first_name } |   first_name: Grace |
      |         |   roles { id } }            |                     |
    When the users rename themselves:
      | marker | first_name |
      | reader | Augusta    |
    Then the read is purged, since the rename wrote the row users_me read:
      | user   | query                       | response              |+
      | reader | >-                          | users_me:             |
      |        |   { users_me { first_name } |   first_name: Augusta |
      |        |   roles { id } }            |                       |
    And the witness reads are still cached, since the rename wrote another row:
      | user    | query                       | response            |+
      | witness | >-                          | users_me:           |
      |         |   { users_me { first_name } |   first_name: Grace |
      |         |   roles { id } }            |                     |

  Scenario: a read resolving server_info is never cached
    Given the users:
      | marker  | first_name |
      | reader  | Ada        |
      | control | Grace      |
    And the project descriptor is "before"
    And this read is refused:
      | user   | query                      | response                       |+
      | reader | >-                         | server_info:                   |
      |        |   { server_info { project  |   project:                     |
      |        |   { project_descriptor } } |     project_descriptor: before |
      |        |   roles { id } }           |                                |
    And the witness reads are cached:
      | user    | query                       | response             |+
      | control | >-                          | roles:               |
      |         |   { roles(filter: { name: { |   - name: Admin Role |
      |         |   _eq: "Admin Role" } })    |                      |
      |         |   { name } }                |                      |
    When the project descriptor is changed to "after"
    Then the read is refused, since server_info pins nothing a write purges by:
      | user   | query                      | response                      |+
      | reader | >-                         | server_info:                  |
      |        |   { server_info { project  |   project:                    |
      |        |   { project_descriptor } } |     project_descriptor: after |
      |        |   roles { id } }           |                               |
    And the witness reads are still cached, since the write was to the settings:
      | user    | query                       | response             |+
      | control | >-                          | roles:               |
      |         |   { roles(filter: { name: { |   - name: Admin Role |
      |         |   _eq: "Admin Role" } })    |                      |
      |         |   { name } }                |                      |
