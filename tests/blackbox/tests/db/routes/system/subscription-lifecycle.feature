Feature: A subscription's life at its provider, as the subscriptions bundle follows it

  - A request authenticates as the admin unless its `as` names a token;
    `as: public` sends none, like a provider.
  - The instance loads the real `@scalabus/subscriptions` bundle, and its Mollie
    and Stripe clients call fake ones, answering what `holds` says.
  - `these pending subscriptions, each with its own plan` writes, for an `id` of
    21: the policy `<policy_21>` named `Lifecycle 21`, the plan 21 `plan-21`
    selling 10 EUR a month, and the subscription 21 pending at `provider`, which
    the user `<user_{manager}>` manages and benefits from. A `manager` equal to
    the `id` also writes that user, with the email `lifecycle-21@example.com` and
    the token `lifecycle-21-token`.
  - A provider names the pending subscription it bills in its metadata
    `directus_subscription`, as the checkout wrote it, which a holding names
    too.
  - The instance's `SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS` lists
    `mollie_secret_blackbox`, then `mollie_secret_old`.
  - `Mollie sends these events` posts one next-gen event per row, signed with
    `mollie_secret_blackbox`; `entity` is its `entityId`. `these Mollie events
    get these responses` signs each event with the `secret` its cell names.
  - A `<name>` stands for one uuid, the same in the tables and the requests.
  - `received these writes` reads what the providers received since it last read.
    A `write` cell is the YAML of one write; a write without `body` has none.
  - A `Scenario Outline` runs once per provider of its `Examples`. `the
    provider` is the provider of its pending subscriptions: a table with a
    `mollie` and a `stripe` column is read in that provider's column, an empty
    cell leaving its row out, and a table with a `provider` column keeps that
    provider's rows.
  - The instance also loads `subscriptions-synced-listener`, a hook logging
    `subscriptions.synced` and one `field=<value as JSON>` per payload field
    for each such action it receives.
  - `the CLI runs <arguments> with these variables` runs `directus <arguments>`
    against the instance's database, its env plus the variables listed.

  Scenario Outline: a <provider> user cancels, and keeps the access paid until period end
    Given these pending subscriptions, each with its own plan:
      | id      | provider   | manager | beneficiaries_max | plan_status |
      | <id>    | <provider> | <id>    | 1                 | active      |
      | <other> | <provider> | <other> | 1                 | active      |
    And the provider holds this subscription:
      | column                | mollie          | stripe          |
      | payment               | tr_cancel_<id>  |                 |
      | customer              | cst_cancel_<id> | cus_cancel_<id> |
      | subscription          | sub_cancel_<id> | sub_cancel_<id> |
      | directus_subscription | <id>            | <id>            |
      | status                | active          | active          |
      | paid_at               | 2099-01-01      |                 |
    When the provider sends these events:
      | provider | type                          | entity          |
      | mollie   | payment.paid                  | tr_cancel_<id>  |
      | stripe   | customer.subscription.updated | sub_cancel_<id> |
    Then this access is eventually stored:
      | user        | policy        | managed_by              |
      | <user_<id>> | <policy_<id>> | @scalabus/subscriptions |
    And these requests get these responses:
      | request                     | response                                  |
      | as: public                  | code: 403                                 |+
      | method: POST                | body:                                     |
      | path: /subscriptions/cancel |   errors:                                 |
      |                             |     - message: >-                         |
      |                             |         You don't have permission to      |
      |                             |         access this.                      |
      |                             |       extensions:                         |
      |                             |         code: FORBIDDEN                   |
      | as: lifecycle-<other>-token | code: 404                                 |+
      | method: POST                | body:                                     |
      | path: /subscriptions/cancel |   errors:                                 |
      |                             |     - message: >-                         |
      |                             |         No ongoing subscription to cancel |
      |                             |       extensions:                         |
      |                             |         code: NO_SUBSCRIPTION_TO_CANCEL   |
      | as: lifecycle-<id>-token    | code: 204                                 |+
      | method: POST                |                                           |
      | path: /subscriptions/cancel |                                           |
    Then the providers eventually received these writes:
      | provider | write                                                            |
      | mollie   | method: DELETE                                                   |+
      |          | path: /v2/customers/cst_cancel_<id>/subscriptions/sub_cancel_<id> |
      | stripe   | method: POST                                                     |+
      |          | path: /v1/subscriptions/sub_cancel_<id>                          |
      |          | body: cancel_at_period_end=true                                  |
    And subscription sub_cancel_<id> is eventually stored:
      | provider | status   | cancel_at_period_end | current_period_end       |
      | mollie   | canceled | true                 | 2099-02-01T00:00:00.000Z |
      | stripe   | active   | true                 | 2099-01-01T00:00:00.000Z |
    And the events of subscription sub_cancel_<id> are eventually:
      | provider | source | status   | cancel_at_period_end | user        |
      | mollie   | sync   | active   | false                |             |
      | mollie   | user   | active   | true                 | <user_<id>> |
      | mollie   | sync   | canceled | true                 |             |
      | stripe   | sync   | active   | false                |             |
      | stripe   | user   | active   | true                 | <user_<id>> |
    And this access is eventually stored:
      | user        | policy        | managed_by              |
      | <user_<id>> | <policy_<id>> | @scalabus/subscriptions |
    And these requests get these responses:
      | request                     | response                                  |
      | as: lifecycle-<id>-token    | code: 404                                 |+
      | method: POST                | body:                                     |
      | path: /subscriptions/cancel |   errors:                                 |
      |                             |     - message: >-                         |
      |                             |         No ongoing subscription to cancel |
      |                             |       extensions:                         |
      |                             |         code: NO_SUBSCRIPTION_TO_CANCEL   |

    Examples:
      | provider | id | other |
      | mollie   | 21 | 22    |
      | stripe   | 29 | 30    |

  Scenario: a user takes back a Mollie cancel: a new subscription starts at period end
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 24 | mollie   | 24      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_resume  |
      | customer              | cst_resume |
      | subscription          | sub_resume |
      | directus_subscription | 24         |
      | status                | canceled   |
      | paid_at               | 2099-01-01 |
    And Mollie holds this mandate:
      | column   | value      |
      | mandate  | mdt_resume |
      | customer | cst_resume |
      | status   | valid      |
    When Mollie sends these events:
      | type         | entity    |
      | payment.paid | tr_resume |
    Then subscription sub_resume is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | true                 | 2099-02-01T00:00:00.000Z |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-24-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/resume |           |
    Then Mollie eventually received this subscription for cst_resume:
      | field       | value                                                 |
      | amount      | {"currency":"EUR","value":"10.00"}                    |
      | interval    | 1 month                                               |
      | description | Subscription 24                                       |
      | mandateId   | mdt_resume                                            |
      | startDate   | 2099-02-01                                            |
      | metadata    | {"directus_subscription":"24","resumes":"sub_resume"} |
    And subscription sub_resume_2 is eventually stored:
      | status | cancel_at_period_end | current_period_end       |
      | active | false                | 2099-02-01T00:00:00.000Z |
    And subscription sub_resume_2 eventually continues sub_resume
    And the events of subscription sub_resume are eventually:
      | source | status   | cancel_at_period_end | user      |
      | sync   | canceled | true                 |           |
      | user   | canceled | true                 | <user_24> |
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_24> | <policy_24> | @scalabus/subscriptions |
    And the beneficiaries of subscription sub_resume_2 are eventually:
      | user      | access           |
      | <user_24> | <granted_access> |
    And these requests get these responses:
      | request                     | response                                |
      | as: lifecycle-24-token      | code: 404                               |+
      | method: POST                | body:                                   |
      | path: /subscriptions/resume |   errors:                               |
      |                             |     - message: >-                       |
      |                             |         No canceled subscription to     |
      |                             |         resume                          |
      |                             |       extensions:                       |
      |                             |         code: NO_SUBSCRIPTION_TO_RESUME |

  Scenario: a user cancels their resume, then resumes the period still paid again
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 25 | mollie   | 25      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_twice   |
      | customer              | cst_twice  |
      | subscription          | sub_twice  |
      | directus_subscription | 25         |
      | status                | canceled   |
      | paid_at               | 2099-01-01 |
    And Mollie holds this mandate:
      | column   | value     |
      | mandate  | mdt_twice |
      | customer | cst_twice |
      | status   | valid     |
    When Mollie sends these events:
      | type         | entity   |
      | payment.paid | tr_twice |
    Then subscription sub_twice is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | true                 | 2099-02-01T00:00:00.000Z |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-25-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/resume |           |
    Then Mollie eventually received this subscription for cst_twice:
      | field       | value                                                |
      | amount      | {"currency":"EUR","value":"10.00"}                   |
      | interval    | 1 month                                              |
      | description | Subscription 25                                      |
      | mandateId   | mdt_twice                                            |
      | startDate   | 2099-02-01                                           |
      | metadata    | {"directus_subscription":"25","resumes":"sub_twice"} |
    And subscription sub_twice_2 is eventually stored:
      | status | cancel_at_period_end | current_period_end       |
      | active | false                | 2099-02-01T00:00:00.000Z |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-25-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/cancel |           |
    Then the providers eventually received these writes:
      | method | path                                              | body |
      | DELETE | /v2/customers/cst_twice/subscriptions/sub_twice_2 |      |
    And subscription sub_twice_2 is eventually stored:
      | status   | cancel_at_period_end | current_period_end |
      | canceled | true                 |                    |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-25-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/resume |           |
    Then Mollie eventually received this subscription for cst_twice:
      | field       | value                                                |
      | amount      | {"currency":"EUR","value":"10.00"}                   |
      | interval    | 1 month                                              |
      | description | Subscription 25                                      |
      | mandateId   | mdt_twice                                            |
      | startDate   | 2099-02-01                                           |
      | metadata    | {"directus_subscription":"25","resumes":"sub_twice"} |
    And subscription sub_twice_3 eventually continues sub_twice_2
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_25> | <policy_25> | @scalabus/subscriptions |

  Scenario: a plan policy change moves the access a resumed subscription shares
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 26 | mollie   | 26      | 1                 | active      |
      | 27 | mollie   | 27      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_split   |
      | customer              | cst_split  |
      | subscription          | sub_split  |
      | directus_subscription | 26         |
      | status                | canceled   |
      | paid_at               | 2099-01-01 |
    And Mollie holds this mandate:
      | column   | value     |
      | mandate  | mdt_split |
      | customer | cst_split |
      | status   | valid     |
    When Mollie sends these events:
      | type         | entity   |
      | payment.paid | tr_split |
    Then subscription sub_split is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | true                 | 2099-02-01T00:00:00.000Z |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-26-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/resume |           |
    Then Mollie eventually received this subscription for cst_split:
      | field       | value                                                |
      | amount      | {"currency":"EUR","value":"10.00"}                   |
      | interval    | 1 month                                              |
      | description | Subscription 26                                      |
      | mandateId   | mdt_split                                            |
      | startDate   | 2099-02-01                                           |
      | metadata    | {"directus_subscription":"26","resumes":"sub_split"} |
    And subscription sub_split_2 eventually continues sub_split
    When these requests get these responses:
      | request                            | response  |
      | method: PATCH                      | code: 200 |+
      | path: /items/subscription_plans/26 |           |
      | payload:                           |           |
      |   policy: <policy_27>              |           |
    And Mollie sends these events:
      | type         | entity         |
      | payment.paid | tr_sub_split_2 |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_26> | <policy_27> | @scalabus/subscriptions |
    When Mollie sends these events:
      | type         | entity   |
      | payment.paid | tr_split |
    Then the beneficiaries of subscription sub_split are eventually:
      | user      | access           |
      | <user_26> | <granted_access> |
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_26> | <policy_27> | @scalabus/subscriptions |

  Scenario Outline: a <provider> manager of two subscriptions names the one to cancel
    Given these pending subscriptions, each with its own plan:
      | id       | provider   | manager | beneficiaries_max | plan_status |
      | <id>     | <provider> | <id>    | 1                 | active      |
      | <second> | <provider> | <id>    | 1                 | active      |
    And the provider holds this subscription:
      | column                | mollie          | stripe          |
      | payment               | tr_one_<id>     |                 |
      | customer              | cst_double_<id> | cus_double_<id> |
      | subscription          | sub_one_<id>    | sub_one_<id>    |
      | directus_subscription | <id>            | <id>            |
      | status                | active          | active          |
    And the provider holds this subscription:
      | column                | mollie          | stripe          |
      | payment               | tr_two_<id>     |                 |
      | customer              | cst_double_<id> | cus_double_<id> |
      | subscription          | sub_two_<id>    | sub_two_<id>    |
      | directus_subscription | <second>        | <second>        |
      | status                | active          | active          |
    When the provider sends these events:
      | provider | type                          | entity       |
      | mollie   | payment.paid                  | tr_one_<id>  |
      | mollie   | payment.paid                  | tr_two_<id>  |
      | stripe   | customer.subscription.updated | sub_one_<id> |
      | stripe   | customer.subscription.updated | sub_two_<id> |
    Then subscription sub_one_<id> is eventually stored:
      | status | cancel_at_period_end |
      | active | false                |
    And subscription sub_two_<id> is eventually stored:
      | status | cancel_at_period_end |
      | active | false                |
    And these requests get these responses:
      | request                     | response                                      |
      | as: lifecycle-<id>-token    | code: 409                                     |+
      | method: POST                | body:                                         |
      | path: /subscriptions/cancel |   errors:                                     |
      |                             |     - message: >-                             |
      |                             |         Found 2 ongoing subscriptions to      |
      |                             |         cancel, expected one                  |
      |                             |       extensions:                             |
      |                             |         code: SEVERAL_SUBSCRIPTIONS_TO_CANCEL |
      | as: lifecycle-<id>-token    | code: 204                                     |+
      | method: POST                |                                               |
      | path: /subscriptions/cancel |                                               |
      | payload:                    |                                               |
      |   subscription: <id>        |                                               |
    Then the providers eventually received these writes:
      | provider | write                                                         |
      | mollie   | method: DELETE                                                |+
      |          | path: /v2/customers/cst_double_<id>/subscriptions/sub_one_<id> |
      | stripe   | method: POST                                                  |+
      |          | path: /v1/subscriptions/sub_one_<id>                          |
      |          | body: cancel_at_period_end=true                               |
    And subscription sub_two_<id> is eventually stored:
      | status | cancel_at_period_end |
      | active | false                |

    Examples:
      | provider | id | second |
      | mollie   | 23 | 28     |
      | stripe   | 34 | 35     |

  Scenario: a canceled subscription whose paid period is over loses its access
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 31 | mollie   | 31      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value     |
      | payment               | tr_ended  |
      | customer              | cst_ended |
      | subscription          | sub_ended |
      | directus_subscription | 31        |
      | status                | active    |
    When Mollie sends these events:
      | type         | entity   |
      | payment.paid | tr_ended |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_31> | <policy_31> | @scalabus/subscriptions |
    When Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_ended   |
      | customer              | cst_ended  |
      | subscription          | sub_ended  |
      | directus_subscription | 31         |
      | status                | canceled   |
      | paid_at               | 2020-01-01 |
    And Mollie sends these events:
      | type         | entity   |
      | payment.paid | tr_ended |
    Then this user eventually holds no access:
      | user      |
      | <user_31> |
    And subscription sub_ended is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | true                 | 2020-02-01T00:00:00.000Z |
    And the beneficiaries of subscription sub_ended are eventually:
      | user      | access |
      | <user_31> |        |

  Scenario Outline: a suspended <provider> subscription paid again gets its access back
    Given these pending subscriptions, each with its own plan:
      | id   | provider   | manager | beneficiaries_max | plan_status |
      | <id> | <provider> | <id>    | 1                 | active      |
    And the provider holds this subscription:
      | column                | mollie           | stripe           |
      | payment               | tr_resumed_<id>  |                  |
      | customer              | cst_resumed_<id> | cus_resumed_<id> |
      | subscription          | sub_resumed_<id> | sub_resumed_<id> |
      | directus_subscription | <id>             | <id>             |
      | status                | suspended        | unpaid           |
    When the provider sends these events:
      | provider | type                          | entity           |
      | mollie   | payment.paid                  | tr_resumed_<id>  |
      | stripe   | customer.subscription.updated | sub_resumed_<id> |
    Then subscription sub_resumed_<id> is eventually stored:
      | provider | status    |
      | mollie   | suspended |
      | stripe   | unpaid    |
    And the beneficiaries of subscription sub_resumed_<id> are eventually:
      | user        | access |
      | <user_<id>> |        |
    When the provider holds this subscription:
      | column                | mollie           | stripe           |
      | payment               | tr_resumed_<id>  |                  |
      | customer              | cst_resumed_<id> | cus_resumed_<id> |
      | subscription          | sub_resumed_<id> | sub_resumed_<id> |
      | directus_subscription | <id>             | <id>             |
      | status                | active           | active           |
    And the provider sends these events:
      | provider | type                          | entity           |
      | mollie   | payment.paid                  | tr_resumed_<id>  |
      | stripe   | customer.subscription.updated | sub_resumed_<id> |
    Then this access is eventually stored:
      | user        | policy        | managed_by              |
      | <user_<id>> | <policy_<id>> | @scalabus/subscriptions |

    Examples:
      | provider | id |
      | mollie   | 33 |
      | stripe   | 36 |

  Scenario Outline: archiving a <provider> plan ends its subscriptions once confirmed
    Given these pending subscriptions, each with its own plan:
      | id      | provider   | manager | beneficiaries_max | plan_status |
      | <id>    | <provider> | <id>    | 1                 | active      |
      | <other> | <provider> | <other> | 1                 | active      |
    And the provider holds this subscription:
      | column                | mollie            | stripe            |
      | payment               | tr_archived_<id>  |                   |
      | customer              | cst_archived_<id> | cus_archived_<id> |
      | subscription          | sub_archived_<id> | sub_archived_<id> |
      | directus_subscription | <id>              | <id>              |
      | status                | active            | active            |
      | paid_at               | 2099-01-01        |                   |
    When the provider sends these events:
      | provider | type                          | entity            |
      | mollie   | payment.paid                  | tr_archived_<id>  |
      | stripe   | customer.subscription.updated | sub_archived_<id> |
    Then subscription sub_archived_<id> is eventually stored:
      | status | cancel_at_period_end |
      | active | false                |
    And these requests get these responses:
      | request                                    | response                           |
      | as: lifecycle-<id>-token                   | code: 403                          |+
      | method: POST                               | body:                              |
      | path: /subscriptions/plans/<id>/archive    |   errors:                          |
      |                                            |     - message: >-                  |
      |                                            |         You don't have permission  |
      |                                            |         to access this.            |
      |                                            |       extensions:                  |
      |                                            |         code: FORBIDDEN            |
      | method: POST                               | code: 403                          |+
      | path: /subscriptions/plans/999/archive     | body:                              |
      |                                            |   errors:                          |
      |                                            |     - message: >-                  |
      |                                            |         You don't have permission  |
      |                                            |         to access this.            |
      |                                            |       extensions:                  |
      |                                            |         code: FORBIDDEN            |
      | method: POST                               | code: 400                          |+
      | path: /subscriptions/plans/one/archive     | body:                              |
      |                                            |   errors:                          |
      |                                            |     - message: >-                  |
      |                                            |         Invalid payload. Plan id   |
      |                                            |         "one" must be an integer.  |
      |                                            |       extensions:                  |
      |                                            |         code: INVALID_PAYLOAD      |
      | method: POST                               | code: 400                          |+
      | path: /subscriptions/plans/<id>/archive    | body:                              |
      |                                            |   errors:                          |
      |                                            |     - message: >-                  |
      |                                            |         Invalid payload. Type "End |
      |                                            |         1 subscription and lose    |
      |                                            |         this customer" in          |
      |                                            |         "confirmation".            |
      |                                            |       extensions:                  |
      |                                            |         code: INVALID_PAYLOAD      |
      | method: POST                               | code: 200                          |+
      | path: /subscriptions/plans/<other>/archive | body:                              |
      |                                            |   data:                            |
      |                                            |     status: archived               |
      |                                            |     ending_subscriptions: 0        |
      | method: POST                               | code: 200                          |+
      | path: /subscriptions/plans/<id>/archive    | body:                              |
      | payload:                                   |   data:                            |
      |   confirmation: >-                         |     status: archived               |
      |     End 1 subscription and lose this       |     ending_subscriptions: 1        |
      |     customer                               |                                    |
      | method: GET                                | code: 200                          |+
      | path: /items/subscription_plans/<id>       | body:                              |
      |                                            |   data:                            |
      |                                            |     status: archived               |
    Then the providers eventually received these writes:
      | provider | write                                                                |
      | mollie   | method: DELETE                                                       |+
      |          | path: /v2/customers/cst_archived_<id>/subscriptions/sub_archived_<id> |
      | stripe   | method: POST                                                         |+
      |          | path: /v1/subscriptions/sub_archived_<id>                            |
      |          | body: cancel_at_period_end=true                                      |
    And the events of subscription sub_archived_<id> are eventually:
      | provider | source        | status   | cancel_at_period_end |
      | mollie   | sync          | active   | false                |
      | mollie   | plan_archived | active   | true                 |
      | mollie   | sync          | canceled | true                 |
      | stripe   | sync          | active   | false                |
      | stripe   | plan_archived | active   | true                 |
    And this access is eventually stored:
      | user        | policy        | managed_by              |
      | <user_<id>> | <policy_<id>> | @scalabus/subscriptions |

    Examples:
      | provider | id | other |
      | mollie   | 41 | 42    |
      | stripe   | 43 | 44    |

  Scenario Outline: a deleted user's <provider> subscription is canceled at its provider
    Given these pending subscriptions, each with its own plan:
      | id   | provider   | manager | beneficiaries_max | plan_status |
      | <id> | <provider> | <id>    | 1                 | active      |
    And the provider holds this subscription:
      | column                | mollie           | stripe           |
      | payment               | tr_deleted_<id>  |                  |
      | customer              | cst_deleted_<id> | cus_deleted_<id> |
      | subscription          | sub_deleted_<id> | sub_deleted_<id> |
      | directus_subscription | <id>             | <id>             |
      | status                | active           | active           |
    When the provider sends these events:
      | provider | type                          | entity           |
      | mollie   | payment.paid                  | tr_deleted_<id>  |
      | stripe   | customer.subscription.updated | sub_deleted_<id> |
    Then this access is eventually stored:
      | user        | policy        | managed_by              |
      | <user_<id>> | <policy_<id>> | @scalabus/subscriptions |
    When these requests get these responses:
      | request                  | response  |
      | method: DELETE           | code: 204 |+
      | path: /users/<user_<id>> |           |
    And the provider sends these events:
      | provider | type                          | entity           |
      | mollie   | payment.paid                  | tr_deleted_<id>  |
      | stripe   | customer.subscription.updated | sub_deleted_<id> |
    Then the providers eventually received these writes:
      | provider | write                                                              |
      | mollie   | method: DELETE                                                     |+
      |          | path: /v2/customers/cst_deleted_<id>/subscriptions/sub_deleted_<id> |
      | stripe   | method: POST                                                       |+
      |          | path: /v1/subscriptions/sub_deleted_<id>                           |
      |          | body: cancel_at_period_end=true                                    |
    And subscription sub_deleted_<id> is eventually stored:
      | status | cancel_at_period_end |
      | active | true                 |
    And the beneficiaries of subscription sub_deleted_<id> are eventually:
      | user | access |
      |      |        |
    And the events of subscription sub_deleted_<id> are eventually:
      | source       | status | cancel_at_period_end |
      | sync         | active | false                |
      | user_deleted | active | true                 |

    Examples:
      | provider | id |
      | mollie   | 51 |
      | stripe   | 52 |

  Scenario Outline: a subscription <provider> no longer holds is closed, its row stays
    Given these pending subscriptions, each with its own plan:
      | id   | provider   | manager | beneficiaries_max | plan_status |
      | <id> | <provider> | <id>    | 1                 | active      |
    And the provider holds this subscription:
      | column                | mollie        | stripe        |
      | payment               | tr_gone_<id>  |               |
      | customer              | cst_gone_<id> | cus_gone_<id> |
      | subscription          | sub_gone_<id> | sub_gone_<id> |
      | directus_subscription | <id>          | <id>          |
      | status                | active        | active        |
    When the provider sends these events:
      | provider | type                          | entity        |
      | mollie   | payment.paid                  | tr_gone_<id>  |
      | stripe   | customer.subscription.updated | sub_gone_<id> |
    Then this access is eventually stored:
      | user        | policy        | managed_by              |
      | <user_<id>> | <policy_<id>> | @scalabus/subscriptions |
    When the provider no longer holds subscription sub_gone_<id>
    And the provider sends these events:
      | provider | type                          | entity        |
      | mollie   | payment.paid                  | tr_gone_<id>  |
      | stripe   | customer.subscription.deleted | sub_gone_<id> |
    Then this user eventually holds no access:
      | user        |
      | <user_<id>> |
    And the events of subscription sub_gone_<id> are eventually:
      | source           | status   | cancel_at_period_end |
      | sync             | active   | false                |
      | provider_missing | canceled | false                |
    And the sync queue eventually holds no row for this resource:
      | provider | resource_id   |
      | mollie   | tr_gone_<id>  |
      | stripe   | sub_gone_<id> |

    Examples:
      | provider | id |
      | mollie   | 61 |
      | stripe   | 62 |

  Scenario: a webhook is refused or dropped without granting anything
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 63 | mollie   | 63      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value     |
      | payment               | tr_first  |
      | customer              | cst_first |
      | subscription          |           |
      | directus_subscription | 63        |
      | status                | active    |
    And Mollie holds this subscription:
      | column                | value     |
      | payment               | tr_stray  |
      | customer              | cst_stray |
      | subscription          | sub_stray |
      | directus_subscription |           |
      | status                | active    |
    When these requests get these responses:
      | request                              | response                                 |
      | as: public                           | code: 200                                |+
      | method: POST                         |                                          |
      | path: /subscriptions/webhooks/mollie |                                          |
      | as: public                           | code: 401                                |+
      | method: POST                         | body:                                    |
      | path: /subscriptions/webhooks/mollie |  errors:                                 |
      | payload: id=tr_first                 |  - message: >-                           |
      |                                      |      Webhook from "mollie" refused:      |
      |                                      |      expected one "x-mollie-signature"   |
      |                                      |      header, got null                    |
      |                                      |    extensions:                           |
      |                                      |      code: SUBSCRIPTION_WEBHOOK_UNSIGNED |
      | as: public                           | code: 401                                |+
      | method: POST                         | body:                                    |
      | path: /subscriptions/webhooks/mollie |  errors:                                 |
      | headers:                             |  - message: >-                           |
      |   x-mollie-signature: sha256=forged  |      Webhook from "mollie" refused: the  |
      | payload:                             |      "x-mollie-signature" header does    |
      |   type: payment.paid                 |      not sign the body                   |
      |   entityId: tr_first                 |    extensions:                           |
      |                                      |      code: SUBSCRIPTION_WEBHOOK_UNSIGNED |
      | as: public                           | code: 404                                |+
      | method: POST                         | body:                                    |
      | path: /subscriptions/webhooks/paddle |  errors:                                 |
      | payload: id=tr_first                 |  - message: >-                           |
      |                                      |      Subscription provider "paddle" is   |
      |                                      |      not enabled                         |
      |                                      |    extensions:                           |
      |                                      |      code: UNKNOWN_SUBSCRIPTION_PROVIDER |
    And Mollie sends these events:
      | type            | entity   |
      | hook.ping       |          |
      | refund.refunded | re_stray |
      | payment.paid    | tr_first |
      | payment.paid    | tr_stray |
    Then the sync queue eventually holds no row for tr_first
    And the sync queue eventually holds no row for tr_stray
    And the instance eventually logged:
      """
      Subscription sync of "mollie" "tr_stray" dropped: "\"mollie\"
      subscription \"sub_stray\" names no pending subscription: its metadata
      \"directus_subscription\" is null"
      """
    And the instance eventually logged:
      """
      Webhook from "mollie" ignored: event type "refund.refunded" names no
      payment
      """
    And this user eventually holds no access:
      | user      |
      | <user_63> |

  Scenario: an event signed with any secret listed is synced, so a secret can rotate
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 64 | mollie   | 64      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_rotate  |
      | customer              | cst_rotate |
      | subscription          | sub_rotate |
      | directus_subscription | 64         |
      | status                | active     |
      | paid_at               | 2099-01-01 |
    When these Mollie events get these responses:
      | event                          | response                                 |
      | secret: mollie_secret_unlisted | code: 401                                |+
      | type: payment.paid             | body:                                    |
      | entityId: tr_rotate            |  errors:                                 |
      |                                |  - message: >-                           |
      |                                |      Webhook from "mollie" refused: the  |
      |                                |      "x-mollie-signature" header does    |
      |                                |      not sign the body                   |
      |                                |    extensions:                           |
      |                                |      code: SUBSCRIPTION_WEBHOOK_UNSIGNED |
      | secret: mollie_secret_old      | code: 200                                |+
      | type: payment.paid             |                                          |
      | entityId: tr_rotate            |                                          |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_64> | <policy_64> | @scalabus/subscriptions |

  Scenario: a signed event the bundle cannot read is logged, kept and answered 200
    When these Mollie events get these responses:
      | event                          | response  |
      | secret: mollie_secret_blackbox | code: 200 |+
      | type: payment.paid             |           |
      | entityId: sub_unreadable       |           |
      | secret: mollie_secret_blackbox | code: 200 |+
      | entityId: tr_unreadable        |           |
    Then the sync queue eventually holds no row for sub_unreadable
    And the sync queue eventually holds no row for tr_unreadable
    And the instance eventually logged:
      """
      Webhook from "mollie" unreadable: event entityId "sub_unreadable" is not a
      payment id
      """
    And the instance eventually logged:
      """
      Webhook from "mollie" unreadable: event type null is not a string
      """
    And these unreadable webhooks are eventually stored:
      """
      - resource: event
        id: event_blackbox
        type: payment.paid
        entityId: sub_unreadable
      - resource: event
        id: event_blackbox
        entityId: tr_unreadable
      """

  Scenario: a failed sync keeps its error until a webhook retries it
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 71 | mollie   | 71      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_late_2  |
      | customer              | cst_late   |
      | subscription          | sub_late_2 |
      | directus_subscription | 71         |
      | status                | active     |
      | resumes               | sub_late   |
    When Mollie sends these events:
      | type         | entity    |
      | payment.paid | tr_late_2 |
    Then these sync queue rows are eventually stored:
      | resource_id | last_error                                                        |
      | tr_late_2   | Subscription "sub_late_2" resumes "sub_late", which is not stored |
    When Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_late    |
      | customer              | cst_late   |
      | subscription          | sub_late   |
      | directus_subscription | 71         |
      | status                | canceled   |
      | paid_at               | 2099-01-01 |
    And Mollie sends these events:
      | type         | entity    |
      | payment.paid | tr_late   |
      | payment.paid | tr_late_2 |
    Then subscription sub_late_2 eventually continues sub_late
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_71> | <policy_71> | @scalabus/subscriptions |
    And the sync queue eventually holds no row for tr_late_2

  Scenario: a webhook retries a parked sync
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 81 | mollie   | 81      | 1                 | active      |
    And the rows of subscription_sync_queue:
      | provider | resource_id | pending | attempts | next_attempt_at | last_error  |
      | mollie   | tr_parked   | false   | 48       | 2020-01-01      | Unreachable |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_parked  |
      | customer              | cst_parked |
      | subscription          | sub_parked |
      | directus_subscription | 81         |
      | status                | active     |
    When Mollie sends these events:
      | type         | entity    |
      | payment.paid | tr_parked |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_81> | <policy_81> | @scalabus/subscriptions |
    And the sync queue eventually holds no row for tr_parked

  Scenario: a paid webhook on a locked plan still grants it
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status          |
      | 83 | mollie   | 83      | 1                 | subscriptions-locked |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_locked  |
      | customer              | cst_locked |
      | subscription          | sub_locked |
      | directus_subscription | 83         |
      | status                | active     |
    When Mollie sends these events:
      | type         | entity    |
      | payment.paid | tr_locked |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_83> | <policy_83> | @scalabus/subscriptions |

  Scenario: a plan changed in the provider's portal keeps the plan sold, logged
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 85 | mollie   | 85      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_billed  |
      | customer              | cst_billed |
      | subscription          | sub_billed |
      | directus_subscription | 85         |
      | status                | active     |
      | amount                | "20.00"    |
    When Mollie sends these events:
      | type         | entity    |
      | payment.paid | tr_billed |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_85> | <policy_85> | @scalabus/subscriptions |
    And the instance eventually logged:
      """
      Subscription 85 is billed
      {"amountCents":2000,"currency":"EUR","interval":{"months":1,"days":0}} by
      "mollie", its plan "plan-85" sells
      {"amountCents":1000,"currency":"EUR","interval":{"months":1,"days":0}}
      """

  Scenario: a plan changed in the Stripe portal keeps the plan sold, logged
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 94 | stripe   | 94      | 1                 | active      |
    And Stripe holds this subscription:
      | column                | value        |
      | subscription          | sub_repriced |
      | customer              | cus_repriced |
      | directus_subscription | 94           |
      | status                | active       |
      | unit_amount           | 2000         |
    When Stripe sends these events:
      | type                          | subscription |
      | customer.subscription.updated | sub_repriced |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_94> | <policy_94> | @scalabus/subscriptions |
    And the instance eventually logged:
      """
      Subscription 94 is billed
      {"amountCents":2000,"currency":"EUR","interval":{"months":1,"days":0}} by
      "stripe", its plan "plan-94" sells
      {"amountCents":1000,"currency":"EUR","interval":{"months":1,"days":0}}
      """

  Scenario: a manager seats beneficiaries up to the plan's maximum, freed by a delete
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 86 | mollie   | 86      | 2                 | active      |
    And the rows of directus_users:
      | id          | email                           | token                     |
      | <friend_86> | lifecycle-friend-86@example.com | lifecycle-friend-86-token |
      | <other_86>  | lifecycle-other-86@example.com  | lifecycle-other-86-token  |
    And Mollie holds this subscription:
      | column                | value     |
      | payment               | tr_seats  |
      | customer              | cst_seats |
      | subscription          | sub_seats |
      | directus_subscription | 86        |
      | status                | active    |
    When Mollie sends these events:
      | type         | entity   |
      | payment.paid | tr_seats |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_86> | <policy_86> | @scalabus/subscriptions |
    And these requests get these responses:
      | request                            | response                                  |
      | as: lifecycle-other-86-token       | code: 403                                 |+
      | method: POST                       | body:                                     |
      | path: /subscriptions/beneficiaries |   errors:                                 |
      | payload:                           |     - message: >-                         |
      |   subscription: 86                 |         You don't have permission to      |
      |   user: <other_86>                 |         access this.                      |
      |                                    |       extensions:                         |
      |                                    |         code: FORBIDDEN                   |
      | as: lifecycle-86-token             | code: 200                                 |+
      | method: POST                       |                                           |
      | path: /subscriptions/beneficiaries |                                           |
      | payload:                           |                                           |
      |   subscription: 86                 |                                           |
      |   user: <friend_86>                |                                           |
      | as: lifecycle-86-token             | code: 400                                 |+
      | method: POST                       | body:                                     |
      | path: /subscriptions/beneficiaries |   errors:                                 |
      | payload:                           |     - message: >-                         |
      |   subscription: 86                 |         Invalid payload. User             |
      |   user: <friend_86>                |         "<friend_86>" already             |
      |                                    |         benefits from subscription 86.    |
      |                                    |       extensions:                         |
      |                                    |         code: INVALID_PAYLOAD             |
      | as: lifecycle-86-token             | code: 400                                 |+
      | method: POST                       | body:                                     |
      | path: /subscriptions/beneficiaries |   errors:                                 |
      | payload:                           |     - message: >-                         |
      |   subscription: 86                 |         Plan "plan-86" allows 2           |
      |   user: <other_86>                 |         beneficiaries, all taken          |
      |                                    |       extensions:                         |
      |                                    |         code: BENEFICIARIES_MAX_REACHED   |
      | as: lifecycle-friend-86-token      | code: 404                                 |+
      | method: POST                       | body:                                     |
      | path: /subscriptions/cancel        |   errors:                                 |
      |                                    |     - message: >-                         |
      |                                    |         No ongoing subscription to cancel |
      |                                    |       extensions:                         |
      |                                    |         code: NO_SUBSCRIPTION_TO_CANCEL   |
    Then this access is eventually stored:
      | user        | policy      | managed_by              |
      | <friend_86> | <policy_86> | @scalabus/subscriptions |
    And the beneficiaries of subscription sub_seats are eventually:
      | user        |
      | <user_86>   |
      | <friend_86> |
    When these requests get these responses:
      | request                            | response  |
      | method: DELETE                     | code: 204 |+
      | path: /users/<friend_86>           |           |
      | as: lifecycle-86-token             | code: 200 |+
      | method: POST                       |           |
      | path: /subscriptions/beneficiaries |           |
      | payload:                           |           |
      |   subscription: 86                 |           |
      |   user: <other_86>                 |           |
    Then the beneficiaries of subscription sub_seats are eventually:
      | user       |
      | <user_86>  |
      |            |
      | <other_86> |

  Scenario: a deleted beneficiary row takes its access along
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 87 | mollie   | 87      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value       |
      | payment               | tr_removed  |
      | customer              | cst_removed |
      | subscription          | sub_removed |
      | directus_subscription | 87          |
      | status                | active      |
    When Mollie sends these events:
      | type         | entity     |
      | payment.paid | tr_removed |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_87> | <policy_87> | @scalabus/subscriptions |
    When these requests get these responses:
      | request                                 | response  |
      | method: DELETE                          | code: 204 |+
      | path: /items/subscription_beneficiaries |           |
      | payload:                                |           |
      |   query:                                |           |
      |     filter:                             |           |
      |       subscription:                     |           |
      |         _eq: 87                         |           |
    Then this user eventually holds no access:
      | user      |
      | <user_87> |

  Scenario: a beneficiary's user cannot change, the access stays with its user
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 97 | mollie   | 97      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_reuser  |
      | customer              | cst_reuser |
      | subscription          | sub_reuser |
      | directus_subscription | 97         |
      | status                | active     |
    When Mollie sends these events:
      | type         | entity    |
      | payment.paid | tr_reuser |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_97> | <policy_97> | @scalabus/subscriptions |
    When these requests get these responses:
      | request                                 | response                         |
      | method: PATCH                           | code: 400                        |+
      | path: /items/subscription_beneficiaries | body:                            |
      | payload:                                |   errors:                        |
      |   query:                                |     - message: >-                |
      |     filter:                             |         Invalid payload. A       |
      |       subscription:                     |         beneficiary's "user"     |
      |         _eq: 97                         |         cannot change: delete    |
      |   data:                                 |         the beneficiary and add  |
      |     user: <user_98>                     |         the new one.             |
      |                                         |       extensions:                |
      |                                         |         code: INVALID_PAYLOAD    |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_97> | <policy_97> | @scalabus/subscriptions |

  Scenario: a PATCH cannot move a beneficiary to another subscription
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 98 | mollie   | 98      | 1                 | active      |
      | 99 | mollie   | 99      | 2                 | active      |
    When these requests get these responses:
      | request                                 | response                         |
      | method: PATCH                           | code: 400                        |+
      | path: /items/subscription_beneficiaries | body:                            |
      | payload:                                |   errors:                        |
      |   query:                                |     - message: >-                |
      |     filter:                             |         Invalid payload. A       |
      |       subscription:                     |         beneficiary's            |
      |         _eq: 98                         |         "subscription" cannot    |
      |   data:                                 |         change: delete the       |
      |     subscription: 99                    |         beneficiary and add the  |
      |                                         |         new one.                 |
      |                                         |       extensions:                |
      |                                         |         code: INVALID_PAYLOAD    |

  Scenario: a client sends a beneficiary back whole, its user unchanged
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 96 | mollie   | 96      | 1                 | active      |
    When these requests get these responses:
      | request                                 | response  |
      | method: PATCH                           | code: 200 |+
      | path: /items/subscription_beneficiaries |           |
      | payload:                                |           |
      |   query:                                |           |
      |     filter:                             |           |
      |       subscription:                     |           |
      |         _eq: 96                         |           |
      |   data:                                 |           |
      |     subscription: 96                    |           |
      |     user: <user_96>                     |           |

  Scenario: a deleted beneficiary row keeps the access its resume still shares
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 88 | mollie   | 88      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_kept    |
      | customer              | cst_kept   |
      | subscription          | sub_kept   |
      | directus_subscription | 88         |
      | status                | canceled   |
      | paid_at               | 2099-01-01 |
    And Mollie holds this mandate:
      | column   | value    |
      | mandate  | mdt_kept |
      | customer | cst_kept |
      | status   | valid    |
    When Mollie sends these events:
      | type         | entity  |
      | payment.paid | tr_kept |
    Then subscription sub_kept is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | true                 | 2099-02-01T00:00:00.000Z |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-88-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/resume |           |
    Then Mollie eventually received this subscription for cst_kept:
      | field       | value                                               |
      | amount      | {"currency":"EUR","value":"10.00"}                  |
      | interval    | 1 month                                             |
      | description | Subscription 88                                     |
      | mandateId   | mdt_kept                                            |
      | startDate   | 2099-02-01                                          |
      | metadata    | {"directus_subscription":"88","resumes":"sub_kept"} |
    And subscription sub_kept_2 eventually continues sub_kept
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_88> | <policy_88> | @scalabus/subscriptions |
    And the beneficiaries of subscription sub_kept are eventually:
      | user      | access           |
      | <user_88> | <granted_access> |
    And the beneficiaries of subscription sub_kept_2 are eventually:
      | user      | access           |
      | <user_88> | <granted_access> |
    When these requests get these responses:
      | request                                 | response  |
      | method: DELETE                          | code: 204 |+
      | path: /items/subscription_beneficiaries |           |
      | payload:                                |           |
      |   query:                                |           |
      |     filter:                             |           |
      |       subscription:                     |           |
      |         _eq: 88                         |           |
    Then the beneficiaries of subscription sub_kept_2 are eventually:
      | user      | access           |
      | <user_88> | <granted_access> |
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_88> | <policy_88> | @scalabus/subscriptions |

  Scenario: Stripe signs its webhooks, cancels at period end, and can lose a subscription
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 91 | stripe   | 91      | 1                 | active      |
    And Stripe holds this subscription:
      | column                | value      |
      | subscription          | sub_stripe |
      | customer              | cus_stripe |
      | directus_subscription | 91         |
      | status                | active     |
    And Stripe holds this subscription:
      | column                | value       |
      | subscription          | sub_unbound |
      | customer              | cus_unbound |
      | directus_subscription |             |
      | status                | active      |
    When these requests get these responses:
      | request                              | response                                 |
      | as: public                           | code: 400                                |+
      | method: POST                         | body:                                    |
      | path: /subscriptions/webhooks/stripe |   errors:                                |
      | payload:                             |   - message: >-                          |
      |   id: evt_unsigned                   |       Webhook from "stripe" refused:     |
      |                                      |       expected one "stripe-signature"    |
      |                                      |       header, got null                   |
      |                                      |     extensions:                          |
      |                                      |       code: SUBSCRIPTION_WEBHOOK_REFUSED |
      | as: public                           | code: 400                                |+
      | method: POST                         | body:                                    |
      | path: /subscriptions/webhooks/stripe |   errors:                                |
      | headers:                             |   - message: >-                          |
      |   stripe-signature: t=1,v1=bad       |       Webhook from "stripe" refused: the |
      | payload:                             |       "stripe-signature" header does not |
      |   id: evt_forged                     |       sign the body                      |
      |                                      |     extensions:                          |
      |                                      |       code: SUBSCRIPTION_WEBHOOK_REFUSED |
    And Stripe sends these events:
      | type             | subscription |
      | customer.created | sub_ignored  |
    Then the sync queue eventually holds no row for sub_ignored
    And the instance eventually logged:
      """
      Webhook from "stripe" ignored: event type "customer.created" is not
      handled
      """
    When Stripe sends these events:
      | type                          | subscription |
      | customer.subscription.updated | sub_unbound  |
    Then the sync queue eventually holds no row for sub_unbound
    And the instance eventually logged:
      """
      Subscription sync of "stripe" "sub_unbound" dropped: "\"stripe\"
      subscription \"sub_unbound\" names no pending subscription: its metadata
      \"directus_subscription\" is null"
      """
    When Stripe sends these events:
      | type                          | subscription |
      | customer.subscription.updated | sub_stripe   |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_91> | <policy_91> | @scalabus/subscriptions |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-91-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/cancel |           |
    Then the providers eventually received these writes:
      | method | path                         | body                      |
      | POST   | /v1/subscriptions/sub_stripe | cancel_at_period_end=true |
    And subscription sub_stripe is eventually stored:
      | status | cancel_at_period_end | current_period_end       |
      | active | true                 | 2099-01-01T00:00:00.000Z |
    And these sync queue rows are eventually stored:
      | resource_id | pending | attempts | last_error |
      | sub_stripe  | false   | 0        |            |
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_91> | <policy_91> | @scalabus/subscriptions |
    When Stripe no longer holds subscription sub_stripe
    And Stripe sends these events:
      | type                          | subscription |
      | customer.subscription.deleted | sub_stripe   |
    Then this user eventually holds no access:
      | user      |
      | <user_91> |
    And the events of subscription sub_stripe are eventually:
      | source           | status   | cancel_at_period_end | user      |
      | sync             | active   | false                |           |
      | user             | active   | true                 | <user_91> |
      | provider_missing | canceled | true                 |           |
    And the sync queue eventually holds no row for sub_stripe

  Scenario: Stripe cancels at once a subscription set to end: its access goes at once
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 92 | stripe   | 92      | 1                 | active      |
    And Stripe holds this subscription:
      | column                | value   |
      | subscription          | sub_now |
      | customer              | cus_now |
      | directus_subscription | 92      |
      | status                | active  |
      | cancel_at_period_end  | true    |
    When Stripe sends these events:
      | type                          | subscription |
      | customer.subscription.updated | sub_now      |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_92> | <policy_92> | @scalabus/subscriptions |
    When Stripe holds this subscription:
      | column                | value    |
      | subscription          | sub_now  |
      | customer              | cus_now  |
      | directus_subscription | 92       |
      | status                | canceled |
      | cancel_at_period_end  | true     |
    And Stripe sends these events:
      | type                          | subscription |
      | customer.subscription.deleted | sub_now      |
    Then subscription sub_now is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | false                | 2099-01-01T00:00:00.000Z |
    And this user eventually holds no access:
      | user      |
      | <user_92> |

  Scenario: a user takes back a Stripe cancel: the same subscription goes on
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 93 | stripe   | 93      | 1                 | active      |
    And Stripe holds this subscription:
      | column                | value        |
      | subscription          | sub_takeback |
      | customer              | cus_takeback |
      | directus_subscription | 93           |
      | status                | active       |
      | cancel_at_period_end  | true         |
    When Stripe sends these events:
      | type                          | subscription |
      | customer.subscription.updated | sub_takeback |
    Then subscription sub_takeback is eventually stored:
      | status | cancel_at_period_end | current_period_end       |
      | active | true                 | 2099-01-01T00:00:00.000Z |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-93-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/resume |           |
    Then the providers eventually received these writes:
      | method | path                           | body                       |
      | POST   | /v1/subscriptions/sub_takeback | cancel_at_period_end=false |
    And subscription sub_takeback is eventually stored:
      | status | cancel_at_period_end | current_period_end       |
      | active | false                | 2099-01-01T00:00:00.000Z |
    And the events of subscription sub_takeback are eventually:
      | source | status | cancel_at_period_end | user      |
      | sync   | active | true                 |           |
      | user   | active | false                | <user_93> |
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_93> | <policy_93> | @scalabus/subscriptions |
    And these requests get these responses:
      | request                     | response                                |
      | as: lifecycle-93-token      | code: 404                               |+
      | method: POST                | body:                                   |
      | path: /subscriptions/resume |   errors:                               |
      |                             |     - message: >-                       |
      |                             |         No canceled subscription to     |
      |                             |         resume                          |
      |                             |       extensions:                       |
      |                             |         code: NO_SUBSCRIPTION_TO_RESUME |

  Scenario: each sync announces the access it changed to the extensions listening
    Given these pending subscriptions, each with its own plan:
      | id | provider | manager | beneficiaries_max | plan_status |
      | 95 | mollie   | 95      | 1                 | active      |
    And Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_synced  |
      | customer              | cst_synced |
      | subscription          | sub_synced |
      | directus_subscription | 95         |
      | status                | active     |
    When Mollie sends these events:
      | type         | entity    |
      | payment.paid | tr_synced |
    Then the instance eventually logged:
      """
      subscriptions.synced subscription=95 provider="mollie" status="active"
      access="granted" granted=["<user_95>"] revoked=[]
      """
    When Mollie holds this subscription:
      | column                | value      |
      | payment               | tr_synced  |
      | customer              | cst_synced |
      | subscription          | sub_synced |
      | directus_subscription | 95         |
      | status                | canceled   |
      | paid_at               | 2020-01-01 |
    And Mollie sends these events:
      | type         | entity    |
      | payment.paid | tr_synced |
    Then the instance eventually logged:
      """
      subscriptions.synced subscription=95 provider="mollie" status="canceled"
      access="revoked" granted=[] revoked=["<user_95>"]
      """

  Scenario: the Mollie webhook setup runs before the bundle has its webhook secret
    When the CLI runs subscriptions mollie-setup-webhook --help with these variables:
      | variable                             | value |
      | SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS |       |
      | EXTENSIONS_MUST_LOAD                 | true  |
    Then the CLI exited with 0, having logged:
      """
      Usage: directus subscriptions mollie-setup-webhook [options]
      """
