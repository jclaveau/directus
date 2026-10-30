Feature: A single user's password is checked against the password policy

  - The password policy is a setting every user shares: the feature puts it
    back as it found it once its scenarios ran.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario. A response cell states the keys it checks.

  Scenario: a user created with a password the policy refuses is not written
    Given these requests are sent:
      | request                            | response  |
      | method: PATCH                      | code: 200 |+
      | path: /settings                    |           |
      | payload:                           |           |
      |   auth_password_policy: /^.{30,}$/ |           |
    Then these requests get these responses:
      | request                                    | response                         |
      | method: POST                               | code: 400                        |+
      | path: /users                               | body:                            |
      | payload:                                   |   errors:                        |
      |   first_name: short-<run>                  |     - message: >-                |
      |   email: short-<run>@example.com           |         Validation failed for    |
      |   password: too-short                      |         field "password". Value  |
      |                                            |         doesn't have the correct |
      |                                            |         format.                  |
      | method: GET                                | code: 200                        |+
      | path: /users                               | body:                            |
      | query:                                     |   data: []                       |
      |   fields: id                               |                                  |
      |   filter[first_name][_eq]: short-<run>     |                                  |
      | method: POST                               | code: 200                        |+
      | path: /users                               | body:                            |
      | payload:                                   |   data:                          |
      |   first_name: long-<run>                   |     first_name: long-<run>       |
      |   email: long-<run>@example.com            |                                  |
      |   password: long-enough-to-pass-the-policy |                                  |

  Scenario: a batch creating a user with an empty password is checked like a single create
    Given these requests are sent:
      | request                            | response  |
      | method: PATCH                      | code: 200 |+
      | path: /settings                    |           |
      | payload:                           |           |
      |   auth_password_policy: /^.{30,}$/ |           |
    Then these requests get these responses:
      | request                                | response                         |
      | method: POST                           | code: 400                        |+
      | path: /users                           | body:                            |
      | payload:                               |   errors:                        |
      |   - first_name: empty-<run>            |     - message: >-                |
      |     email: empty-<run>@example.com     |         Validation failed for    |
      |     password: ''                       |         field "password". Value  |
      |                                        |         doesn't have the correct |
      |                                        |         format.                  |
      | method: GET                            | code: 200                        |+
      | path: /users                           | body:                            |
      | query:                                 |   data: []                       |
      |   fields: id                           |                                  |
      |   filter[first_name][_eq]: empty-<run> |                                  |

  Scenario: a reset to a password the policy refuses leaves the token usable
    Given these requests are sent:
      | request                          | response  |
      | method: PATCH                    | code: 200 |+
      | path: /settings                  |           |
      | payload:                         |           |
      |   auth_password_policy: ^.{30,}$ |           |
      | method: POST                     | code: 200 |+
      | path: /users                     |           |
      | payload:                         |           |
      |   email: reset-<run>@example.com |           |
    Then these requests get these responses:
      | request                                    | response                         |
      | method: POST                               | code: 400                        |+
      | path: /auth/password/reset                 | body:                            |
      | payload:                                   |   errors:                        |
      |   token: !jwt                              |     - message: >-                |
      |     email: reset-<run>@example.com         |         Validation failed for    |
      |     scope: password-reset                  |         field "password". Value  |
      |     hash: 33c587                           |         doesn't have the correct |
      |   password: too-short                      |         format.                  |
      | method: POST                               | code: 204                        |+
      | path: /auth/password/reset                 |                                  |
      | payload:                                   |                                  |
      |   token: !jwt                              |                                  |
      |     email: reset-<run>@example.com         |                                  |
      |     scope: password-reset                  |                                  |
      |     hash: 33c587                           |                                  |
      |   password: long-enough-to-pass-the-policy |                                  |

