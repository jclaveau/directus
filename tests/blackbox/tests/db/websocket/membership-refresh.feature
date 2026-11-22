Feature: A socket hears what the roles its user holds now may read

  - A socket authenticates once, and its subscriptions read each event with
    the roles of its user. A membership change recomputes the roles of the
    sockets its user holds open, without closing them: the next event is
    read with the roles the user holds now (#746). A socket whose refresh
    fails is closed, told why: the roles it holds are no longer the user's.
  - A Given states the database rows a scenario starts from; the rows are
    written straight into the database. A user's role is a
    `directus_role_members` row. `<run>` stands for a value unique to the
    scenario, and any other `<name>` for a uuid of its own.
  - The member subscribes to the notes created in `test_ws_membership_notes`,
    reading their `label`, under the uid `notes`; through GraphQL, to
    `test_ws_membership_notes_mutated` with `event: create`. A GraphQL
    subscription drops an event its user may not read, telling nothing.
  - `roles-refresh-failure` fails the next read of a user's member roles, the
    read a refresh runs.
  - The member's logs socket subscribes to the `fatal` logs of
    `/websocket/logs`, which only an admin may read.
  - A membership change runs the `websocket.authenticate` filter again on
    each socket it let in, with the message and connection the socket
    authenticated with: the socket stays open, holding what the filter hands
    it now. A socket the filter refuses is closed, told why.
  - `ws-auth-narrow` is a `websocket.authenticate` filter: a socket
    authenticating with a token starting with `ws-auth-narrow-` holds only the
    first role of its user by `sort`, not every role the database gives it,
    and is refused when its user holds no role.
  - `ws-auth-tag` is a `websocket.authenticate` filter: a socket
    authenticating with a token starting with `ws-auth-tag-` holds every role
    of its user, as without the filter, and an ip the filter sets.

  Scenario: a role taken away ends what a socket opened before hears
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection               | action | fields |
      | <reader-policy> | test_ws_membership_notes | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <reader-role> | reader-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <reader-access> | <reader-role> | <reader-policy> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <member> | member-<run>@example.com | member-<run> |
    And the rows of directus_role_members:
      | id           | user     | role          | sort |
      | <membership> | <member> | <reader-role> | 1    |
    And the member's socket subscribed to the notes
    When the admin takes every role of the member away
    And the admin creates the note "after-<run>"
    Then the member's socket is refused the note
    And the member's socket heard of no note

  Scenario: a membership moved to another role ends what a socket opened before hears
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection               | action | fields |
      | <reader-policy> | test_ws_membership_notes | read   | *      |
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
    And the member's socket subscribed to the notes
    When the admin moves the membership of the member to the other role
    And the admin creates the note "after-<run>"
    Then the member's socket is refused the note
    And the member's socket heard of no note

  Scenario: a socket whose roles could not be refreshed is closed, told why
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection               | action | fields |
      | <reader-policy> | test_ws_membership_notes | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <reader-role> | reader-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <reader-access> | <reader-role> | <reader-policy> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <member> | member-<run>@example.com | member-<run> |
    And the rows of directus_role_members:
      | id           | user     | role          | sort |
      | <membership> | <member> | <reader-role> | 1    |
    And the member's socket subscribed to the notes
    And the next read of the member's roles fails
    When the admin takes every role of the member away
    Then the member's socket is told its roles could not be refreshed
    And the member's socket is closed

  Scenario: a GraphQL subscription opened before a role change reads with the new roles
    Given the rows of directus_policies:
      | id         | name      | app_access | admin_access |
      | <all-read> | all-<run> | false      | false        |
      | <ok-read>  | ok-<run>  | false      | false        |
    And the rows of directus_permissions:
      | policy     | collection               | action | fields | permissions            |
      | <all-read> | test_ws_membership_notes | read   | *      | {}                     |
      | <ok-read>  | test_ws_membership_notes | read   | *      | {"label":{"_eq":"ok"}} |
    And the rows of directus_roles:
      | id            | name         |
      | <reader-role> | reader-<run> |
      | <other-role>  | other-<run>  |
    And the rows of directus_access:
      | id           | role          | policy     |
      | <all-access> | <reader-role> | <all-read> |
      | <ok-access>  | <other-role>  | <ok-read>  |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <member> | member-<run>@example.com | member-<run> |
    And the rows of directus_role_members:
      | id           | user     | role          | sort |
      | <membership> | <member> | <reader-role> | 1    |
    And the member's GraphQL socket subscribed to the notes
    When the admin creates "early-1", "early-2"… until the member's GraphQL socket hears
    And the admin moves the membership of the member to the other role
    And the admin creates the notes "hidden" and "ok"
    Then the next note the member's GraphQL socket heard is "ok"

  Scenario: a logs socket whose user is no longer an admin is refused the logs
    Given the rows of directus_policies:
      | id             | name        | app_access | admin_access |
      | <admin-policy> | admin-<run> | true       | true         |
    And the rows of directus_roles:
      | id           | name        |
      | <admin-role> | admin-<run> |
    And the rows of directus_access:
      | id             | role         | policy         |
      | <admin-access> | <admin-role> | <admin-policy> |
    And the rows of directus_users:
      | id       | email                    | token        |
      | <member> | member-<run>@example.com | member-<run> |
    And the rows of directus_role_members:
      | id           | user     | role         | sort |
      | <membership> | <member> | <admin-role> | 1    |
    And the member's logs socket subscribed to the logs
    When the admin takes every role of the member away
    Then the member's logs socket is told it may no longer read the logs
    And the member's logs socket is refused the logs it subscribes to again

  Scenario: an admin takes from a member the only role a filter left their socket
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection               | action | fields |
      | <reader-policy> | test_ws_membership_notes | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <other-role>  | other-<run>  |
      | <reader-role> | reader-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <reader-access> | <reader-role> | <reader-policy> |
    And the rows of directus_users:
      | id       | email                    | token                       |
      | <member> | member-<run>@example.com | ws-auth-narrow-member-<run> |
    And the rows of directus_role_members:
      | id                  | user     | role          | sort |
      | <membership>        | <member> | <other-role>  | 1    |
      | <reader-membership> | <member> | <reader-role> | 2    |
    And the member's socket authenticated through ws-auth-narrow
    When the admin takes the other role of the member away
    And the member's socket subscribes to the notes
    And the admin creates the note "after-<run>"
    Then the member's socket hears the note "after-<run>"

  Scenario: an admin takes every role from a member whose socket a filter then refuses
    Given the rows of directus_roles:
      | id            | name         |
      | <reader-role> | reader-<run> |
    And the rows of directus_users:
      | id       | email                    | token                       |
      | <member> | member-<run>@example.com | ws-auth-narrow-member-<run> |
    And the rows of directus_role_members:
      | id           | user     | role          | sort |
      | <membership> | <member> | <reader-role> | 1    |
    And the member's socket authenticated through ws-auth-narrow
    When the admin takes every role of the member away
    Then the member's socket is told the filter refused it
    And the member's socket is closed

  Scenario: an admin takes every role from a user whose socket a filter gave only an ip
    Given the rows of directus_policies:
      | id              | name         | app_access | admin_access |
      | <reader-policy> | reader-<run> | false      | false        |
    And the rows of directus_permissions:
      | policy          | collection               | action | fields |
      | <reader-policy> | test_ws_membership_notes | read   | *      |
    And the rows of directus_roles:
      | id            | name         |
      | <reader-role> | reader-<run> |
    And the rows of directus_access:
      | id              | role          | policy          |
      | <reader-access> | <reader-role> | <reader-policy> |
    And the rows of directus_users:
      | id       | email                    | token                    |
      | <member> | member-<run>@example.com | ws-auth-tag-member-<run> |
    And the rows of directus_role_members:
      | id           | user     | role          | sort |
      | <membership> | <member> | <reader-role> | 1    |
    And the member's socket subscribed to the notes through ws-auth-tag
    When the admin takes every role of the member away
    And the admin creates the note "after-<run>"
    Then the member's socket is refused the note
    And the member's socket heard of no note
