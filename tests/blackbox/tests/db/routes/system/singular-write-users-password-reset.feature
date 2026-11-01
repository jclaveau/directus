Feature: A user requests a password reset and resets the password

  - The reset mail is sent without being awaited, so a scenario reads the
    user it writes, never the mail.
  - `!jwt` signs its claims with the instance's secret, as Directus signs the
    token it mails. A user created without a password holds a reset token
    whose `hash` is `33c587`, the hash Directus takes of a null password.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario. A response cell states the keys it checks.

  Scenario: a reset requested for an unknown user or a URL off the allow list
    Given these requests are sent:
      | request                               | response  |
      | method: POST                          | code: 200 |+
      | path: /users                          |           |
      | payload:                              |           |
      |   email: requesting-<run>@example.com |           |
    Then these requests get these responses:
      | request                               | response                               |
      | method: POST                          | code: 204                              |+
      | path: /auth/password/request          |                                        |
      | payload:                              |                                        |
      |   email: unknown-<run>@example.com    |                                        |
      | method: POST                          | code: 400                              |+
      | path: /auth/password/request          | body:                                  |
      | payload:                              |   errors:                              |
      |   email: requesting-<run>@example.com |     - message: >-                      |
      |   reset_url: >-                       |         Invalid payload. URL           |
      |     https://elsewhere.test/reset      |         "https://elsewhere.test/reset" |
      |                                       |         can't be used to reset         |
      |                                       |         passwords.                     |
      | method: POST                          | code: 204                              |+
      | path: /auth/password/request          |                                        |
      | payload:                              |                                        |
      |   email: requesting-<run>@example.com |                                        |

  Scenario: a reset token is refused for another scope or an inactive user
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /users                         |           |
      | payload:                             |           |
      |   email: suspended-<run>@example.com |           |
      |   status: suspended                  |           |
    Then these requests get these responses:
      | request                                | response                           |
      | method: POST                           | code: 403                          |+
      | path: /auth/password/reset             | body:                              |
      | payload:                               |   errors:                          |
      |   token: !jwt                          |     - message: >-                  |
      |     email: suspended-<run>@example.com |         Not a password reset token |
      |     scope: invite                      |                                    |
      |     hash: 33c587                       |                                    |
      |   password: reset-password             |                                    |
      | method: POST                           | code: 403                          |+
      | path: /auth/password/reset             | body:                              |
      | payload:                               |   errors:                          |
      |   token: !jwt                          |     - message: Inactive user       |
      |     email: suspended-<run>@example.com |                                    |
      |     scope: password-reset              |                                    |
      |     hash: 33c587                       |                                    |
      |   password: reset-password             |                                    |

  Scenario: a reset token sets the password once
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /users                         |           |
      | payload:                             |           |
      |   email: resetting-<run>@example.com |           |
    Then these requests get these responses:
      | request                                | response                            |
      | method: POST                           | code: 403                           |+
      | path: /auth/password/reset             | body:                               |
      | payload:                               |   errors:                           |
      |   token: !jwt                          |     - message: Bad user credentials |
      |     email: resetting-<run>@example.com |                                     |
      |     scope: password-reset              |                                     |
      |     hash: ffffff                       |                                     |
      |   password: reset-password             |                                     |
      | method: POST                           | code: 204                           |+
      | path: /auth/password/reset             |                                     |
      | payload:                               |                                     |
      |   token: !jwt                          |                                     |
      |     email: resetting-<run>@example.com |                                     |
      |     scope: password-reset              |                                     |
      |     hash: 33c587                       |                                     |
      |   password: reset-password             |                                     |
      | method: POST                           | code: 403                           |+
      | path: /auth/password/reset             | body:                               |
      | payload:                               |   errors:                           |
      |   token: !jwt                          |     - message: Bad user credentials |
      |     email: resetting-<run>@example.com |                                     |
      |     scope: password-reset              |                                     |
      |     hash: 33c587                       |                                     |
      |   password: second-password            |                                     |
      | method: POST                           | code: 200                           |+
      | path: /auth/login                      |                                     |
      | payload:                               |                                     |
      |   email: resetting-<run>@example.com   |                                     |
      |   password: reset-password             |                                     |
