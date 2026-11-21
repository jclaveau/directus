Feature: A write on one instance drops the reads a peer instance cached

  - A user's memberships decide what it may read, and a response key names the
    user, not its roles: a membership written on one instance has to drop the
    reads every instance cached for that user (#746).
  - Each instance clears its own response cache on a write and tells the
    others to clear theirs, whatever path wrote: `PATCH /users`, an extension
    calling RoleMembersService, an item write.
  - `POST /role-members-delete/delete-one` deletes a membership through
    RoleMembersService, as an extension or a flow script does.
  - The feature runs two instances on one database and one bus, each with
    its own response cache in memory, as a deployment without a shared
    response store runs them. A row sent `on: peer` goes to the second one.
  - A Given states the database rows and the cached reads a scenario starts
    from; the rows are written straight into the database. A user's role is a
    `directus_role_members` row.
  - A request authenticates as the admin, unless it names the token it sends
    `as`. `<run>` stands for a value unique to the scenario, and any other
    `<name>` for a uuid of its own. A response cell states the keys it checks.

  Scenario: a role taken away on one instance ends the read the peer cached
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection                  | action | fields |
      | <reader-policy> | cache_membership_peer_notes | read   | *      |
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
    And the rows of cache_membership_peer_notes:
      | id     | label |
      | <note> | v1    |
    And this read is cached:
      | request                                  | response              |
      | on: peer                                 | code: 200             |+
      | as: member-<run>                         | headers:              |
      | method: GET                              |   x-cache-status: HIT |
      | path: /items/cache_membership_peer_notes | body:                 |
      | query:                                   |   data:               |
      |   fields: label                          |     - label: v1       |
    Then these requests get these responses:
      | request                                  | response  |
      | method: PATCH                            | code: 200 |+
      | path: /users/<member>                    |           |
      | payload:                                 |           |
      |   roles:                                 |           |
      |     - role: <other-role>                 |           |
      | on: peer                                 | code: 403 |+
      | as: member-<run>                         |           |
      | method: GET                              |           |
      | path: /items/cache_membership_peer_notes |           |
      | query:                                   |           |
      |   fields: label                          |           |

  Scenario: a membership an extension deletes on one instance ends the peer read
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection                  | action | fields |
      | <reader-policy> | cache_membership_peer_notes | read   | *      |
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
    And the rows of cache_membership_peer_notes:
      | id     | label |
      | <note> | v1    |
    And this read is cached:
      | request                                  | response              |
      | on: peer                                 | code: 200             |+
      | as: member-<run>                         | headers:              |
      | method: GET                              |   x-cache-status: HIT |
      | path: /items/cache_membership_peer_notes | body:                 |
      | query:                                   |   data:               |
      |   fields: label                          |     - label: v1       |
    Then these requests get these responses:
      | request                                  | response                 |
      | method: POST                             | code: 200                |+
      | path: /role-members-delete/delete-one    | body:                    |
      | payload:                                 |   deleted: <membership>  |
      |   membership: <membership>               |                          |
      | on: peer                                 | code: 403                |+
      | as: member-<run>                         |                          |
      | method: GET                              |                          |
      | path: /items/cache_membership_peer_notes |                          |
      | query:                                   |                          |
      |   fields: label                          |                          |

  Scenario: an item written on one instance ends the read the peer cached
    Given the rows of cache_membership_peer_notes:
      | id     | label |
      | <note> | v1    |
    And this read is cached:
      | request                                         | response              |
      | on: peer                                        | code: 200             |+
      | method: GET                                     | headers:              |
      | path: /items/cache_membership_peer_notes/<note> |   x-cache-status: HIT |
      | query:                                          | body:                 |
      |   fields: label                                 |   data:               |
      |                                                 |     label: v1         |
    Then these requests get these responses:
      | request                                         | response               |
      | method: PATCH                                   | code: 200              |+
      | path: /items/cache_membership_peer_notes/<note> | body:                  |
      | payload:                                        |   data:                |
      |   label: v2                                     |     label: v2          |
      | on: peer                                        | code: 200              |+
      | method: GET                                     | headers:               |
      | path: /items/cache_membership_peer_notes/<note> |   x-cache-status: MISS |
      | query:                                          | body:                  |
      |   fields: label                                 |   data:                |
      |                                                 |     label: v2          |
