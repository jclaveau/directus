Feature: A manager seats a beneficiary by email, inviting whoever has no account

  - A request authenticates as the admin unless its `as` names a token.
  - The instance loads the real `@scalabus/subscriptions` bundle, and its Mollie
    client calls a fake one, answering what `holds` says.
  - `these pending subscriptions, each with its own plan` writes, for an `id` of
    171: the policy `<policy_171>`, the plan `plan-171` selling 10 EUR a month,
    and the subscription 171 pending at `provider`, which the user `<user_171>`
    (`lifecycle-171@example.com`, token `lifecycle-171-token`) manages and
    benefits from.
  - The instance sends its mails over SMTP to a mailbox the test reads;
    `the mailbox eventually holds these mails` lists every mail sent since the
    scenario began, `to` and `subject` of each.
  - A `<name>` stands for one uuid, the same in the tables and the requests; a
    `<name>` first met in a response takes the value found there.
  - `the CLI runs <arguments> with these variables` runs `directus <arguments>`
    against the instance's database, its env plus the variables listed.

  Scenario: an email with an account seats that user, no mail sent
    Given these pending subscriptions, each with its own plan:
      | id  | provider | manager | beneficiaries_max | plan_status |
      | 171 | mollie   | 171     | 2                 | active      |
    And the rows of directus_users:
      | id          | email                 |
      | <known_171> | known-171@example.com |
    And Mollie holds this subscription:
      | column                | value           |
      | payment               | tr_invites_171  |
      | customer              | cst_invites_171 |
      | subscription          | sub_invites_171 |
      | directus_subscription | 171             |
      | status                | active          |
    And Mollie sends these events:
      | type         | entity         |
      | payment.paid | tr_invites_171 |
    When these requests get these responses:
      | request                            | response  |
      | as: lifecycle-171-token            | code: 200 |+
      | method: POST                       |           |
      | path: /subscriptions/beneficiaries |           |
      | payload:                           |           |
      |   subscription: 171                |           |
      |   email: Known-171@Example.com     |           |
    Then the beneficiaries of subscription sub_invites_171 are eventually:
      | user        |
      | <user_171>  |
      | <known_171> |
    And this access is eventually stored:
      | user        | policy       | managed_by              |
      | <known_171> | <policy_171> | @scalabus/subscriptions |
    And the mailbox eventually holds these mails:
      | to | subject |

  Scenario: an email with no account invites a user, seated like any other
    Given these pending subscriptions, each with its own plan:
      | id  | provider | manager | beneficiaries_max | plan_status |
      | 172 | mollie   | 172     | 2                 | active      |
    And Mollie holds this subscription:
      | column                | value           |
      | payment               | tr_invites_172  |
      | customer              | cst_invites_172 |
      | subscription          | sub_invites_172 |
      | directus_subscription | 172             |
      | status                | active          |
    And Mollie sends these events:
      | type         | entity         |
      | payment.paid | tr_invites_172 |
    When these requests get these responses:
      | request                            | response  |
      | as: lifecycle-172-token            | code: 200 |+
      | method: POST                       |           |
      | path: /subscriptions/beneficiaries |           |
      | payload:                           |           |
      |   subscription: 172                |           |
      |   email: new-172@example.com       |           |
    Then the mailbox eventually holds these mails:
      | to                  | subject             |
      | new-172@example.com | You've been invited |
    And these requests get these responses:
      | request                                   | response                  |
      | method: GET                               | code: 200                 |+
      | path: /users                              | body:                     |
      | query:                                    |   data:                   |
      |   fields: id,status,role                  |     - id: <invited_172>   |
      |   filter[email][_eq]: new-172@example.com |       status: invited     |
      |                                           |       role: null          |
      | method: GET                               | code: 200                 |+
      | path: /items/subscription_invites         | body:                     |
      | query:                                    |   data:                   |
      |   fields: user                            |     - user: <invited_172> |
      |   filter[user][_eq]: <invited_172>        |                           |
    And the beneficiaries of subscription sub_invites_172 are eventually:
      | user          |
      | <user_172>    |
      | <invited_172> |
    And this access is eventually stored:
      | user          | policy       | managed_by              |
      | <invited_172> | <policy_172> | @scalabus/subscriptions |

  Scenario: an invited user seated again gets no second mail
    Given these pending subscriptions, each with its own plan:
      | id  | provider | manager | beneficiaries_max | plan_status |
      | 173 | mollie   | 173     | 2                 | active      |
    And the rows of directus_users:
      | id            | email                   | status  | role |
      | <invited_173> | invited-173@example.com | invited |      |
    And the rows of subscription_invites:
      | user          | date_sent  |
      | <invited_173> | 2099-01-01 |
    And Mollie holds this subscription:
      | column                | value           |
      | payment               | tr_invites_173  |
      | customer              | cst_invites_173 |
      | subscription          | sub_invites_173 |
      | directus_subscription | 173             |
      | status                | active          |
    And Mollie sends these events:
      | type         | entity         |
      | payment.paid | tr_invites_173 |
    When these requests get these responses:
      | request                            | response  |
      | as: lifecycle-173-token            | code: 200 |+
      | method: POST                       |           |
      | path: /subscriptions/beneficiaries |           |
      | payload:                           |           |
      |   subscription: 173                |           |
      |   email: invited-173@example.com   |           |
    Then the beneficiaries of subscription sub_invites_173 are eventually:
      | user          |
      | <user_173>    |
      | <invited_173> |
    And the mailbox eventually holds these mails:
      | to | subject |

  Scenario: a removed invitee keeps its user, and is seated again with no mail
    Given these pending subscriptions, each with its own plan:
      | id  | provider | manager | beneficiaries_max | plan_status |
      | 174 | mollie   | 174     | 2                 | active      |
    And Mollie holds this subscription:
      | column                | value           |
      | payment               | tr_invites_174  |
      | customer              | cst_invites_174 |
      | subscription          | sub_invites_174 |
      | directus_subscription | 174             |
      | status                | active          |
    And Mollie sends these events:
      | type         | entity         |
      | payment.paid | tr_invites_174 |
    And these requests get these responses:
      | request                                    | response                |
      | as: lifecycle-174-token                    | code: 200               |+
      | method: POST                               |                         |
      | path: /subscriptions/beneficiaries         |                         |
      | payload:                                   |                         |
      |   subscription: 174                        |                         |
      |   email: gone-174@example.com              |                         |
      | method: GET                                | code: 200               |+
      | path: /users                               | body:                   |
      | query:                                     |   data:                 |
      |   fields: id                               |     - id: <invited_174> |
      |   filter[email][_eq]: gone-174@example.com |                         |
    When these requests get these responses:
      | request                                 | response  |
      | method: DELETE                          | code: 204 |+
      | path: /items/subscription_beneficiaries |           |
      | payload:                                |           |
      |   query:                                |           |
      |     filter:                             |           |
      |       user:                             |           |
      |         _eq: <invited_174>              |           |
      | as: lifecycle-174-token                 | code: 200 |+
      | method: POST                            |           |
      | path: /subscriptions/beneficiaries      |           |
      | payload:                                |           |
      |   subscription: 174                     |           |
      |   email: gone-174@example.com           |           |
    Then the beneficiaries of subscription sub_invites_174 are eventually:
      | user          |
      | <user_174>    |
      | <invited_174> |
    And the mailbox eventually holds these mails:
      | to                   | subject             |
      | gone-174@example.com | You've been invited |

  Scenario: an invitee takes a seat of the plan's maximum
    Given these pending subscriptions, each with its own plan:
      | id  | provider | manager | beneficiaries_max | plan_status |
      | 175 | mollie   | 175     | 2                 | active      |
    And Mollie holds this subscription:
      | column                | value           |
      | payment               | tr_invites_175  |
      | customer              | cst_invites_175 |
      | subscription          | sub_invites_175 |
      | directus_subscription | 175             |
      | status                | active          |
    And Mollie sends these events:
      | type         | entity         |
      | payment.paid | tr_invites_175 |
    When these requests get these responses:
      | request                            | response                                |
      | as: lifecycle-175-token            | code: 200                               |+
      | method: POST                       |                                         |
      | path: /subscriptions/beneficiaries |                                         |
      | payload:                           |                                         |
      |   subscription: 175                |                                         |
      |   email: first-175@example.com     |                                         |
      | as: lifecycle-175-token            | code: 400                               |+
      | method: POST                       | body:                                   |
      | path: /subscriptions/beneficiaries |   errors:                               |
      | payload:                           |     - message: >-                       |
      |   subscription: 175                |         Plan "plan-175" allows 2        |
      |   email: second-175@example.com    |         beneficiaries, all taken        |
      |                                    |       extensions:                       |
      |                                    |         code: BENEFICIARIES_MAX_REACHED |
    Then the mailbox eventually holds these mails:
      | to                    | subject             |
      | first-175@example.com | You've been invited |
    And these requests get these responses:
      | request                                      | response   |
      | method: GET                                  | code: 200  |+
      | path: /users                                 | body:      |
      | query:                                       |   data: [] |
      |   filter[email][_eq]: second-175@example.com |            |

  Scenario: a beneficiary payload names one user or one email
    Given these pending subscriptions, each with its own plan:
      | id  | provider | manager | beneficiaries_max | plan_status |
      | 176 | mollie   | 176     | 2                 | active      |
    Then these requests get these responses:
      | request                            | response                                   |
      | as: lifecycle-176-token            | code: 400                                  |+
      | method: POST                       | body:                                      |
      | path: /subscriptions/beneficiaries |   errors:                                  |
      | payload:                           |     - message: >-                          |
      |   subscription: 176                |         Invalid payload. A beneficiary is  |
      |   user: <user_176>                 |         named by "user" or by "email", not |
      |   email: lifecycle-176@example.com |         both.                              |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_PAYLOAD              |
      | as: lifecycle-176-token            | code: 400                                  |+
      | method: POST                       | body:                                      |
      | path: /subscriptions/beneficiaries |   errors:                                  |
      | payload:                           |     - message: >-                          |
      |   subscription: 176                |         Invalid payload. A beneficiary is  |
      |                                    |         named by "user" or by "email".     |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_PAYLOAD              |
      | as: lifecycle-176-token            | code: 400                                  |+
      | method: POST                       | body:                                      |
      | path: /subscriptions/beneficiaries |   errors:                                  |
      | payload:                           |     - message: >-                          |
      |   subscription: 176                |         Invalid payload. "email" must be   |
      |   email: not-an-email              |         an email, got "not-an-email".      |
      |                                    |       extensions:                          |
      |                                    |         code: INVALID_PAYLOAD              |
    And the mailbox eventually holds these mails:
      | to | subject |

  Scenario: the sweep deletes the invitees holding no seat for 30 days
    Given the rows of directus_users:
      | id           | email                  | status  |
      | <stale_177>  | stale-177@example.com  | invited |
      | <seated_177> | seated-177@example.com | invited |
      | <fresh_177>  | fresh-177@example.com  | invited |
      | <joined_177> | joined-177@example.com | active  |
    And these pending subscriptions, each with its own plan:
      | id  | provider | manager | beneficiaries_max | plan_status |
      | 177 | mollie   | 177     | 2                 | active      |
    And the rows of subscription_beneficiaries:
      | subscription | user         |
      | 177          | <seated_177> |
    And the rows of subscription_invites:
      | user         | date_sent  |
      | <stale_177>  | 2026-01-01 |
      | <seated_177> | 2026-01-01 |
      | <fresh_177>  | 2099-01-01 |
      | <joined_177> | 2026-01-01 |
    When the CLI runs subscriptions sweep-invites with these variables:
      | variable             | value |
      | EXTENSIONS_MUST_LOAD | true  |
    Then the CLI exited with 0, having logged:
      """
      Deleted 1 invited user holding no seat since its invite of 30 days
      """
    And these requests get these responses:
      | request                           | response                               |
      | method: GET                       | code: 200                              |+
      | path: /users                      | body:                                  |
      | query:                            |   data:                                |
      |   fields: email                   |     - email: fresh-177@example.com     |
      |   sort: email                     |     - email: joined-177@example.com    |
      |   filter[email][_contains]: -177@ |     - email: lifecycle-177@example.com |
      |                                   |     - email: seated-177@example.com    |
      | method: GET                       | code: 200                              |+
      | path: /items/subscription_invites | body:                                  |
      | query:                            |   data:                                |
      |   fields: user                    |     - user: <seated_177>               |
      |   sort: id                        |     - user: <fresh_177>                |
      |   filter[user][_in]: "\           |     - user: <joined_177>               |
      |     <stale_177>,<seated_177>,\    |                                        |
      |     <fresh_177>,<joined_177>"     |                                        |

  Scenario: a swept email seated again gets a new invite mail
    Given the rows of directus_users:
      | id          | email                 | status  |
      | <stale_178> | again-178@example.com | invited |
    And the rows of subscription_invites:
      | user        | date_sent  |
      | <stale_178> | 2026-01-01 |
    And these pending subscriptions, each with its own plan:
      | id  | provider | manager | beneficiaries_max | plan_status |
      | 178 | mollie   | 178     | 2                 | active      |
    And Mollie holds this subscription:
      | column                | value           |
      | payment               | tr_invites_178  |
      | customer              | cst_invites_178 |
      | subscription          | sub_invites_178 |
      | directus_subscription | 178             |
      | status                | active          |
    And Mollie sends these events:
      | type         | entity         |
      | payment.paid | tr_invites_178 |
    And the CLI runs subscriptions sweep-invites with these variables:
      | variable             | value |
      | EXTENSIONS_MUST_LOAD | true  |
    When these requests get these responses:
      | request                            | response  |
      | as: lifecycle-178-token            | code: 200 |+
      | method: POST                       |           |
      | path: /subscriptions/beneficiaries |           |
      | payload:                           |           |
      |   subscription: 178                |           |
      |   email: again-178@example.com     |           |
    Then the mailbox eventually holds these mails:
      | to                    | subject             |
      | again-178@example.com | You've been invited |
