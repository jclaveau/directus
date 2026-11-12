Feature: A subscription's life at its provider, as the subscriptions bundle follows it

  - A request authenticates as the admin unless its `as` names a token;
    `as: anonymous` sends none, like a provider.
  - The instance loads the real `@scalabus/subscriptions` bundle, and its Mollie
    and Stripe clients call fake ones, answering what `holds` says.
  - `these subscribers, each with its own plan` writes, for an `id` of 21: the
    policy `<policy_21>` named `Lifecycle 21`, the user `<user_21>` with the email
    `lifecycle-21@example.com` and the token `lifecycle-21-token`, and the
    subscriber, customer, plan and plan reference 21.
  - A `<name>` stands for one uuid, the same in the tables and the requests.
  - `received these writes` reads what the providers received since it last read.

  Scenario: a user cancels, and keeps the access they paid for until the period ends
    Given these subscribers, each with its own plan:
      | id | provider | customer         | reference   | plan_status |
      | 21 | mollie   | cst_cancel       | cancel-plan | active      |
      | 22 | mollie   | cst_unsubscribed | unused-plan | active      |
    And Mollie holds this subscription:
      | payment   | customer   | subscription | plan_reference | status | paid_at    |
      | tr_cancel | cst_cancel | sub_cancel   | cancel-plan    | active | 2099-01-01 |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_cancel                |           |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_21> | <policy_21> | @scalabus/subscriptions |
    And these requests get these responses:
      | request                     | response                                  |
      | as: anonymous               | code: 403                                 |+
      | method: POST                | body:                                     |
      | path: /subscriptions/cancel |   errors:                                 |
      |                             |     - message: >-                         |
      |                             |         You don't have permission to      |
      |                             |         access this.                      |
      |                             |       extensions:                         |
      |                             |         code: FORBIDDEN                   |
      | as: lifecycle-22-token      | code: 404                                 |+
      | method: POST                | body:                                     |
      | path: /subscriptions/cancel |   errors:                                 |
      |                             |     - message: >-                         |
      |                             |         No ongoing subscription to cancel |
      |                             |       extensions:                         |
      |                             |         code: NO_SUBSCRIPTION_TO_CANCEL   |
      | as: lifecycle-21-token      | code: 204                                 |+
      | method: POST                |                                           |
      | path: /subscriptions/cancel |                                           |
    Then the providers eventually received these writes:
      | method | path                                              | body |
      | DELETE | /v2/customers/cst_cancel/subscriptions/sub_cancel |      |
    And subscription sub_cancel is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | true                 | 2099-02-01T00:00:00.000Z |
    And the events of subscription sub_cancel are eventually:
      | source | status   | cancel_at_period_end | user      |
      | sync   | active   | false                |           |
      | user   | active   | true                 | <user_21> |
      | sync   | canceled | true                 |           |
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_21> | <policy_21> | @scalabus/subscriptions |
    And these requests get these responses:
      | request                     | response                                  |
      | as: lifecycle-21-token      | code: 404                                 |+
      | method: POST                | body:                                     |
      | path: /subscriptions/cancel |   errors:                                 |
      |                             |     - message: >-                         |
      |                             |         No ongoing subscription to cancel |
      |                             |       extensions:                         |
      |                             |         code: NO_SUBSCRIPTION_TO_CANCEL   |

  Scenario: a user takes back a Mollie cancel: a new subscription starts at period end
    Given these subscribers, each with its own plan:
      | id | provider | customer   | reference   | plan_status |
      | 24 | mollie   | cst_resume | resume-plan | active      |
    And Mollie holds this subscription:
      | payment   | customer   | subscription | plan_reference | status   | paid_at    |
      | tr_resume | cst_resume | sub_resume   | resume-plan    | canceled | 2099-01-01 |
    And Mollie holds this mandate:
      | mandate    | customer   | status |
      | mdt_resume | cst_resume | valid  |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_resume                |           |
    Then subscription sub_resume is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | true                 | 2099-02-01T00:00:00.000Z |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-24-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/resume |           |
    Then Mollie eventually received this subscription for cst_resume:
      | field       | value                                         |
      | amount      | {"currency":"EUR","value":"10.00"}            |
      | interval    | 1 month                                       |
      | description | Plan resume-plan                              |
      | mandateId   | mdt_resume                                    |
      | startDate   | 2099-02-01                                    |
      | metadata    | {"plan":"resume-plan","resumes":"sub_resume"} |
    And subscription sub_resume_2 is eventually stored:
      | status | cancel_at_period_end | current_period_end       |
      | active | false                | 2099-02-01T00:00:00.000Z |
    And subscription sub_resume_2 eventually resumes sub_resume
    And the events of subscription sub_resume are eventually:
      | source | status   | cancel_at_period_end | user      |
      | sync   | canceled | true                 |           |
      | user   | canceled | true                 | <user_24> |
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_24> | <policy_24> | @scalabus/subscriptions |
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
    Given these subscribers, each with its own plan:
      | id | provider | customer  | reference  | plan_status |
      | 25 | mollie   | cst_twice | twice-plan | active      |
    And Mollie holds this subscription:
      | payment  | customer  | subscription | plan_reference | status   | paid_at    |
      | tr_twice | cst_twice | sub_twice    | twice-plan     | canceled | 2099-01-01 |
    And Mollie holds this mandate:
      | mandate   | customer  | status |
      | mdt_twice | cst_twice | valid  |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_twice                 |           |
    Then subscription sub_twice is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | true                 | 2099-02-01T00:00:00.000Z |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-25-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/resume |           |
    Then Mollie eventually received this subscription for cst_twice:
      | field       | value                                       |
      | amount      | {"currency":"EUR","value":"10.00"}          |
      | interval    | 1 month                                     |
      | description | Plan twice-plan                             |
      | mandateId   | mdt_twice                                   |
      | startDate   | 2099-02-01                                  |
      | metadata    | {"plan":"twice-plan","resumes":"sub_twice"} |
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
      | field       | value                                       |
      | amount      | {"currency":"EUR","value":"10.00"}          |
      | interval    | 1 month                                     |
      | description | Plan twice-plan                             |
      | mandateId   | mdt_twice                                   |
      | startDate   | 2099-02-01                                  |
      | metadata    | {"plan":"twice-plan","resumes":"sub_twice"} |
    And subscription sub_twice_3 eventually resumes sub_twice
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_25> | <policy_25> | @scalabus/subscriptions |

  Scenario: a plan policy change moves the access a resumed subscription shares
    Given these subscribers, each with its own plan:
      | id | provider | customer  | reference  | plan_status |
      | 26 | mollie   | cst_split | split-plan | active      |
      | 27 | mollie   | cst_moved | moved-plan | active      |
    And Mollie holds this subscription:
      | payment  | customer  | subscription | plan_reference | status   | paid_at    |
      | tr_split | cst_split | sub_split    | split-plan     | canceled | 2099-01-01 |
    And Mollie holds this mandate:
      | mandate   | customer  | status |
      | mdt_split | cst_split | valid  |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_split                 |           |
    Then subscription sub_split is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | true                 | 2099-02-01T00:00:00.000Z |
    When these requests get these responses:
      | request                     | response  |
      | as: lifecycle-26-token      | code: 204 |+
      | method: POST                |           |
      | path: /subscriptions/resume |           |
    Then Mollie eventually received this subscription for cst_split:
      | field       | value                                       |
      | amount      | {"currency":"EUR","value":"10.00"}          |
      | interval    | 1 month                                     |
      | description | Plan split-plan                             |
      | mandateId   | mdt_split                                   |
      | startDate   | 2099-02-01                                  |
      | metadata    | {"plan":"split-plan","resumes":"sub_split"} |
    And subscription sub_split_2 eventually resumes sub_split
    When these requests get these responses:
      | request                              | response  |
      | method: PATCH                        | code: 200 |+
      | path: /items/subscription_plans/26   |           |
      | payload:                             |           |
      |   policy: <policy_27>                |           |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_split                 |           |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_26> | <policy_27> | @scalabus/subscriptions |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_sub_split_2           |           |
    Then subscription sub_split_2 is eventually stored:
      | status | access           |
      | active | <granted_access> |
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_26> | <policy_27> | @scalabus/subscriptions |

  Scenario: a cancel naming two ongoing subscriptions is refused, none is canceled
    Given these subscribers, each with its own plan:
      | id | provider | customer   | reference | plan_status |
      | 23 | mollie   | cst_double | two-plan  | active      |
    And Mollie holds this subscription:
      | payment | customer   | subscription | plan_reference | status |
      | tr_one  | cst_double | sub_one      | two-plan       | active |
    And Mollie holds this subscription:
      | payment | customer   | subscription | plan_reference | status |
      | tr_two  | cst_double | sub_two      | two-plan       | active |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_one                   |           |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_two                   |           |
    Then subscription sub_one is eventually stored:
      | status | cancel_at_period_end |
      | active | false                |
    And subscription sub_two is eventually stored:
      | status | cancel_at_period_end |
      | active | false                |
    And these requests get these responses:
      | request                     | response                                      |
      | as: lifecycle-23-token      | code: 409                                     |+
      | method: POST                | body:                                         |
      | path: /subscriptions/cancel |   errors:                                     |
      |                             |     - message: >-                             |
      |                             |         Found 2 ongoing subscriptions to      |
      |                             |         cancel, expected one                  |
      |                             |       extensions:                             |
      |                             |         code: SEVERAL_SUBSCRIPTIONS_TO_CANCEL |

  Scenario: a canceled subscription whose paid period is over loses its access
    Given these subscribers, each with its own plan:
      | id | provider | customer  | reference | plan_status |
      | 31 | mollie   | cst_ended | end-plan  | active      |
    And Mollie holds this subscription:
      | payment  | customer  | subscription | plan_reference | status |
      | tr_ended | cst_ended | sub_ended    | end-plan       | active |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_ended                 |           |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_31> | <policy_31> | @scalabus/subscriptions |
    When Mollie holds this subscription:
      | payment  | customer  | subscription | plan_reference | status   | paid_at    |
      | tr_ended | cst_ended | sub_ended    | end-plan       | canceled | 2020-01-01 |
    And these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_ended                 |           |
    Then this user eventually holds no access:
      | user      |
      | <user_31> |
    And subscription sub_ended is eventually stored:
      | status   | cancel_at_period_end | current_period_end       | access |
      | canceled | true                 | 2020-02-01T00:00:00.000Z |        |

  Scenario: a suspended subscription paid again gets its access back
    Given these subscribers, each with its own plan:
      | id | provider | customer    | reference    | plan_status |
      | 33 | mollie   | cst_resumed | resumed-plan | active      |
    And Mollie holds this subscription:
      | payment    | customer    | subscription | plan_reference | status    |
      | tr_resumed | cst_resumed | sub_resumed  | resumed-plan   | suspended |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_resumed               |           |
    Then subscription sub_resumed is eventually stored:
      | status    | access |
      | suspended |        |
    When Mollie holds this subscription:
      | payment    | customer    | subscription | plan_reference | status |
      | tr_resumed | cst_resumed | sub_resumed  | resumed-plan   | active |
    And these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_resumed               |           |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_33> | <policy_33> | @scalabus/subscriptions |

  Scenario: archiving a plan ends its subscriptions once the admin typed the sentence
    Given these subscribers, each with its own plan:
      | id | provider | customer     | reference     | plan_status |
      | 41 | mollie   | cst_archived | archived-plan | active      |
      | 42 | mollie   | cst_empty    | empty-plan    | active      |
    And Mollie holds this subscription:
      | payment     | customer     | subscription | plan_reference | status | paid_at    |
      | tr_archived | cst_archived | sub_archived | archived-plan  | active | 2099-01-01 |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_archived              |           |
    Then subscription sub_archived is eventually stored:
      | status | cancel_at_period_end |
      | active | false                |
    And these requests get these responses:
      | request                                | response                               |
      | as: lifecycle-41-token                 | code: 403                              |+
      | method: POST                           | body:                                  |
      | path: /subscriptions/plans/41/archive  |   errors:                              |
      |                                        |     - message: >-                      |
      |                                        |         You don't have permission to   |
      |                                        |         access this.                   |
      |                                        |       extensions:                      |
      |                                        |         code: FORBIDDEN                |
      | method: POST                           | code: 403                              |+
      | path: /subscriptions/plans/999/archive | body:                                  |
      |                                        |   errors:                              |
      |                                        |     - message: >-                      |
      |                                        |         You don't have permission to   |
      |                                        |         access this.                   |
      |                                        |       extensions:                      |
      |                                        |         code: FORBIDDEN                |
      | method: POST                           | code: 400                              |+
      | path: /subscriptions/plans/one/archive | body:                                  |
      |                                        |   errors:                              |
      |                                        |     - message: >-                      |
      |                                        |         Invalid payload. Plan id "one" |
      |                                        |         must be an integer.            |
      |                                        |       extensions:                      |
      |                                        |         code: INVALID_PAYLOAD          |
      | method: POST                           | code: 400                              |+
      | path: /subscriptions/plans/41/archive  | body:                                  |
      |                                        |   errors:                              |
      |                                        |     - message: >-                      |
      |                                        |         Invalid payload. Type "End 1   |
      |                                        |         subscription and lose this     |
      |                                        |         customer" in "confirmation".   |
      |                                        |       extensions:                      |
      |                                        |         code: INVALID_PAYLOAD          |
      | method: POST                           | code: 200                              |+
      | path: /subscriptions/plans/42/archive  | body:                                  |
      |                                        |   data:                                |
      |                                        |     status: archived                   |
      |                                        |     ending_subscriptions: 0            |
      | method: POST                           | code: 200                              |+
      | path: /subscriptions/plans/41/archive  | body:                                  |
      | payload:                               |   data:                                |
      |   confirmation: >-                     |     status: archived                   |
      |     End 1 subscription and lose this   |     ending_subscriptions: 1            |
      |     customer                           |                                        |
      | method: GET                            | code: 200                              |+
      | path: /items/subscription_plans/41     | body:                                  |
      |                                        |   data:                                |
      |                                        |     status: archived                   |
    Then the providers eventually received these writes:
      | method | path                                                  | body |
      | DELETE | /v2/customers/cst_archived/subscriptions/sub_archived |      |
    And the events of subscription sub_archived are eventually:
      | source        | status   | cancel_at_period_end |
      | sync          | active   | false                |
      | plan_archived | active   | true                 |
      | sync          | canceled | true                 |
    And this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_41> | <policy_41> | @scalabus/subscriptions |

  Scenario: the subscription of a deleted user is canceled at its provider
    Given these subscribers, each with its own plan:
      | id | provider | customer    | reference    | plan_status |
      | 51 | mollie   | cst_deleted | deleted-plan | active      |
    And Mollie holds this subscription:
      | payment    | customer    | subscription | plan_reference | status |
      | tr_deleted | cst_deleted | sub_deleted  | deleted-plan   | active |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_deleted               |           |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_51> | <policy_51> | @scalabus/subscriptions |
    When these requests get these responses:
      | request                              | response  |
      | method: DELETE                       | code: 204 |+
      | path: /users/<user_51>               |           |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_deleted               |           |
    Then the providers eventually received these writes:
      | method | path                                                | body |
      | DELETE | /v2/customers/cst_deleted/subscriptions/sub_deleted |      |
    And subscription sub_deleted is eventually stored:
      | status | cancel_at_period_end | access |
      | active | true                 |        |
    And the events of subscription sub_deleted are eventually:
      | source       | status | cancel_at_period_end |
      | sync         | active | false                |
      | user_deleted | active | true                 |

  Scenario: a subscription its provider no longer holds is closed, its row stays
    Given these subscribers, each with its own plan:
      | id | provider | customer | reference | plan_status |
      | 61 | mollie   | cst_gone | gone-plan | active      |
    And Mollie holds this subscription:
      | payment | customer | subscription | plan_reference | status |
      | tr_gone | cst_gone | sub_gone     | gone-plan      | active |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_gone                  |           |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_61> | <policy_61> | @scalabus/subscriptions |
    When Mollie no longer holds subscription sub_gone
    And these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_gone                  |           |
    Then this user eventually holds no access:
      | user      |
      | <user_61> |
    And the events of subscription sub_gone are eventually:
      | source           | status   | cancel_at_period_end |
      | sync             | active   | false                |
      | provider_missing | canceled | false                |
    And the sync queue eventually holds no row for tr_gone

  Scenario: a webhook is refused or dropped without granting anything
    Given these subscribers, each with its own plan:
      | id | provider | customer  | reference  | plan_status |
      | 63 | mollie   | cst_first | first-plan | active      |
    And Mollie holds this subscription:
      | payment  | customer  | subscription | plan_reference | status |
      | tr_first | cst_first |              | first-plan     | active |
    When these requests get these responses:
      | request                              | response                                 |
      | as: anonymous                        | code: 400                                |+
      | method: POST                         | body:                                    |
      | path: /subscriptions/webhooks/mollie |  errors:                                 |
      | payload: id=not_a_payment            |  - message: >-                           |
      |                                      |      Webhook from "mollie" refused: body |
      |                                      |      id "not_a_payment" is not a payment |
      |                                      |      id                                  |
      |                                      |    extensions:                           |
      |                                      |      code: SUBSCRIPTION_WEBHOOK_REFUSED  |
      | as: anonymous                        | code: 400                                |+
      | method: POST                         | body:                                    |
      | path: /subscriptions/webhooks/mollie |  errors:                                 |
      | payload: other=1                     |  - message: >-                           |
      |                                      |      Webhook from "mollie" refused: body |
      |                                      |      id null is not a payment id         |
      |                                      |    extensions:                           |
      |                                      |      code: SUBSCRIPTION_WEBHOOK_REFUSED  |
      | as: anonymous                        | code: 404                                |+
      | method: POST                         | body:                                    |
      | path: /subscriptions/webhooks/paddle |  errors:                                 |
      | payload: id=tr_first                 |  - message: >-                           |
      |                                      |      Subscription provider "paddle" is   |
      |                                      |      not enabled                         |
      |                                      |    extensions:                           |
      |                                      |      code: UNKNOWN_SUBSCRIPTION_PROVIDER |
      | as: anonymous                        | code: 200                                |+
      | method: POST                         |                                          |
      | path: /subscriptions/webhooks/mollie |                                          |
      | payload: id=tr_first                 |                                          |
    Then the sync queue eventually holds no row for tr_first
    And this user eventually holds no access:
      | user      |
      | <user_63> |

  Scenario: a failed sync keeps its error until a webhook retries it
    Given these subscribers, each with its own plan:
      | id | provider | customer  | reference | plan_status |
      | 71 | mollie   | cst_other | late-plan | active      |
    And Mollie holds this subscription:
      | payment | customer | subscription | plan_reference | status |
      | tr_user | cst_new  | sub_late     | late-plan      | active |
    And Mollie holds this subscription:
      | payment | customer  | subscription  | plan_reference | status |
      | tr_plan | cst_other | sub_late_plan | unknown-plan   | active |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_user                  |           |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_plan                  |           |
    Then these sync queue rows are eventually stored:
      | resource_id | pending | attempts | last_error                                    |
      | tr_plan     | true    | 1        | No plan has "mollie" reference "unknown-plan" |
      | tr_user     | true    | 1        | No subscriber has "mollie" customer "cst_new" |
    When the rows of subscriber_customers:
      | id  | subscriber | provider | provider_customer_id |
      | 710 | 71         | mollie   | cst_new              |
    And Mollie holds this subscription:
      | payment | customer  | subscription  | plan_reference | status    |
      | tr_plan | cst_other | sub_late_plan | late-plan      | suspended |
    And these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_user                  |           |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_plan                  |           |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_71> | <policy_71> | @scalabus/subscriptions |
    And the sync queue eventually holds no row for tr_user
    And the sync queue eventually holds no row for tr_plan

  Scenario: a webhook retries a parked sync
    Given these subscribers, each with its own plan:
      | id | provider | customer   | reference   | plan_status |
      | 81 | mollie   | cst_parked | parked-plan | active      |
    And the rows of subscription_sync_queue:
      | provider | resource_id | pending | attempts | next_attempt_at | last_error  |
      | mollie   | tr_parked   | false   | 48       | 2020-01-01      | Unreachable |
    And Mollie holds this subscription:
      | payment   | customer   | subscription | plan_reference | status |
      | tr_parked | cst_parked | sub_parked   | parked-plan    | active |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_parked                |           |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_81> | <policy_81> | @scalabus/subscriptions |
    And the sync queue eventually holds no row for tr_parked

  Scenario: a paid webhook on a locked plan still grants it
    Given these subscribers, each with its own plan:
      | id | provider | customer   | reference   | plan_status          |
      | 83 | mollie   | cst_locked | locked-plan | subscriptions-locked |
    And Mollie holds this subscription:
      | payment   | customer   | subscription | plan_reference | status |
      | tr_locked | cst_locked | sub_locked   | locked-plan    | active |
    When these requests get these responses:
      | request                              | response  |
      | as: anonymous                        | code: 200 |+
      | method: POST                         |           |
      | path: /subscriptions/webhooks/mollie |           |
      | payload: id=tr_locked                |           |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_83> | <policy_83> | @scalabus/subscriptions |

  Scenario: Stripe signs its webhooks, cancels at period end, and can lose a subscription
    Given these subscribers, each with its own plan:
      | id | provider | customer   | reference    | plan_status |
      | 91 | stripe   | cus_stripe | price_stripe | active      |
    And Stripe holds this subscription:
      | subscription | customer   | price        | status |
      | sub_stripe   | cus_stripe | price_stripe | active |
    When these requests get these responses:
      | request                              | response                                 |
      | as: anonymous                        | code: 400                                |+
      | method: POST                         | body:                                    |
      | path: /subscriptions/webhooks/stripe |   errors:                                |
      | payload:                             |   - message: >-                          |
      |   id: evt_unsigned                   |       Webhook from "stripe" refused:     |
      |                                      |       expected one "stripe-signature"    |
      |                                      |       header, got null                   |
      |                                      |     extensions:                          |
      |                                      |       code: SUBSCRIPTION_WEBHOOK_REFUSED |
      | as: anonymous                        | code: 400                                |+
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
    Given these subscribers, each with its own plan:
      | id | provider | customer | reference | plan_status |
      | 92 | stripe   | cus_now  | price_now | active      |
    And Stripe holds this subscription:
      | subscription | customer | price     | status | cancel_at_period_end |
      | sub_now      | cus_now  | price_now | active | true                 |
    When Stripe sends these events:
      | type                          | subscription |
      | customer.subscription.updated | sub_now      |
    Then this access is eventually stored:
      | user      | policy      | managed_by              |
      | <user_92> | <policy_92> | @scalabus/subscriptions |
    When Stripe holds this subscription:
      | subscription | customer | price     | status   | cancel_at_period_end |
      | sub_now      | cus_now  | price_now | canceled | true                 |
    And Stripe sends these events:
      | type                          | subscription |
      | customer.subscription.deleted | sub_now      |
    Then subscription sub_now is eventually stored:
      | status   | cancel_at_period_end | current_period_end       |
      | canceled | false                | 2099-01-01T00:00:00.000Z |
    And this user eventually holds no access:
      | user      |
      | <user_92> |
