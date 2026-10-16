Feature: An invitation, a registration and a reset carry a URL on the allow list

  - The feature runs against an instance of its own whose allow lists hold
    `https://allowed.test/accept` for invitations,
    `https://allowed.test/verify` for registrations and
    `https://allowed.test/reset` for password resets. A URL is allowed when
    its origin and path match an entry, whatever its query.
  - Mails are sent without being awaited, so a scenario reads the user it
    writes, never the mail.
  - Public registration is a setting every user shares: the feature puts the
    registration settings back as it found them once its scenarios ran.
    Registration is rate limited per IP, so each one names its own
    `X-Forwarded-For`.
  - A request authenticates as the admin. `<run>` stands for a value unique
    to the scenario, and any other `<name>` for a uuid of its own. A response
    cell states the keys it checks.

  Scenario: an invitation to an allowed URL creates the invited user
    Given these requests are sent:
      | request               | response  |
      | method: POST          | code: 200 |+
      | path: /roles          |           |
      | payload:              |           |
      |   id: <invitee-role>  |           |
      |   name: invitee-<run> |           |
    Then these requests get these responses:
      | request                                  | response                   |
      | method: POST                             | code: 204                  |+
      | path: /users/invite                      |                            |
      | payload:                                 |                            |
      |   email: allowed-<run>@example.com       |                            |
      |   role: <invitee-role>                   |                            |
      |   invite_url: >-                         |                            |
      |     https://allowed.test/accept?via=mail |                            |
      | method: GET                              | code: 200                  |+
      | path: /users                             | body:                      |
      | query:                                   |   data:                    |
      |   fields: status,role                    |     - status: invited      |
      |   filter[email][_eq]: >-                 |       role: <invitee-role> |
      |     allowed-<run>@example.com            |                            |

  Scenario: an invited user invited again to the same role stays as they were
    Given these requests are sent:
      | request                          | response  |
      | method: POST                     | code: 200 |+
      | path: /roles                     |           |
      | payload:                         |           |
      |   id: <same-role>                |           |
      |   name: same-<run>               |           |
      | method: POST                     | code: 204 |+
      | path: /users/invite              |           |
      | payload:                         |           |
      |   email: again-<run>@example.com |           |
      |   role: <same-role>              |           |
    Then these requests get these responses:
      | request                          | response                |
      | method: POST                     | code: 204               |+
      | path: /users/invite              |                         |
      | payload:                         |                         |
      |   email: again-<run>@example.com |                         |
      |   role: <same-role>              |                         |
      | method: POST                     | code: 204               |+
      | path: /users/invite              |                         |
      | payload:                         |                         |
      |   email: again-<run>@example.com |                         |
      |   role: <same-role>              |                         |
      |   invite_url: >-                 |                         |
      |     https://allowed.test/accept  |                         |
      | method: GET                      | code: 200               |+
      | path: /users                     | body:                   |
      | query:                           |   data:                 |
      |   fields: status,role            |     - status: invited   |
      |   filter[email][_eq]: >-         |       role: <same-role> |
      |     again-<run>@example.com      |                         |

  Scenario: an invitation of an active user leaves the user as they were
    Given these requests are sent:
      | request                           | response  |
      | method: POST                      | code: 200 |+
      | path: /roles                      |           |
      | payload:                          |           |
      |   id: <kept-role>                 |           |
      |   name: kept-<run>                |           |
      | method: POST                      | code: 200 |+
      | path: /roles                      |           |
      | payload:                          |           |
      |   id: <offered-role>              |           |
      |   name: offered-<run>             |           |
      | method: POST                      | code: 200 |+
      | path: /users                      |           |
      | payload:                          |           |
      |   email: active-<run>@example.com |           |
      |   role: <kept-role>               |           |
    Then these requests get these responses:
      | request                           | response                |
      | method: POST                      | code: 204               |+
      | path: /users/invite               |                         |
      | payload:                          |                         |
      |   email: active-<run>@example.com |                         |
      |   role: <offered-role>            |                         |
      | method: GET                       | code: 200               |+
      | path: /users                      | body:                   |
      | query:                            |   data:                 |
      |   fields: status,role             |     - status: active    |
      |   filter[email][_eq]: >-          |       role: <kept-role> |
      |     active-<run>@example.com      |                         |

  Scenario: a registration needing no verification makes an active user
    Given these requests are sent:
      | request                                   | response  |
      | method: PATCH                             | code: 200 |+
      | path: /settings                           |           |
      | payload:                                  |           |
      |   public_registration: true               |           |
      |   public_registration_verify_email: false |           |
      |   public_registration_role: null          |           |
      |   public_registration_email_filter: null  |           |
    Then these requests get these responses:
      | request                           | response             |
      | method: POST                      | code: 204            |+
      | path: /users/register             |                      |
      | headers:                          |                      |
      |   X-Forwarded-For: 198.51.100.41  |                      |
      | payload:                          |                      |
      |   email: direct-<run>@example.com |                      |
      |   password: registered-password   |                      |
      |   first_name: direct-<run>        |                      |
      | method: GET                       | code: 200            |+
      | path: /users                      | body:                |
      | query:                            |   data:              |
      |   fields: status,role,first_name  |     - status: active |
      |   filter[email][_eq]: >-          |       role: null     |
      |     direct-<run>@example.com      |       first_name: >- |
      |                                   |         direct-<run> |
      | method: POST                      | code: 200            |+
      | path: /auth/login                 |                      |
      | payload:                          |                      |
      |   email: direct-<run>@example.com |                      |
      |   password: registered-password   |                      |

  Scenario: a registration to an allowed verification URL waits for it
    Given these requests are sent:
      | request                                  | response  |
      | method: PATCH                            | code: 200 |+
      | path: /settings                          |           |
      | payload:                                 |           |
      |   public_registration: true              |           |
      |   public_registration_verify_email: true |           |
      |   public_registration_role: null         |           |
      |   public_registration_email_filter: null |           |
    Then these requests get these responses:
      | request                             | response                 |
      | method: POST                        | code: 204                |+
      | path: /users/register               |                          |
      | headers:                            |                          |
      |   X-Forwarded-For: 198.51.100.42    |                          |
      | payload:                            |                          |
      |   email: verified-<run>@example.com |                          |
      |   password: registered-password     |                          |
      |   verification_url: >-              |                          |
      |     https://allowed.test/verify     |                          |
      | method: GET                         | code: 200                |+
      | path: /users                        | body:                    |
      | query:                              |   data:                  |
      |   fields: status                    |     - status: unverified |
      |   filter[email][_eq]: >-            |                          |
      |     verified-<run>@example.com      |                          |

  Scenario: a reset requested to an allowed URL is accepted
    Given these requests are sent:
      | request                              | response  |
      | method: POST                         | code: 200 |+
      | path: /users                         |           |
      | payload:                             |           |
      |   email: resetting-<run>@example.com |           |
    Then these requests get these responses:
      | request                              | response  |
      | method: POST                         | code: 204 |+
      | path: /auth/password/request         |           |
      | payload:                             |           |
      |   email: resetting-<run>@example.com |           |
      |   reset_url: >-                      |           |
      |     https://allowed.test/reset       |           |
