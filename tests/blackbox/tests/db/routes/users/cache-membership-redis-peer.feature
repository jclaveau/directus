Feature: A write on one instance alone clears the response store it shares

  - A user's memberships decide what it may read, and a response key names the
    user, not its roles: a membership written on one instance has to drop the
    reads every instance cached for that user (#746).
  - On a Redis response store every instance reads the same entries: the
    clears the writing instance runs are the ones they get, and it tells no
    other instance to clear again. A role change flushes three times, each
    flush clearing the store once.
  - The feature runs two instances on one database, one bus and one Redis
    response store, held in Redis database 9, which a clear flushes. A row
    sent `on: peer` goes to the second one. The Redis commands are the ones
    Redis ran while the requests ran, a key spelled past the namespace;
    `senders` counts the connections that sent them.
  - A Given states the database rows and the cached reads a scenario starts
    from; the rows are written straight into the database. A user's role is a
    `directus_role_members` row.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a role taken away on one instance clears the shared store from it alone
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection                        | action | fields |
      | <reader-policy> | cache_membership_redis_peer_notes | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <reader-role> | reader-<run> |
      | <other-role>  | other-<run>  |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <reader-access> | <reader-role> | <reader-policy> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <member> | member-<run>@example.com | member-<run> |
    And the rows of directus_role_members:
      | id           | user     | role          | sort |
      | <membership> | <member> | <reader-role> | 1    |
    And the rows of cache_membership_redis_peer_notes:
      | id     | label |
      | <note> | v1    |
    And this read is cached:
      | request                                               | response              |
      | on: peer                                              | code: 200             |+
      | as: member-<run>                                      | headers:              |
      | method: GET                                           |   x-cache-status: HIT |
      | path: /items/cache_membership_redis_peer_notes/<note> | body:                 |
      | query:                                                |   data:               |
      |   fields: label                                       |     label: v1         |
    Then these requests get these responses:
      | request                                               | response  |
      | method: PATCH                                         | code: 200 |+
      | path: /users/<member>                                 |           |
      | payload:                                              |           |
      |   roles:                                              |           |
      |     - role: <other-role>                              |           |
      | on: peer                                              | code: 403 |+
      | as: member-<run>                                      |           |
      | method: GET                                           |           |
      | path: /items/cache_membership_redis_peer_notes/<note> |           |
      | query:                                                |           |
      |   fields: label                                       |           |
    And the requests sent Redis these commands:
      | database | command | key              | calls | senders |
      | 9        | flushdb |                  | 3     | 1       |
      |          | publish | bus:cacheCleared | 0     | 0       |
