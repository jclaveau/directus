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
    reading their `label`, under the uid `notes`.
  - `roles-refresh-failure` fails the next read of a user's member roles, the
    read a refresh runs.

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
