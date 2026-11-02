Feature: A visitor registers and verifies the email address

  - Public registration is a setting every user shares: the feature puts the
    registration settings back as it found them once its scenarios ran.
  - Registration is rate limited per IP, so each registration names its own
    `X-Forwarded-For`.
  - `!jwt` signs its claims with the instance's secret, as Directus signs the
    token it mails.
  - A request authenticates as the admin. `<run>` stands for a value unique to
    the scenario. A response cell states the keys it checks.

  Scenario: a registration is refused while public registration is off
    Given these requests are sent:
      | request                      | response  |
      | method: PATCH                | code: 200 |+
      | path: /settings              |           |
      | payload:                     |           |
      |   public_registration: false |           |
    Then these requests get these responses:
      | request                           | response                                |
      | method: POST                      | code: 400                               |+
      | path: /users/register             | body:                                   |
      | headers:                          |   errors:                               |
      |   X-Forwarded-For: 198.51.100.11  |     - message: >-                       |
      | payload:                          |         Invalid payload. URL            |
      |   email: off-<run>@example.com    |         "https://elsewhere.test/verify" |
      |   password: registered-password   |         can't be used to verify         |
      |   verification_url: >-            |         registered users.               |
      |     https://elsewhere.test/verify |                                         |
      | method: POST                      | code: 403                               |+
      | path: /users/register             | body:                                   |
      | headers:                          |   errors:                               |
      |   X-Forwarded-For: 198.51.100.12  |     - message: >-                       |
      | payload:                          |         Public registration is disabled |
      |   email: off-<run>@example.com    |                                         |
      |   password: registered-password   |                                         |
      | method: GET                       | code: 200                               |+
      | path: /users                      | body:                                   |
      | query:                            |   data: []                              |
      |   fields: id                      |                                         |
      |   filter[email][_eq]: >-          |                                         |
      |     off-<run>@example.com         |                                         |
    And on postgres the requests ran these statements:
      | request | table             | select | insert | update | delete |
      | 1       | directus_access   | 2      | 0      | 0      | 0      |
      | 1       | directus_users    | 1      | 0      | 0      | 0      |
      | 2       | directus_access   | 2      | 0      | 0      | 0      |
      | 2       | directus_settings | 1      | 0      | 0      | 0      |
      | 2       | directus_users    | 1      | 0      | 0      | 0      |

  Scenario: a registered user is active once the email address is verified
    Given these requests are sent:
      | request                                  | response  |
      | method: PATCH                            | code: 200 |+
      | path: /settings                          |           |
      | payload:                                 |           |
      |   public_registration: true              |           |
      |   public_registration_verify_email: true |           |
      |   public_registration_role: null         |           |
      |   public_registration_email_filter:      |           |
      |     email:                               |           |
      |       _ends_with: '@allowed.example.com' |           |
    Then these requests get these responses:
      | request                                  | response                           |
      | method: POST                             | code: 403                          |+
      | path: /users/register                    | body:                              |
      | headers:                                 |   errors:                          |
      |   X-Forwarded-For: 198.51.100.13         |     - message: Invalid payload     |
      | payload:                                 |                                    |
      |   email: refused-<run>@example.com       |                                    |
      |   password: registered-password          |                                    |
      | method: POST                             | code: 204                          |+
      | path: /users/register                    |                                    |
      | headers:                                 |                                    |
      |   X-Forwarded-For: 198.51.100.14         |                                    |
      | payload:                                 |                                    |
      |   email: new-<run>@allowed.example.com   |                                    |
      |   password: registered-password          |                                    |
      |   first_name: registered-<run>           |                                    |
      | method: POST                             | code: 204                          |+
      | path: /users/register                    |                                    |
      | headers:                                 |                                    |
      |   X-Forwarded-For: 198.51.100.15         |                                    |
      | payload:                                 |                                    |
      |   email: new-<run>@allowed.example.com   |                                    |
      |   password: registered-password          |                                    |
      | method: GET                              | code: 200                          |+
      | path: /users                             | body:                              |
      | query:                                   |   data:                            |
      |   fields: status,role                    |     - status: unverified           |
      |   filter[email][_eq]: >-                 |       role: null                   |
      |     new-<run>@allowed.example.com        |                                    |
      | method: GET                              | code: 403                          |+
      | path: /users/register/verify-email       | body:                              |
      |                                          |   errors:                          |
      |                                          |     - message: Invalid token.      |
      | method: GET                              | code: 403                          |+
      | path: /users/register/verify-email       | body:                              |
      | query:                                   |   errors:                          |
      |   token: ''                              |     - message: Invalid token.      |
      | method: GET                              | code: 403                          |+
      | path: >-                                 | body:                              |
      |   /users/register/verify-email?token[]=x |   errors:                          |
      |                                          |     - message: Invalid token.      |
      | method: GET                              | code: 403                          |+
      | path: /users/register/verify-email       | body:                              |
      | query:                                   |   errors:                          |
      |   token: !jwt                            |     - message: >-                  |
      |     email: new-<run>@allowed.example.com |         Not a pending              |
      |     scope: invite                        |         registration token         |
      | method: GET                              | code: 302                          |+
      | path: /users/register/verify-email       |                                    |
      | query:                                   |                                    |
      |   token: !jwt                            |                                    |
      |     email: new-<run>@allowed.example.com |                                    |
      |     scope: pending-registration          |                                    |
      | method: GET                              | code: 400                          |+
      | path: /users/register/verify-email       | body:                              |
      | query:                                   |   errors:                          |
      |   token: !jwt                            |     - message: >-                  |
      |     email: new-<run>@allowed.example.com |         Invalid payload. Invalid   |
      |     scope: pending-registration          |         verification code.         |
      | method: POST                             | code: 204                          |+
      | path: /users/register                    |                                    |
      | headers:                                 |                                    |
      |   X-Forwarded-For: 198.51.100.16         |                                    |
      | payload:                                 |                                    |
      |   email: new-<run>@allowed.example.com   |                                    |
      |   password: registered-password          |                                    |
      |   first_name: again-<run>                |                                    |
      | method: GET                              | code: 200                          |+
      | path: /users                             | body:                              |
      | query:                                   |   data:                            |
      |   fields: status,first_name              |     - status: active               |
      |   filter[email][_eq]: >-                 |       first_name: registered-<run> |
      |     new-<run>@allowed.example.com        |                                    |
    And on postgres the requests ran these statements:
      | request | table             | select | insert | update | delete |
      | 1       | directus_access   | 2      | 0      | 0      | 0      |
      | 1       | directus_settings | 1      | 0      | 0      | 0      |
      | 1       | directus_users    | 1      | 0      | 0      | 0      |
      | 2       | directus_access   | 2      | 0      | 0      | 0      |
      | 2       | directus_settings | 3      | 0      | 0      | 0      |
      | 2       | directus_users    | 3      | 1      | 0      | 0      |
      | 3       | directus_access   | 2      | 0      | 0      | 0      |
      | 3       | directus_settings | 2      | 0      | 0      | 0      |
      | 3       | directus_users    | 2      | 0      | 0      | 0      |
      | 11      | directus_access   | 2      | 0      | 0      | 0      |
      | 11      | directus_settings | 1      | 0      | 0      | 0      |
      | 11      | directus_users    | 2      | 0      | 0      | 0      |
